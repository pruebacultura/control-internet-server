const WebSocket = require('ws');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

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
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

    console.log(
      `⚙️ Configuración cargada. Servidor Máster en: ${config.server_ip}:${config.server_port}`
    );
  } else {
    fs.writeFileSync(
      configPath,
      JSON.stringify(config, null, 2),
      'utf-8'
    );

    console.log(
      '⚠️ config.json no encontrado. Se creó uno por defecto.'
    );
  }
} catch (error) {
  console.error(
    '❌ Error leyendo config.json:',
    error.message
  );
}

// =========================================================================
// 2. VARIABLES GLOBALES
// =========================================================================

let ws = null;
let reconnectTimer = null;
let pingTimeout = null;
let reconnecting = false;

// =========================================================================
// 3. HEARTBEAT
// =========================================================================

function heartbeat() {
  clearTimeout(pingTimeout);

  pingTimeout = setTimeout(() => {
    console.log('⚠️ Heartbeat perdido. Socket muerto.');

    if (ws) {
      ws.terminate();
    }
  }, 30000);
}

// =========================================================================
// 4. RECONEXIÓN AUTOMÁTICA
// =========================================================================

function reconnect() {
  if (reconnecting) return;

  reconnecting = true;

  console.log('🔄 Reintentando conexión en 5 segundos...');

  reconnectTimer = setTimeout(() => {
    reconnecting = false;
    conectarServidor();
  }, 5000);
}

// =========================================================================
// 5. FIREWALL - BLOQUEAR INTERNET
// =========================================================================

function bloquearInternet() {
  const serverIP = config.server_ip;

  console.log('🔒 Aplicando bloqueo de internet...');

  // Eliminamos reglas anteriores
  exec(
    'netsh advfirewall firewall delete rule name="BloqueoInternet"',
    () => {
      exec(
        'netsh advfirewall firewall delete rule name="PermitirServidor"',
        () => {

          // Regla: bloquear TODO
          const reglaBloqueo =
            'netsh advfirewall firewall add rule name="BloqueoInternet" dir=out action=block remoteip=0.0.0.0-255.255.255.255 protocol=ANY';

          // Regla: permitir servidor websocket
          const reglaPermitirServidor =
            `netsh advfirewall firewall add rule name="PermitirServidor" dir=out action=allow remoteip=${serverIP} protocol=ANY`;

          exec(reglaBloqueo, (errBloqueo) => {
            if (errBloqueo) {
              console.error(
                '❌ Error creando regla de bloqueo:',
                errBloqueo.message
              );
              return;
            }

            exec(reglaPermitirServidor, (errAllow) => {
              if (errAllow) {
                console.error(
                  '❌ Error permitiendo servidor:',
                  errAllow.message
                );
                return;
              }

              console.log(
                '✅ Internet bloqueado correctamente.'
              );
            });
          });
        }
      );
    }
  );
}

// =========================================================================
// 6. FIREWALL - DESBLOQUEAR INTERNET
// =========================================================================

function desbloquearInternet() {
  console.log('🔓 Restaurando conexión a internet...');

  exec(
    'netsh advfirewall firewall delete rule name="BloqueoInternet"',
    () => {
      exec(
        'netsh advfirewall firewall delete rule name="PermitirServidor"',
        () => {
          console.log(
            '✅ Internet restaurado correctamente.'
          );
        }
      );
    }
  );
}

// =========================================================================
// 7. CONEXIÓN WEBSOCKET
// =========================================================================

function conectarServidor() {
  const url = `ws://${config.server_ip}:${config.server_port}`;

  console.log(
    `🌐 Intentando conectar al servidor central en ${url}...`
  );

  ws = new WebSocket(url, {
    handshakeTimeout: 5000
  });

  // =========================================================
  // CONEXIÓN EXITOSA
  // =========================================================

  ws.on('open', () => {
    console.log(
      '✅ Conectado exitosamente al Panel Central.'
    );

    heartbeat();

    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Registramos el puesto
    ws.send(
      JSON.stringify({
        action: 'REGISTER',
        ip: config.client_ip
      })
    );
  });

  // =========================================================
  // HEARTBEAT
  // =========================================================

  ws.on('ping', heartbeat);

  // =========================================================
  // MENSAJES
  // =========================================================

  ws.on('message', (data) => {
    try {
      const mensaje = JSON.parse(data);

      console.log(
        `📩 Orden recibida: ${mensaje.action}`
      );

      // BLOQUEAR INTERNET
      if (mensaje.action === 'BLOCK_ON') {
        bloquearInternet();
      }

      // DESBLOQUEAR INTERNET
      else if (mensaje.action === 'BLOCK_OFF') {
        desbloquearInternet();
      }

    } catch (e) {
      console.error(
        '❌ Error procesando mensaje:',
        e.message
      );
    }
  });

  // =========================================================
  // CIERRE DE SOCKET
  // =========================================================

  ws.on('close', () => {
    console.log(
      '❌ Conexión cerrada con el servidor.'
    );

    clearTimeout(pingTimeout);

    reconnect();
  });

  // =========================================================
  // ERRORES
  // =========================================================

  ws.on('error', (err) => {
    console.error(
      '❌ Error WebSocket:',
      err.message
    );

    if (ws) {
      ws.terminate();
    }
  });
}

// =========================================================================
// 8. INICIO
// =========================================================================

conectarServidor();