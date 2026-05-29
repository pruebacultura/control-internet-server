const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { WebSocketServer } = require('ws');

let mainWindow;
let wss;
const clientesConectados = new Map();

// =========================================================================
// 1. INICIALIZACIÓN DE LA BASE DE DATOS
// =========================================================================
const carpetaDB = 'C:\\ControlInternet\\Database';
if (!fs.existsSync(carpetaDB)){
    fs.mkdirSync(carpetaDB, { recursive: true });
}

const dbPath = path.join(carpetaDB, 'control_internet_database.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('Error crítico al abrir la base de datos:', err.message);
  } else {
    console.log('✅ Base de datos SQLite conectada permanentemente en:', dbPath);
    crearTablasIniciales();
  }
});

function crearTablasIniciales() {
  db.serialize(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS puestos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL,
        ip_address TEXT NOT NULL UNIQUE,
        mac_address TEXT NOT NULL,
        estado_actual TEXT DEFAULT 'OFF',
        ultima_conexion TEXT
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS historial_conexiones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puesto_id INTEGER NOT NULL,
        evento TEXT NOT NULL,
        fecha_inicio TEXT NOT NULL,
        fecha_fin TEXT,
        duracion_segundos INTEGER,
        FOREIGN KEY(puesto_id) REFERENCES puestos(id) ON DELETE CASCADE
      )
    `);

    db.run(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'operador'
      )
    `, () => {
      db.get("SELECT COUNT(*) as cuenta FROM usuarios", [], (err, row) => {
        if (!err && row.cuenta === 0) {
          db.run("INSERT INTO usuarios (username, password, role) VALUES ('admin', 'admin123', 'admin')");
          console.log('👤 Usuario administrador inicial creado.');
        }
      });
    });
  });
}

function notificarCambioRed() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('network:status-changed');
  }
}

// =========================================================================
// 3. SERVIDOR WEBSOCKET
// =========================================================================
function heartbeat() {
  this.isAlive = true;
}

function iniciarServidorWebSocket() {
  wss = new WebSocketServer({ port: 8080 });
  console.log('📡 Servidor WebSocket escuchando en el puerto 8080');

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      try { ws.ping(); } catch (e) {}
    });
  }, 10000);

  wss.on('connection', (ws, req) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    let ipAsignada = null;
    const ipFisica = req.socket.remoteAddress.replace(/^.*:/, '');

    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message);
        if (data.action === 'REGISTER') {
          ipAsignada = ['1', '::1', 'localhost', '127.0.0.1'].includes(data.ip) ? '127.0.0.1' : data.ip;

          db.get("SELECT id, nombre FROM puestos WHERE ip_address = ?", [ipAsignada], (err, row) => {
            if (err || !row) return;

            const socketAnterior = clientesConectados.get(ipAsignada);
            if (socketAnterior && socketAnterior !== ws) {
              try { socketAnterior.terminate(); } catch (e) {}
            }

            clientesConectados.set(ipAsignada, ws);
            const ahora = new Date().toISOString();

            db.serialize(() => {
              db.run("BEGIN TRANSACTION");
              db.run("UPDATE puestos SET estado_actual = ?, ultima_conexion = ? WHERE id = ?", ['ON', ahora, row.id]);
              db.run("INSERT INTO historial_conexiones (puesto_id, evento, fecha_inicio) VALUES (?, 'ON', ?)", [row.id, ahora]);
              db.run("COMMIT", () => {
                console.log(`✅ Puesto conectado y registrado en vivo: ${row.nombre}`);
                notificarCambioRed();
              });
            });
          });
        }
      } catch (e) {}
    });

    ws.on('close', () => {
      if (!ipAsignada) return;
      clientesConectados.delete(ipAsignada);

      db.get("SELECT id FROM puestos WHERE ip_address = ?", [ipAsignada], (err, row) => {
        if (err || !row) return;
        const ahora = new Date().toISOString();

        db.get(
          `SELECT id, fecha_inicio FROM historial_conexiones WHERE puesto_id = ? AND evento = 'ON' AND fecha_fin IS NULL ORDER BY id DESC LIMIT 1`,
          [row.id],
          (err, log) => {
            if (!err && log) {
              const inicio = new Date(log.fecha_inicio).getTime();
              const fin = new Date(ahora).getTime();
              const duracion = Math.floor((fin - inicio) / 1000);
              db.run("UPDATE historial_conexiones SET fecha_fin = ?, duracion_segundos = ? WHERE id = ?", [ahora, duracion, log.id]);
            }
            db.run("UPDATE puestos SET estado_actual = ? WHERE id = ?", ['OFF', row.id]);
            notificarCambioRed();
          }
        );
      });
    });

    ws.on('error', () => { try { ws.terminate(); } catch (e) {} });
  });

  wss.on('close', () => clearInterval(interval));
}

