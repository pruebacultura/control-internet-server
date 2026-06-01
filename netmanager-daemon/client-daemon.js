const WebSocket = require('ws');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// =========================================================================
// 0. SISTEMA DE LOGS PERSISTENTE (CONSOLA + ARCHIVO UNIFICADO EN /DAEMON)
// =========================================================================
const logFolder = path.join(__dirname, 'daemon');
const logFile = path.join(logFolder, 'debug-completo.log');

function logMessage(level, prefix, message) {
  const timestamp = new Date().toISOString(); // Formato: 2026-06-01T14:30:00.000Z
  const formattedMessage = `[${timestamp}] [${level}] [${prefix}] ${message}`;
  
  // 1. Enviar a salidas estándar (Para que node-windows llene sus .out y .err)
  if (level === 'ERROR') {
    console.error(formattedMessage);
  } else if (level === 'WARN') {
    console.warn(formattedMessage);
  } else {
    console.log(formattedMessage);
  }

  // 2. Guardar de forma cronológica en nuestro archivo unificado dentro de /daemon
  try {
    // Asegurarnos de que la carpeta 'daemon' exista antes de escribir
    if (!fs.existsSync(logFolder)) {
      fs.mkdirSync(logFolder, { recursive: true });
    }
    // Añadir la línea al archivo (append) de forma segura
    fs.appendFileSync(logFile, formattedMessage + '\n', 'utf-8');
  } catch (err) {
    // Si falla la escritura en disco (por permisos, etc), lo dejamos pasar 
    // para no congelar el servicio, la consola nativa ya tendrá el registro.
  }
}

// =========================================================================
// 1. GESTIÓN DE CONFIGURACIÓN DINÁMICA (IP Y PUERTO)
// =========================================================================

const configPath = path.join(__dirname, 'config.json');
let config = {
  server_ip: '127.0.0.1',
  server_port: '8080',
  client_ip: '127.0.0.1'
};

try {
  logMessage('INFO', 'CONFIG', `Buscando archivo de configuración en: ${configPath}`);
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    logMessage('INFO', 'CONFIG', `Configuración cargada con éxito. Servidor Máster en: ${config.server_ip}:${config.server_port}, IP Cliente: ${config.client_ip}`);
  } else {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    logMessage('WARN', 'CONFIG', 'Archivo config.json no encontrado. Se ha creado uno nuevo con valores por defecto.');
  }
} catch (error) {
  logMessage('ERROR', 'CONFIG', `Error fatal al leer/escribir config.json: ${error.message}`);
}

// =========================================================================
// 2. VARIABLES GLOBALES
// =========================================================================

let ws = null;
let reconnectTimer = null;
let pingTimeout = null;
let reconnecting = false;

// =========================================================================
// 3. HEARTBEAT (MANTENER CONEXIÓN VIVA)
// =========================================================================

function heartbeat() {
  clearTimeout(pingTimeout);
  // Esperamos 30 segundos, si no hay respuesta del servidor, consideramos la conexión muerta
  pingTimeout = setTimeout(() => {
    logMessage('WARN', 'WS-HEARTBEAT', 'Tiempo de espera de Ping agotado. El socket parece estar muerto. Cerrando conexión para forzar reconexión...');
    if (ws) ws.terminate();
  }, 30000);
}

// =========================================================================
// 4. RECONEXIÓN AUTOMÁTICA
// =========================================================================

function reconnect() {
  if (reconnecting) {
    logMessage('DEBUG', 'WS-RECONNECT', 'Intento de reconexión ignorado (ya hay uno en proceso).');
    return;
  }
  
  reconnecting = true;
  logMessage('INFO', 'WS-RECONNECT', 'Programando reintento de conexión en 5 segundos...');
  
  reconnectTimer = setTimeout(() => {
    reconnecting = false;
    logMessage('INFO', 'WS-RECONNECT', 'Ejecutando reintento de conexión ahora.');
    conectarServidor();
  }, 5000);
}

// Añade esta importación al principio de tu archivo si no está (junto a fs, path, etc.)
const dns = require('dns').promises; 

// =========================================================================
// 5. HELPER MATEMÁTICO: PERFORAR RANGOS DE FIREWALL
// =========================================================================

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
}

