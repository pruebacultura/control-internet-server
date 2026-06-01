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
// 5. HELPER MATEMÁTICO: PERFORAR RANGOS DE FIREWALL (SOPORTE DE SUBREDES Y LOTES)
// =========================================================================

function ipToLong(ip) {
  return ip.split('.').reduce((acc, octet) => acc * 256 + parseInt(octet, 10), 0);
}

function longToIp(long) {
  return [(long >>> 24) & 255, (long >>> 16) & 255, (long >>> 8) & 255, long & 255].join('.');
}

function generarRangosConExcepciones(exclusiones) {
  // Rangos base de internet público (anteponiendo la salvaguarda de IPs de LAN)
  let rangosLong = [
    { start: ipToLong("1.0.0.0"), end: ipToLong("9.255.255.255") },
    { start: ipToLong("11.0.0.0"), end: ipToLong("126.255.255.255") },
    { start: ipToLong("128.0.0.0"), end: ipToLong("169.253.255.255") },
    { start: ipToLong("169.255.0.0"), end: ipToLong("172.15.255.255") },
    { start: ipToLong("172.32.0.0"), end: ipToLong("192.167.255.255") },
    { start: ipToLong("192.169.0.0"), end: ipToLong("223.255.255.255") }
  ];

  // Procesar cada exclusión (puede ser una IP única o un rango/subred completa)
  exclusiones.forEach(exc => {
    const startLong = ipToLong(exc.start);
    const endLong = ipToLong(exc.end);
    let nuevosRangos = [];

    rangosLong.forEach(r => {
      // Si la exclusión intersecta con el rango base actual, lo subdividimos
      if (startLong <= r.end && endLong >= r.start) {
        if (startLong > r.start) {
          nuevosRangos.push({ start: r.start, end: startLong - 1 });
        }
        if (endLong < r.end) {
          nuevosRangos.push({ start: endLong + 1, end: r.end });
        }
      } else {
        nuevosRangos.push(r);
      }
    });
    rangosLong = nuevosRangos;
  });

  // Retornamos un ARRAY de strings de rangos individuales
  return rangosLong.map(r => `${longToIp(r.start)}-${longToIp(r.end)}`);
}

// =========================================================================
// 6. FIREWALL - BLOQUEAR INTERNET CON EXCEPCIONES (OPTIMIZADO POR LOTES)
// =========================================================================

async function bockearFirewallEnLotes(listaRangos) {
  const tamanoLote = 5; // Cantidad segura de rangos por comando netsh
  let numeroLote = 1;

  for (let i = 0; i < listaRangos.length; i += tamanoLote) {
    const lote = listaRangos.slice(i, i + tamanoLote);
    const remoteipStr = lote.join(',');

    const cmdAddV4 = `netsh advfirewall firewall add rule name="BloqueoInternet" dir=out action=block remoteip="${remoteipStr}"`;
    
    await new Promise(resolve => {
      exec(cmdAddV4, (err, stdout) => {
        if (err) {
          logMessage('ERROR', 'FIREWALL', `Error al aplicar lote ${numeroLote}: ${err.message}`);
        } else {
          logMessage('DEBUG', 'FIREWALL', `Lote ${numeroLote} de bloqueo IPv4 aplicado exitosamente.`);
        }
        resolve();
      });
    });
    numeroLote++;
  }
}

async function bloquearInternet() {
  logMessage('INFO', 'FIREWALL', 'Iniciando rutina de bloqueo de internet por lotes seguros.');

  // 1. Desbloqueo flash previo para evitar el auto-bloqueo del DNS de Node
  await new Promise(resolve => exec('netsh advfirewall firewall delete rule name="BloqueoInternet"', () => resolve()));
  await new Promise(resolve => exec('netsh advfirewall firewall delete rule name="BloqueoInternetIPv6"', () => resolve()));

  // 2. Estructurar matriz de exclusiones fijas (IPs de DNS y el bloque completo de la UNC)
  let exclusiones = [
    { start: '8.8.8.8', end: '8.8.8.8' }, // Google DNS
    { start: '8.8.4.4', end: '8.8.4.4' },
    { start: '1.1.1.1', end: '1.1.1.1' }, // Cloudflare DNS
    { start: '1.0.0.1', end: '1.0.0.1' },
    
    // 🎓 RANGO INSTITUCIONAL UNC: Toda la subred de la universidad queda libre por seguridad
    { start: '200.16.0.0', end: '200.16.255.255' }
  ];

  const dominiosPermitidos = [
    'campus.aulavirtual.unc.edu.ar',
    'aulavirtual.unc.edu.ar',
    'mi.unc.edu.ar',
    'www.unc.edu.ar',
    'fonts.googleapis.com',
    'fonts.gstatic.com',
    'cdnjs.cloudflare.com'
  ];

  // 3. Resolver dinámicamente otros dominios (como fuentes de Google o CDNs)
  for (const dominio of dominiosPermitidos) {
    try {
      const addresses = await dns.resolve4(dominio);
      addresses.forEach(ip => {
        exclusiones.push({ start: ip, end: ip });
      });
      logMessage('INFO', 'FIREWALL', `DNS obtenido para ${dominio}: ${addresses.join(', ')}`);
    } catch (err) {
      logMessage('WARN', 'FIREWALL', `No se pudo resolver el dominio ${dominio} (usará rangos fijos): ${err.message}`);
    }
  }

  // 4. Deduplicar la lista de exclusiones
  const exclusionesUnicas = [];
  const registroClaves = new Set();
  exclusiones.forEach(e => {
    const clave = `${e.start}-${e.end}`;
    if (!registroClaves.has(clave)) {
      registroClaves.add(clave);
      exclusionesUnicas.push(e);
    }
  });

  // 5. Calcular los fragmentos públicos resultantes
  const listaRangosV4 = generarRangosConExcepciones(exclusionesUnicas);
  logMessage('INFO', 'FIREWALL', `Se calcularon ${listaRangosV4.length} rangos de bloqueo. Aplicando en sub-reglas...`);

  // 6. Ejecutar el despliegue secuencial de sub-reglas IPv4
  await bockearFirewallEnLotes(listaRangosV4);

  // 7. Bloquear IPv6 por completo (fuerza al sistema a usar la perforación IPv4)
  const cmdAddV6 = `netsh advfirewall firewall add rule name="BloqueoInternetIPv6" dir=out action=block remoteip="2000::/3"`;
  exec(cmdAddV6, (err6) => {
    if (err6) logMessage('ERROR', 'FIREWALL', `Fallo en regla IPv6: ${err6.message}`);
    else logMessage('INFO', 'FIREWALL', `✅ Bloqueo completo con excepciones activo.`);
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