const WebSocket = require('ws');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

// =========================================================================
// 1. GESTIÓN DE CONFIGURACIÓN DINÁMICA (IP Y PUERTO)
// =========================================================================
// Busca un archivo config.json en el mismo directorio donde corre este script
const configPath = path.join(__dirname, 'config.json');
let config = { server_ip: '127.0.0.1', server_port: '8080', client_ip: '127.0.0.1' };

try {
  if (fs.existsSync(configPath)) {
    config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    console.log(`⚙️ Configuración cargada. Servidor Máster en: ${config.server_ip}:${config.server_port}`);
  } else {
    // Si el archivo no existe en el puesto, lo auto-generamos para que el técnico lo edite
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    console.log('⚠️ config.json no encontrado. Se ha creado un archivo de configuración por defecto.');
  }
} catch (error) {
  console.error('Error al intentar leer config.json, usando valores por defecto:', error.message);
}

// =========================================================================
// 2. NÚCLEO DE CONEXIÓN WEBSOCKET Y CONTROL DE FIREWALL
// =========================================================================
function conectarServidor() {
  const url = `ws://${config.server_ip}:${config.server_port}`;
  console.log(`Intentando conectar al servidor central en ${url}...`);
  
  const ws = new WebSocket(url);

  ws.on('open', () => {
  console.log('✅ Conectado exitosamente al Panel Central. Registrando identidad...');

  // Obtenemos la IP de este equipo (o usamos una configurada)
  // Para que esto funcione 100%, lo ideal es agregar un campo "client_ip" en tu config.json
  // Ejemplo: { "server_ip": "192.168.1.10", "server_port": "8080", "mi_ip": "192.168.1.10" }
  
  // Por ahora, asumimos que la IP del servidor es la misma que la del cliente (ya que están en la misma PC)
  const miIP = config.server_ip; 
  
  ws.send(JSON.stringify({ 
    action: 'REGISTER', 
    ip: config.client_ip 
  }));
});

  ws.on('message', (data) => {
    try {
      const mensaje = JSON.parse(data);
      console.log(`Orden recibida: ${mensaje.action}`);

      // Sincronizado con el comando de bloqueo enviado por main.js (nuevoEstado === 'OFF')
      if (mensaje.action === 'BLOCK_ON') {
          const cmdLimpiar = 'netsh advfirewall firewall delete rule name="BloqueoPuesto"';
          const cmdBloquear = 'netsh advfirewall firewall add rule name="BloqueoPuesto" dir=out action=block protocol=ANY';
          exec(cmdLimpiar, () => {
              exec(cmdBloquear, (err) => {
                  if (err) console.error("❌ Error Firewall:", err.message);
                  else console.log("🔒 Internet Bloqueado.");
              });
          });
      }
      
      // Sincronizado con el comando de habilitación enviado por main.js (nuevoEstado === 'ON')
      else if (mensaje.action === 'BLOCK_OFF') {
        const cmd = `netsh advfirewall firewall delete rule name="BloqueoPuesto"`;
        exec(cmd, (err) => {
          // Ignoramos errores menores (como que la regla no existiera previamente en el Firewall)
          console.log("🔓 Internet Desbloqueado y Restaurado.");
        });
      }
    } catch (e) {
      console.error("Error al procesar el mensaje del servidor:", e);
    }
  });

  ws.on('close', () => {
    console.log('❌ Conexión perdida con el Servidor. Reintentando en 5 segundos...');
    setTimeout(conectarServidor, 5000);
  });

  ws.on('error', (err) => {
    // Forzamos el cierre del socket para gatillar el evento 'close' y su reconexión automática
    ws.close(); 
  });
}

conectarServidor();