function longToIp(long) {
  return [(long >>> 24) & 255, (long >>> 16) & 255, (long >>> 8) & 255, long & 255].join('.');
}

function generarRangosConExcepciones(ipsAExcluir) {
  // Rangos base originales de internet público (salvando las IPs locales/LAN)
  let rangosLong = [
    { start: ipToLong("1.0.0.0"), end: ipToLong("9.255.255.255") },
    { start: ipToLong("11.0.0.0"), end: ipToLong("126.255.255.255") },
    { start: ipToLong("128.0.0.0"), end: ipToLong("169.253.255.255") },
    { start: ipToLong("169.255.0.0"), end: ipToLong("172.15.255.255") },
    { start: ipToLong("172.32.0.0"), end: ipToLong("192.167.255.255") },
    { start: ipToLong("192.169.0.0"), end: ipToLong("223.255.255.255") }
  ];

  // Por cada IP excepcional, dividimos el rango donde impacte
  ipsAExcluir.forEach(ip => {
    const targetLong = ipToLong(ip);
    let nuevosRangos = [];

    rangosLong.forEach(r => {
      if (targetLong >= r.start && targetLong <= r.end) {
        if (targetLong > r.start) {
          nuevosRangos.push({ start: r.start, end: targetLong - 1 });
        }
        if (targetLong < r.end) {
          nuevosRangos.push({ start: targetLong + 1, end: r.end });
        }
      } else {
        nuevosRangos.push(r);
      }
    });
    rangosLong = nuevosRangos;
  });

  // Reconstruimos el string formateado para el comando netsh
  return rangosLong.map(r => `${longToIp(r.start)}-${longToIp(r.end)}`).join(',');
}

// =========================================================================
// 6. FIREWALL - BLOQUEAR INTERNET CON EXCEPCIONES
// =========================================================================

async function bloquearInternet() {
  logMessage('INFO', 'FIREWALL', 'Iniciando rutina de bloqueo de internet con excepciones.');

  // Lista de dominios permitidos (puedes agregar más aquí en el futuro)
  const dominiosPermitidos = [
    'campus.aulavirtual.unc.edu.ar',
    'aulavirtual.unc.edu.ar' // Añadido por si carga recursos del dominio raíz
  ];

  let ipsExcepciones = [];

  // Resolver IPs dinámicamente
  for (const dominio of dominiosPermitidos) {
    try {
      const addresses = await dns.resolve4(dominio);
      ipsExcepciones.push(...addresses);
      logMessage('INFO', 'FIREWALL', `DNS obtenido para ${dominio}: ${addresses.join(', ')}`);
    } catch (err) {
      logMessage('WARN', 'FIREWALL', `No se pudo resolver el dominio ${dominio}: ${err.message}`);
    }
  }

  // Quitar IPs duplicadas si las hubiera
  ipsExcepciones = [...new Set(ipsExcepciones)];

  // Calcular la cadena de rangos omitiendo las IPs del Campus
  const rangosPublicosV4 = generarRangosConExcepciones(ipsExcepciones);

  const cmdDelete4 = 'netsh advfirewall firewall delete rule name="BloqueoInternet"';
  const cmdDelete6 = 'netsh advfirewall firewall delete rule name="BloqueoInternetIPv6"';

  exec(cmdDelete4, () => {
    exec(cmdDelete6, () => {
      
      const cmdAddV4 = `netsh advfirewall firewall add rule name="BloqueoInternet" dir=out action=block remoteip="${rangosPublicosV4}"`;
      
      // Mantenemos IPv6 bloqueado completamente por seguridad. 
      // Al no poder usar IPv6, el navegador usará automáticamente IPv4 donde el Campus está permitido.
      const cmdAddV6 = `netsh advfirewall firewall add rule name="BloqueoInternetIPv6" dir=out action=block remoteip="2000::/3"`;

      logMessage('DEBUG', 'FIREWALL', 'Aplicando regla de bloqueo IPv4 (Excepciones activas)...');
      exec(cmdAddV4, (err4, stdout4) => {
        if (err4) logMessage('ERROR', 'FIREWALL', `Fallo en regla IPv4: ${err4.message}`);
        else logMessage('INFO', 'FIREWALL', `✅ Regla IPv4 con excepciones aplicada: ${stdout4.trim()}`);
        
        logMessage('DEBUG', 'FIREWALL', 'Aplicando regla IPv6...');
        exec(cmdAddV6, (err6, stdout6) => {
          if (err6) logMessage('ERROR', 'FIREWALL', `Fallo en regla IPv6: ${err6.message}`);
          else logMessage('INFO', 'FIREWALL', `✅ Regla IPv6 de aislamiento aplicada.`);
        });
      });

    });
  });
}

