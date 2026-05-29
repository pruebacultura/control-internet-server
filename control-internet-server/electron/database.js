const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { app } = require('electron');

// Ubicación de la base de datos en la carpeta de datos de usuario de la app
const dbPath = path.join(app.getPath('userData'), 'control_internet.db');
const db = new sqlite3.Database(dbPath);

function inicializarBaseDeDatos() {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      // 1. Crear tabla de usuarios (Operadores)
      db.run(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE,
          password TEXT,
          role TEXT
        )
      `, (err) => {
        if (err) return reject(err);
      });

      // 2. Inyectar el usuario Administrador por defecto si la tabla está vacía
      db.get("SELECT COUNT(*) as count FROM usuarios", [], (err, row) => {
        if (err) return reject(err);
        
        if (row.count === 0) {
          db.run(
            "INSERT INTO usuarios (username, password, role) VALUES (?, ?, ?)",
            ['admin', '123123!!', 'admin'],
            (insertErr) => {
              if (insertErr) console.error("Error al crear usuario admin por defecto:", insertErr);
              else console.log("⚙️ Base de Datos: Usuario 'admin' creado con éxito.");
            }
          );
        }
      });

      // 3. Crear tabla de puestos de trabajo
      db.run(`
        CREATE TABLE IF NOT EXISTS puestos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          nombre TEXT UNIQUE,
          ip_address TEXT UNIQUE,
          mac_address TEXT UNIQUE,
          estado_actual TEXT DEFAULT 'OFF',
          ultima_conexion TEXT
        )
      `, (err) => {
        if (err) return reject(err);
      });

      // 4. Crear tabla de historial de conexiones (Auditoría Comercial)
      db.run(`
        CREATE TABLE IF NOT EXISTS historial_conexiones (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          puesto_id INTEGER,
          evento TEXT,
          fecha_inicio TEXT,
          fecha_fin TEXT,
          duracion_segundos INTEGER,
          FOREIGN KEY(puesto_id) REFERENCES puestos(id) ON DELETE CASCADE
        )
      `, (err) => {
        if (err) return reject(err);
        
        // Si todo se ejecutó en orden, resolvemos la Promesa
        console.log(`⚙️ Base de Datos conectada e inicializada en: ${dbPath}`);
        resolve();
      });
    });
  });
}

// Exportamos la función de inicio y la instancia activa para el main.js
module.exports = {
  inicializarBaseDeDatos,
  db
};