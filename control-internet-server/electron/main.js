const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { WebSocketServer } = require('ws');

let mainWindow;
let wss;
const clientesConectados = new Map(); // Llave: IP (String), Valor: WebSocket

// =========================================================================
// 1. INICIALIZACIÓN DE LA BASE DE DATOS LOCAL (Blindaje Total de Datos)
// =========================================================================
// Forzamos una ruta física en la raíz del disco duro inmune a formateos de la app
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
    // Tabla de puestos/terminales
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

    // Tabla de historial comercial y auditoría de red
    db.run(`
      CREATE TABLE IF NOT EXISTS historial_conexiones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        puesto_id INTEGER NOT NULL,
        evento TEXT NOT NULL, -- 'ON', 'OFF', 'FALLO_RED'
        fecha_inicio TEXT NOT NULL,
        fecha_fin TEXT,
        duracion_segundos INTEGER,
        FOREIGN KEY(puesto_id) REFERENCES puestos(id) ON DELETE CASCADE
      )
    `);

    // Tabla de usuarios del sistema empresarial
    db.run(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'operador'
      )
    `, () => {
      // Insertar usuario administrador por defecto si no existe ninguno
      db.get("SELECT COUNT(*) as cuenta FROM usuarios", [], (err, row) => {
        if (!err && row.cuenta === 0) {
          db.run("INSERT INTO usuarios (username, password, role) VALUES ('admin', 'admin123', 'admin')");
          console.log('👤 Usuario administrador inicial creado (admin / admin123).');
        }
      });
    });
  });
}

// =========================================================================
// 2. FUNCIÓN DE REACCIÓN EN TIEMPO REAL (Notificar cambios a React)
// =========================================================================
function notificarCambioRed() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('network:status-changed');
  }
}

// =========================================================================
// 3. CONFIGURACIÓN DEL SERVIDOR WEBSOCKET (Comunicación con Daemons)
// =========================================================================
function heartbeat() {
  this.isAlive = true;
}

function iniciarServidorWebSocket() {
  wss = new WebSocketServer({ port: 8080 });

  console.log('📡 Servidor WebSocket escuchando en el puerto 8080');

  // =========================================================================
  // HEARTBEAT GLOBAL
  // =========================================================================

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {

      // Si no respondió al ping anterior -> matar socket
      if (ws.isAlive === false) {
        console.log('⚠️ Cliente muerto eliminado automáticamente');

        return ws.terminate();
      }

      ws.isAlive = false;

      try {
        ws.ping();
      } catch (e) {
        console.error(
          '❌ Error enviando ping:',
          e.message
        );
      }
    });
  }, 10000);

  // =========================================================================
  // NUEVA CONEXIÓN
  // =========================================================================

  wss.on('connection', (ws, req) => {

    ws.isAlive = true;

    ws.on('pong', heartbeat);

    let ipAsignada = null;

    const ipFisica = req.socket.remoteAddress.replace(/^.*:/, '');

    console.log(
      `📡 Conexión física entrante desde: ${ipFisica}`
    );

    // =====================================================================
    // MENSAJES
    // =====================================================================

    ws.on('message', (message) => {

      try {

        const data = JSON.parse(message);

        // ===============================================================
        // REGISTER
        // ===============================================================

        if (data.action === 'REGISTER') {

          let ipRecibida = data.ip;

          // Corrección localhost
          if (
            ipRecibida === '1' ||
            ipRecibida === '::1' ||
            ipRecibida === 'localhost' ||
            ipRecibida === '127.0.0.1'
          ) {
            ipAsignada = '127.0.0.1';
          } else {
            ipAsignada = ipRecibida;
          }

          console.log(
            `🔌 Registro solicitado para IP: ${ipAsignada}`
          );

          // ===========================================================
          // VALIDAR EN BD
          // ===========================================================

          db.get(
            "SELECT id, nombre FROM puestos WHERE ip_address = ?",
            [ipAsignada],
            (err, row) => {

              if (err) {
                console.error(
                  "❌ Error consultando BD:",
                  err.message
                );

                return;
              }

              if (!row) {
                console.warn(
                  `⚠️ Intento de conexión desde IP no registrada: ${ipAsignada}`
                );

                return;
              }

              // =======================================================
              // ELIMINAR SOCKET ANTERIOR SI EXISTE
              // =======================================================

              const socketAnterior =
                clientesConectados.get(ipAsignada);

              if (socketAnterior && socketAnterior !== ws) {

                console.log(
                  `⚠️ Socket anterior encontrado para ${ipAsignada}. Eliminando...`
                );

                try {
                  socketAnterior.terminate();
                } catch (e) {}
              }

              // =======================================================
              // REGISTRAR SOCKET NUEVO
              // =======================================================

              clientesConectados.set(ipAsignada, ws);

              const ahora = new Date().toISOString();

              db.serialize(() => {

                db.run("BEGIN TRANSACTION");

                // Estado ON
                db.run(
                  "UPDATE puestos SET estado_actual = ?, ultima_conexion = ? WHERE id = ?",
                  ['ON', ahora, row.id]
                );

                // Historial
                db.run(
                  "INSERT INTO historial_conexiones (puesto_id, evento, fecha_inicio) VALUES (?, 'ON', ?)",
                  [row.id, ahora]
                );

                db.run("COMMIT", (commitErr) => {

                  if (commitErr) {

                    console.error(
                      "❌ Error confirmando transacción:",
                      commitErr.message
                    );

                  } else {

                    console.log(
                      `✅ Puesto conectado: ${row.nombre} (${ipAsignada})`
                    );

                    notificarCambioRed();
                  }
                });
              });
            }
          );
        }

      } catch (e) {

        console.error(
          "❌ Error parseando mensaje:",
          e.message
        );
      }
    });

    // =====================================================================
    // SOCKET CERRADO
    // =====================================================================

    ws.on('close', () => {

      if (!ipAsignada) return;

      console.log(
        `❌ Daemon desconectado: ${ipAsignada}`
      );

      clientesConectados.delete(ipAsignada);

      db.get(
        "SELECT id FROM puestos WHERE ip_address = ?",
        [ipAsignada],
        (err, row) => {

          if (err || !row) return;

          const ahora = new Date().toISOString();

          db.get(
            `SELECT id, fecha_inicio
             FROM historial_conexiones
             WHERE puesto_id = ?
             AND evento = 'ON'
             AND fecha_fin IS NULL
             ORDER BY id DESC
             LIMIT 1`,
            [row.id],
            (err, log) => {

              if (!err && log) {

                const inicio =
                  new Date(log.fecha_inicio).getTime();

                const fin =
                  new Date(ahora).getTime();

                const duracion =
                  Math.floor((fin - inicio) / 1000);

                db.run(
                  `UPDATE historial_conexiones
                   SET fecha_fin = ?, duracion_segundos = ?
                   WHERE id = ?`,
                  [ahora, duracion, log.id]
                );
              }

              db.run(
                "UPDATE puestos SET estado_actual = ? WHERE id = ?",
                ['OFF', row.id]
              );

              notificarCambioRed();
            }
          );
        }
      );
    });

    // =====================================================================
    // ERROR
    // =====================================================================

    ws.on('error', (err) => {

      console.error(
        `❌ Error socket (${ipAsignada || 'No registrado'}):`,
        err.message
      );

      try {
        ws.terminate();
      } catch (e) {}
    });
  });

  // =========================================================================
  // LIMPIEZA
  // =========================================================================

  wss.on('close', () => {
    clearInterval(interval);
  });
}

// =========================================================================
// 4. CREACIÓN DE LA VENTANA PRINCIPAL DE APLICACIÓN (Electron)
// =========================================================================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  // DETERMINACIÓN INTELIGENTE DEL ENTORNO DE EJECUCIÓN
  // app.isPackaged devuelve True cuando el usuario está usando el instalador .exe
  if (app.isPackaged) {
    // Modo Producción: Carga el archivo compilado por Vite en la carpeta dist
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    // Modo Desarrollo: Carga el servidor local activo de Vite
    mainWindow.loadURL('http://localhost:5173');
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  iniciarServidorWebSocket();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// =========================================================================
// 5. ENRUTADORES IPC: MÓDULO DE PUESTOS Y CONEXIONES (Dashboard)
// =========================================================================

// Consulta enriquecida de puestos (Calcula el estado_red en tiempo real)
ipcMain.handle('puestos:listar', async () => {
  return new Promise((resolve) => {
    db.all("SELECT * FROM puestos ORDER BY id ASC", [], (err, filas) => {
      if (err) return resolve([]);
      
      const puestosProcesados = filas.map((puesto) => {
        const estaConectadoWS = clientesConectados.has(puesto.ip_address);
        let estadoRedCalculado = 'DESCONECTADO';

        if (estaConectadoWS) {
          estadoRedCalculado = puesto.estado_actual; // 'ON' u 'OFF'
        } else if (puesto.estado_actual === 'ON') {
          estadoRedCalculado = 'DESINCRONIZADO'; // Sesión colgada comercialmente sin red física
        }

        return {
          ...puesto,
          estado_red: estadoRedCalculado
        };
      });

      resolve(puestosProcesados);
    });
  });
});

ipcMain.handle('puestos:crear', async (event, { nombre, ip_address, mac_address }) => {
  return new Promise((resolve) => {
    db.run(
      "INSERT INTO puestos (nombre, ip_address, mac_address) VALUES (?, ?, ?)",
      [nombre, ip_address, mac_address],
      function (err) {
        if (err) resolve({ success: false, message: 'La IP ya está registrada o formato inválido.' });
        else resolve({ success: true, id: this.lastID });
      }
    );
  });
});

ipcMain.handle('puestos:eliminar', async (event, id) => {
  return new Promise((resolve) => {
    db.run("DELETE FROM puestos WHERE id = ?", [id], (err) => {
      if (err) resolve({ success: false, message: 'No se pudo eliminar de la BD.' });
      else resolve({ success: true });
    });
  });
});

// Interruptor de red comercial (Envía comandos de Firewall a través del WebSocket)
ipcMain.handle('puestos:toggle-internet', async (event, id, estadoActual) => {
  return new Promise((resolve) => {
    db.get("SELECT * FROM puestos WHERE id = ?", [id], (err, puesto) => {
      if (err || !puesto) return resolve({ success: false, message: 'Puesto no encontrado.' });

      const ws = clientesConectados.get(puesto.ip_address);
      if (!ws) {
        return resolve({ success: false, message: 'Imposible mandar comando: ¡El equipo está apagado o sin cable!' });
      }

      const nuevoEstado = estadoActual === 'ON' ? 'OFF' : 'ON';
      const comando = JSON.stringify({ action: nuevoEstado === 'ON' ? 'BLOCK_OFF' : 'BLOCK_ON' });

      try {
        ws.send(comando); // Orden directa al Firewall nativo de la terminal remota

        const ahora = new Date().toISOString();
        db.serialize(() => {
          db.run("BEGIN TRANSACTION");

          // Guardamos el cambio en la terminal
          db.run("UPDATE puestos SET estado_actual = ?, ultima_conexion = ? WHERE id = ?", [nuevoEstado, ahora, id]);

          if (nuevoEstado === 'ON') {
            // Se abre tiempo comercial: Creamos un registro nuevo de auditoría
            db.run("INSERT INTO historial_conexiones (puesto_id, evento, fecha_inicio) VALUES (?, 'ON', ?)", [id, ahora]);
          } else {
            // Se cierra tiempo comercial: Buscamos la sesión abierta para cerrarla y calcular duración
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
        resolve({ success: false, message: 'Error de transmisión en la red local.' });
      }
    });
  });
});

// =========================================================================
// 6. ENRUTADORES IPC: MÓDULO DE USUARIOS Y ACCESO (Login)
// =========================================================================
ipcMain.handle('auth:login', async (event, { username, password }) => {
  return new Promise((resolve) => {
    db.get("SELECT id, username, role FROM usuarios WHERE username = ? AND password = ?", [username, password], (err, row) => {
      if (err || !row) resolve({ success: false, message: 'Credenciales incorrectas.' });
      else resolve({ success: true, user: row });
    });
  });
});

ipcMain.handle('usuarios:listar', async () => {
  return new Promise((resolve) => {
    db.all("SELECT id, username, role FROM usuarios ORDER BY id ASC", [], (err, filas) => {
      resolve(err ? [] : filas);
    });
  });
});

ipcMain.handle('usuarios:crear', async (event, { username, password, role }) => {
  return new Promise((resolve) => {
    db.run("INSERT INTO usuarios (username, password, role) VALUES (?, ?, ?)", [username, password, role], (err) => {
      if (err) resolve({ success: false, message: 'El nombre de usuario ya está registrado.' });
      else resolve({ success: true });
    });
  });
});

ipcMain.handle('usuarios:eliminar', async (event, id) => {
  return new Promise((resolve) => {
    db.run("DELETE FROM usuarios WHERE id = ?", [id], (err) => {
      resolve(err ? { success: false } : { success: true });
    });
  });
});

// =========================================================================
// 7. ENRUTADORES IPC: MÓDULO DE AUDITORÍA Y EXPORTACIÓN A EXCEL
// =========================================================================
ipcMain.handle('reportes:listar', async () => {
  return new Promise((resolve) => {
    const sql = `
      SELECT h.*, p.nombre as puesto_nombre 
      FROM historial_conexiones h
      LEFT JOIN puestos p ON h.puesto_id = p.id
      ORDER BY h.id DESC
    `;
    db.all(sql, [], (err, filas) => {
      resolve(err ? [] : filas);
    });
  });
});

// Motor de Filtrado Avanzado y Descarga de Archivos
ipcMain.handle('reportes:exportar', async (event, { fechaInicio, fechaFin, puestosFiltrados }) => {
  return new Promise((resolve) => {
    let query = `
      SELECT h.id, h.puesto_id, p.nombre AS puesto_nombre, h.evento, h.fecha_inicio, h.fecha_fin, h.duracion_segundos 
      FROM historial_conexiones h
      LEFT JOIN puestos p ON h.puesto_id = p.id
      WHERE 1=1
    `;
    const params = [];

    // Filtros de fecha
    if (fechaInicio) {
      query += " AND DATE(h.fecha_inicio) >= DATE(?)";
      params.push(fechaInicio);
    }
    if (fechaFin) {
      query += " AND DATE(h.fecha_inicio) <= DATE(?)";
      params.push(fechaFin);
    }

    // Filtro Inyectado de Puestos Múltiples (Operador IN de SQL)
    if (puestosFiltrados && puestosFiltrados.length > 0) {
      const signosPregunta = puestosFiltrados.map(() => '?').join(',');
      query += ` AND h.puesto_id IN (${signosPregunta})`;
      puestosFiltrados.forEach(id => params.push(id));
    }

    query += " ORDER BY h.id DESC";

    db.all(query, params, async (err, filas) => {
      if (err) {
        return resolve({ success: false, message: 'Error interno al procesar la base de datos.' });
      }

      if (!filas || filas.length === 0) {
        return resolve({ success: false, message: 'No se encontraron registros para exportar con los filtros elegidos.' });
      }

      // Cuadro de diálogo de guardado del OS
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Exportar Reporte de Auditoría',
        defaultPath: `Reporte_NetManager_${new Date().toISOString().split('T')[0]}.csv`,
        filters: [
          { name: 'Archivos CSV (Separado por comas, compatible con Excel)', extensions: ['csv'] }
        ]
      });

      if (canceled || !filePath) {
        return resolve({ success: true, message: 'Exportación cancelada por el operador.' });
      }

      try {
        // Formato estructurado con caracteres BOM para admitir eñes y tildes directamente en Excel
        let contenidoCSV = '\uFEFFID;Terminal;Fecha Inicio;Fecha Fin / Estado;Duración\n';

        filas.forEach((f) => {
          const id = `#${f.id}`;
          const nombre = f.puesto_nombre || `Puesto ID: ${f.puesto_id}`;
          const inicio = f.fecha_inicio ? new Date(f.fecha_inicio).toLocaleString('es-ES') : '-';
          
          let finEstado = '-';
          if (f.evento === 'FALLO_RED') {
            finEstado = 'PÉRDIDA DE COMUNICACIÓN';
          } else if (!f.fecha_fin) {
            finEstado = 'Abierta Actualmente';
          } else {
            finEstado = new Date(f.fecha_fin).toLocaleString('es-ES');
          }

          let duracion = 'En curso...';
          if (f.evento === 'FALLO_RED') {
            duracion = 'Corte de red';
          } else if (f.duracion_segundos !== null) {
            const h = Math.floor(f.duracion_segundos / 3600).toString().padStart(2, '0');
            const m = Math.floor((f.duracion_segundos % 3600) / 60).toString().padStart(2, '0');
            const s = (f.duracion_segundos % 60).toString().padStart(2, '0');
            duracion = `${h}:${m}:${s}`;
          }

          // Punto y coma (;) asegura la separación automática de celdas en configuraciones en español
          contenidoCSV += `${id};"${nombre}";${inicio};"${finEstado}";${duracion}\n`;
        });

        fs.writeFileSync(filePath, contenidoCSV, 'utf-8');
        resolve({ success: true, message: '¡Archivo de auditoría exportado y guardado con éxito!' });

      } catch (error) {
        console.error(error);
        resolve({ success: false, message: 'Error físico de escritura: El archivo está abierto o el disco está protegido.' });
      }
    });
  });
});