// =========================================================================
// 6.5 FIREWALL - DESBLOQUEAR INTERNET
// =========================================================================

function desbloquearInternet() {
  logMessage('INFO', 'FIREWALL', 'Iniciando rutina de desbloqueo (Eliminando reglas).');

  const cmdDelete4 = 'netsh advfirewall firewall delete rule name="BloqueoInternet"';
  const cmdDelete6 = 'netsh advfirewall firewall delete rule name="BloqueoInternetIPv6"';

  exec(cmdDelete4, (err4) => {
    exec(cmdDelete6, (err6) => {
      if (err4 && err6) {
        logMessage('WARN', 'FIREWALL', 'Las reglas no existían o ya estaban borradas.');
      } else {
        logMessage('INFO', 'FIREWALL', '✅ Red liberada por completo. Acceso total a Internet.');
      }
    });
  });
}

// =========================================================================
// 7. CONEXIÓN WEBSOCKET
// =========================================================================

function conectarServidor() {
  const url = `ws://${config.server_ip}:${config.server_port}`;
  logMessage('INFO', 'WEBSOCKET', `Intentando conectar al servidor central en: ${url}`);

  try {
    ws = new WebSocket(url, { handshakeTimeout: 5000 });
  } catch (error) {
    logMessage('ERROR', 'WEBSOCKET', `Error al instanciar el cliente WebSocket: ${error.message}`);
    reconnect();
    return;
  }

  ws.on('open', () => {
    logMessage('INFO', 'WEBSOCKET', '✅ Conexión establecida exitosamente con el Panel Central.');
    heartbeat();
    
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    const payloadRegistro = { action: 'REGISTER', ip: config.client_ip };
    logMessage('DEBUG', 'WEBSOCKET', `Enviando payload de registro: ${JSON.stringify(payloadRegistro)}`);
    ws.send(JSON.stringify(payloadRegistro));
  });

  ws.on('ping', () => {
    logMessage('DEBUG', 'WS-HEARTBEAT', 'Ping recibido del servidor.');
    heartbeat();
  });

  ws.on('message', (data) => {
    logMessage('DEBUG', 'WEBSOCKET', `Mensaje crudo recibido: ${data}`);
    try {
      const mensaje = JSON.parse(data);
      logMessage('INFO', 'WEBSOCKET', `📩 Orden procesada: ${mensaje.action}`);

      if (mensaje.action === 'BLOCK_ON') {
        bloquearInternet();
      } else if (mensaje.action === 'BLOCK_OFF') {
        desbloquearInternet();
      } else {
        logMessage('WARN', 'WEBSOCKET', `Acción desconocida recibida: ${mensaje.action}`);
      }

    } catch (e) {
      logMessage('ERROR', 'WEBSOCKET', `Fallo al parsear el mensaje recibido. ¿Es JSON válido? Error: ${e.message}`);
    }
  });

  ws.on('close', (code, reason) => {
    logMessage('WARN', 'WEBSOCKET', `Conexión cerrada con el servidor. Código: ${code}, Razón: ${reason ? reason : 'N/A'}`);
    clearTimeout(pingTimeout);
    reconnect();
  });

  ws.on('error', (err) => {
    logMessage('ERROR', 'WEBSOCKET', `Se produjo un error en la capa del WebSocket: ${err.message}`);
    if (ws) ws.terminate();
  });
}

// =========================================================================
// 8. INICIO
// =========================================================================
logMessage('INFO', 'SISTEMA', 'Iniciando NetManager Client Daemon...');
conectarServidor();