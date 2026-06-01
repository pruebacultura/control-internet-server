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

// =========================================================================
// 5. FIREWALL - BLOQUEAR INTERNET (Aislamiento LAN IPv4 + IPv6)
// =========================================================================

function bloquearInternet() {
  logMessage('INFO', 'FIREWALL', 'Iniciando rutina de bloqueo de internet (Aislamiento IPv4 e IPv6).');

  const cmdDelete4 = 'netsh advfirewall firewall delete rule name="BloqueoInternet"';
  const cmdDelete6 = 'netsh advfirewall firewall delete rule name="BloqueoInternetIPv6"';

  // 1. Limpieza de reglas previas
  exec(cmdDelete4, () => {
    exec(cmdDelete6, () => {
      
      // Rangos Públicos IPv4
      const rangosPublicosV4 = "1.0.0.0-9.255.255.255,11.0.0.0-126.255.255.255,128.0.0.0-169.253.255.255,169.255.0.0-172.15.255.255,172.32.0.0-192.167.255.255,192.169.0.0-223.255.255.255";
      const cmdAddV4 = `netsh advfirewall firewall add rule name="BloqueoInternet" dir=out action=block remoteip="${rangosPublicosV4}"`;
      
      // Rango Público IPv6 (2000::/3 cubre todo el internet global IPv6)
      const cmdAddV6 = `netsh advfirewall firewall add rule name="BloqueoInternetIPv6" dir=out action=block remoteip="2000::/3"`;

      // Aplicar Bloqueo IPv4
      logMessage('DEBUG', 'FIREWALL', 'Aplicando regla IPv4...');
      exec(cmdAddV4, (err4, stdout4) => {
        if (err4) logMessage('ERROR', 'FIREWALL', `Fallo en regla IPv4: ${err4.message}`);
        else logMessage('INFO', 'FIREWALL', `✅ Regla IPv4 aplicada: ${stdout4.trim()}`);
        
        // Aplicar Bloqueo IPv6
        logMessage('DEBUG', 'FIREWALL', 'Aplicando regla IPv6...');
        exec(cmdAddV6, (err6, stdout6) => {
          if (err6) logMessage('ERROR', 'FIREWALL', `Fallo en regla IPv6: ${err6.message}`);
          else logMessage('INFO', 'FIREWALL', `✅ Regla IPv6 aplicada: ${stdout6.trim()}`);
        });
      });

    });
  });
}

// =========================================================================
// 6. FIREWALL - DESBLOQUEAR INTERNET
// =========================================================================

function desbloquearInternet() {
  logMessage('INFO', 'FIREWALL', 'Iniciando rutina de desbloqueo (Eliminando reglas).');

  const cmdDelete4 = 'netsh advfirewall firewall delete rule name="BloqueoInternet"';
  const cmdDelete6 = 'netsh advfirewall firewall delete rule name="BloqueoInternetIPv6"';

  exec(cmdDelete4, (err4, stdout4) => {
    exec(cmdDelete6, (err6, stdout6) => {
      if (err4 && err6) {
        logMessage('ERROR', 'FIREWALL', 'No se pudieron eliminar las reglas (posiblemente ya estaban borradas).');
      } else {
        logMessage('INFO', 'FIREWALL', '✅ Reglas eliminadas. Internet restaurado por completo.');
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