// =========================================================================
// 4. VENTANA ELECTRON
// =========================================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280, height: 800, minWidth: 1024, minHeight: 720,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false }
  });

  if (app.isPackaged) mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  else mainWindow.loadURL('http://localhost:5173');

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  iniciarServidorWebSocket();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

// =========================================================================
// 5. IPC RUTAS
// =========================================================================
ipcMain.handle('puestos:listar', async () => {
  return new Promise((resolve) => {
    db.all("SELECT * FROM puestos ORDER BY id ASC", [], (err, filas) => {
      if (err) return resolve([]);
      const procesados = filas.map((puesto) => {
        const conectado = clientesConectados.has(puesto.ip_address);
        return {
          ...puesto,
          estado_red: conectado ? puesto.estado_actual : (puesto.estado_actual === 'ON' ? 'DESINCRONIZADO' : 'DESCONECTADO')
        };
      });
      resolve(procesados);
    });
  });
});

ipcMain.handle('puestos:crear', async (event, { nombre, ip_address, mac_address }) => {
  return new Promise((resolve) => {
    db.run("INSERT INTO puestos (nombre, ip_address, mac_address) VALUES (?, ?, ?)", [nombre, ip_address, mac_address], function (err) {
      if (err) resolve({ success: false, message: 'La IP ya está registrada.' });
      else resolve({ success: true, id: this.lastID });
    });
  });
});

ipcMain.handle('puestos:eliminar', async (event, id) => {
  return new Promise((resolve) => {
    db.run("DELETE FROM puestos WHERE id = ?", [id], (err) => resolve({ success: !err }));
  });
});

// Interruptor de Red 
ipcMain.handle('puestos:toggle-internet', async (event, id, estadoActual) => {
  return new Promise((resolve) => {
    db.get("SELECT * FROM puestos WHERE id = ?", [id], (err, puesto) => {
      if (err || !puesto) return resolve({ success: false, message: 'Puesto no encontrado.' });

      const ws = clientesConectados.get(puesto.ip_address);
      if (!ws) return resolve({ success: false, message: 'Terminal apagada o desconectada de la red LAN.' });

      const nuevoEstado = estadoActual === 'ON' ? 'OFF' : 'ON';
      const comando = JSON.stringify({ action: nuevoEstado === 'ON' ? 'BLOCK_OFF' : 'BLOCK_ON' });

      try {
        ws.send(comando); // Envia orden de firewall

        const ahora = new Date().toISOString();
        db.serialize(() => {
          db.run("BEGIN TRANSACTION");
          db.run("UPDATE puestos SET estado_actual = ?, ultima_conexion = ? WHERE id = ?", [nuevoEstado, ahora, id]);

          if (nuevoEstado === 'ON') {
            db.run("INSERT INTO historial_conexiones (puesto_id, evento, fecha_inicio) VALUES (?, 'ON', ?)", [id, ahora]);
          } else {
            db.get(
              "SELECT id, fecha_inicio FROM historial_conexiones WHERE puesto_id = ? AND evento = 'ON' AND fecha_fin IS NULL ORDER BY id DESC LIMIT 1",
              [id],
              (err, log) => {
                if (!err && log) {
                  const inicio = new Date(log.fecha_inicio);
                  const fin = new Date(ahora);
                  const segundos = Math.floor((fin - inicio) / 1000);
                  db.run("UPDATE historial_conexiones SET fecha_fin = ?, duracion_segundos = ? WHERE id = ?", [ahora, segundos, log.id]);
                }
              }
            );
          }
          db.run("COMMIT", () => {
            notificarCambioRed();
            resolve({ success: true });
          });
        });
      } catch (e) {
        resolve({ success: false, message: 'Error de transmisión.' });
      }
    });
  });
});

ipcMain.handle('auth:login', async (event, { username, password }) => {
  return new Promise((resolve) => {
    db.get("SELECT id, username, role FROM usuarios WHERE username = ? AND password = ?", [username, password], (err, row) => {
      resolve(row ? { success: true, user: row } : { success: false, message: 'Credenciales inválidas.' });
    });
  });
});

