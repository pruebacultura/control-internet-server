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
// 5. FIREWALL - BLOQUEAR INTERNET (Aislamiento LAN / A prueba de fallos)
// =========================================================================

function bloquearInternet() {
  logMessage('INFO', 'FIREWALL', 'Iniciando rutina de bloqueo de internet (Aislamiento de IPs públicas).');

  const cmdDelete = 'netsh advfirewall firewall delete rule name="BloqueoInternet"';
  logMessage('DEBUG', 'FIREWALL', `Ejecutando limpieza previa: ${cmdDelete}`);

  exec(cmdDelete, (errDel, stdoutDel, stderrDel) => {
      if (errDel) {
        // Es normal que dé error si la regla no existía
        logMessage('WARN', 'FIREWALL', `Alerta al borrar regla previa (suele ser normal si no existía): ${errDel.message.replace(/\r?\n|\r/g, ' ')}`);
      }

      // Definimos todos los rangos de IPs públicas de Internet.
      // Al NO incluir la LAN (192.168.x.x, 10.x.x.x, 127.0.0.1, etc), el WebSocket se mantiene conectado perfectamente.
      const rangosPublicos = "1.0.0.0-9.255.255.255,11.0.0.0-126.255.255.255,128.0.0.0-169.253.255.255,169.255.0.0-172.15.255.255,172.32.0.0-192.167.255.255,192.169.0.0-223.255.255.255";
      const cmdAdd = `netsh advfirewall firewall add rule name="BloqueoInternet" dir=out action=block remoteip="${rangosPublicos}"`;
      
      logMessage('DEBUG', 'FIREWALL', `Ejecutando creación de regla: ${cmdAdd}`);

      exec(cmdAdd, (errAdd, stdoutAdd, stderrAdd) => {
        if (errAdd) {
            logMessage('ERROR', 'FIREWALL', `Fallo crítico al crear la regla de bloqueo LAN: ${errAdd.message}`);
            if (stderrAdd) logMessage('ERROR', 'FIREWALL', `Detalle del error del sistema (STDERR): ${stderrAdd.trim()}`);
        } else {
            logMessage('INFO', 'FIREWALL', '✅ Regla de bloqueo aplicada exitosamente. Tráfico hacia internet denegado; LAN permitida.');
            if (stdoutAdd) logMessage('DEBUG', 'FIREWALL', `Respuesta del sistema (STDOUT): ${stdoutAdd.trim()}`);
        }
      });
  });
}

// =========================================================================
// 6. FIREWALL - DESBLOQUEAR INTERNET
// =========================================================================

function desbloquearInternet() {
  logMessage('INFO', 'FIREWALL', 'Iniciando rutina de desbloqueo (Restaurando conexión a internet).');

  const cmdDelete = 'netsh advfirewall firewall delete rule name="BloqueoInternet"';
  logMessage('DEBUG', 'FIREWALL', `Ejecutando comando: ${cmdDelete}`);

  exec(cmdDelete, (err, stdout, stderr) => {
    if (err) {
      logMessage('ERROR', 'FIREWALL', `Error al intentar eliminar la regla de bloqueo: ${err.message}`);
      if (stderr) logMessage('ERROR', 'FIREWALL', `Detalle del error del sistema (STDERR): ${stderr.trim()}`);
    } else {
      logMessage('INFO', 'FIREWALL', '✅ Regla eliminada. Internet restaurado correctamente.');
      if (stdout) logMessage('DEBUG', 'FIREWALL', `Respuesta del sistema (STDOUT): ${stdout.trim()}`);
    }
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