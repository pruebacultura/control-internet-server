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
    console.log(`⚙️ Configuración cargada. Servidor Máster en: ${config.server_ip}:${config.server_port}`);
  } else {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('⚠️ config.json no encontrado. Se creó uno por defecto.');
  }
} catch (error) {
  console.error('❌ Error leyendo config.json:', error.message);
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
    if (ws) ws.terminate();
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
// 5. FIREWALL - BLOQUEAR INTERNET (A prueba de fallos)
// =========================================================================

function bloquearInternet() {
  console.log('🔒 Aplicando bloqueo de internet (Navegación Web)...');

  // Limpiamos cualquier regla residual antes de aplicar las nuevas
  exec('netsh advfirewall firewall delete rule name="BloqueoInternet"', () => {
      
      // Regla 1: Bloquear Navegación Tradicional (TCP 80 y 443)
      const reglaTCP = 'netsh advfirewall firewall add rule name="BloqueoInternet" dir=out action=block protocol=TCP remoteport=80,443';
      
      // Regla 2: Bloquear Navegadores Modernos con QUIC (UDP 443)
      const reglaUDP = 'netsh advfirewall firewall add rule name="BloqueoInternet" dir=out action=block protocol=UDP remoteport=443';

      exec(reglaTCP, (errTCP) => {
        if (errTCP) console.error('❌ Error creando regla TCP:', errTCP.message);
        
        exec(reglaUDP, (errUDP) => {
          if (errUDP) console.error('❌ Error creando regla UDP:', errUDP.message);
          
          console.log('✅ Internet bloqueado (Puertos 80, 443 cerrados). El WebSocket sigue en línea.');
        });
      });
  });
}

// =========================================================================
// 6. FIREWALL - DESBLOQUEAR INTERNET
// =========================================================================

function desbloquearInternet() {
  console.log('🔓 Restaurando conexión a internet...');

  // Con solo eliminar la regla, Windows vuelve a su comportamiento por defecto (Permitir)
  exec('netsh advfirewall firewall delete rule name="BloqueoInternet"', () => {
    console.log('✅ Internet restaurado correctamente.');
  });
}

// =========================================================================
// 7. CONEXIÓN WEBSOCKET
// =========================================================================

function conectarServidor() {
  const url = `ws://${config.server_ip}:${config.server_port}`;
  console.log(`🌐 Intentando conectar al servidor central en ${url}...`);

  ws = new WebSocket(url, { handshakeTimeout: 5000 });

  ws.on('open', () => {
    console.log('✅ Conectado exitosamente al Panel Central.');
    heartbeat();
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    // Registramos el puesto con la IP configurada
    ws.send(JSON.stringify({ action: 'REGISTER', ip: config.client_ip }));
  });

  ws.on('ping', heartbeat);

  ws.on('message', (data) => {
    try {
      const mensaje = JSON.parse(data);
      console.log(`📩 Orden recibida: ${mensaje.action}`);

      if (mensaje.action === 'BLOCK_ON') bloquearInternet();
      else if (mensaje.action === 'BLOCK_OFF') desbloquearInternet();

    } catch (e) {
      console.error('❌ Error procesando mensaje:', e.message);
    }
  });

  ws.on('close', () => {
    console.log('❌ Conexión cerrada con el servidor.');
    clearTimeout(pingTimeout);
    reconnect();
  });

  ws.on('error', (err) => {
    console.error('❌ Error WebSocket:', err.message);
    if (ws) ws.terminate();
  });
}

// =========================================================================
// 8. INICIO
// =========================================================================
conectarServidor();