ipcMain.handle('usuarios:listar', async () => {
  return new Promise((resolve) => {
    db.all("SELECT id, username, role FROM usuarios ORDER BY id ASC", [], (err, filas) => resolve(err ? [] : filas));
  });
});

ipcMain.handle('usuarios:crear', async (event, { username, password, role }) => {
  return new Promise((resolve) => {
    db.run("INSERT INTO usuarios (username, password, role) VALUES (?, ?, ?)", [username, password, role], (err) => {
      resolve({ success: !err });
    });
  });
});

ipcMain.handle('usuarios:eliminar', async (event, id) => {
  return new Promise((resolve) => {
    db.run("DELETE FROM usuarios WHERE id = ?", [id], (err) => resolve({ success: !err }));
  });
});

ipcMain.handle('reportes:listar', async () => {
  return new Promise((resolve) => {
    db.all(`SELECT h.*, p.nombre as puesto_nombre FROM historial_conexiones h LEFT JOIN puestos p ON h.puesto_id = p.id ORDER BY h.id DESC`, [], (err, filas) => {
      resolve(err ? [] : filas);
    });
  });
});

// Reportes Exportar
ipcMain.handle('reportes:exportar', async (event, { fechaInicio, fechaFin, puestosFiltrados }) => {
  return new Promise((resolve) => {
    let query = `SELECT h.id, h.puesto_id, p.nombre AS puesto_nombre, h.evento, h.fecha_inicio, h.fecha_fin, h.duracion_segundos FROM historial_conexiones h LEFT JOIN puestos p ON h.puesto_id = p.id WHERE 1=1`;
    const params = [];

    if (fechaInicio) { query += " AND DATE(h.fecha_inicio) >= DATE(?)"; params.push(fechaInicio); }
    if (fechaFin) { query += " AND DATE(h.fecha_inicio) <= DATE(?)"; params.push(fechaFin); }
    if (puestosFiltrados && puestosFiltrados.length > 0) {
      query += ` AND h.puesto_id IN (${puestosFiltrados.map(() => '?').join(',')})`;
      puestosFiltrados.forEach(id => params.push(id));
    }
    query += " ORDER BY h.id DESC";

    db.all(query, params, async (err, filas) => {
      if (err || !filas || filas.length === 0) return resolve({ success: false, message: 'No hay datos para exportar.' });

      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Exportar Reporte',
        defaultPath: `Reporte_${new Date().toISOString().split('T')[0]}.csv`,
        filters: [{ name: 'Archivos CSV', extensions: ['csv'] }]
      });

      if (canceled || !filePath) return resolve({ success: true, message: 'Cancelado por el operador.' });

      try {
        let contenidoCSV = '\uFEFFID;Terminal;Fecha Inicio;Fecha Fin / Estado;Duración\n';
        filas.forEach((f) => {
          const id = `#${f.id}`;
          const nombre = f.puesto_nombre || `Puesto ID: ${f.puesto_id}`;
          const inicio = f.fecha_inicio ? new Date(f.fecha_inicio).toLocaleString('es-ES') : '-';
          
          let finEstado = '-';
          if (f.evento === 'FALLO_RED') finEstado = 'PÉRDIDA DE COMUNICACIÓN';
          else if (!f.fecha_fin) finEstado = 'Abierta Actualmente';
          else finEstado = new Date(f.fecha_fin).toLocaleString('es-ES');

          let duracion = 'En curso...';
          if (f.evento === 'FALLO_RED') duracion = 'Corte de red';
          else if (f.duracion_segundos !== null) {
            const h = Math.floor(f.duracion_segundos / 3600).toString().padStart(2, '0');
            const m = Math.floor((f.duracion_segundos % 3600) / 60).toString().padStart(2, '0');
            const s = (f.duracion_segundos % 60).toString().padStart(2, '0');
            duracion = `${h}:${m}:${s}`;
          }
          contenidoCSV += `${id};"${nombre}";${inicio};"${finEstado}";${duracion}\n`;
        });

        fs.writeFileSync(filePath, contenidoCSV, 'utf-8');
        resolve({ success: true, message: '¡Archivo exportado con éxito!' });
      } catch (error) {
        resolve({ success: false, message: 'Error físico de escritura.' });
      }
    });
  });
});