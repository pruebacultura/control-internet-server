const Service = require('node-windows').Service;
const path = require('path');
const { exec } = require('child_process');

// Configuración del servicio nativo
const svc = new Service({
  name: 'NetManagerClientDaemon',
  description: 'Servicio de fondo para el control remoto del firewall de internet de NetManager.',
  script: path.join(__dirname, 'client-daemon.js')
});

// Evento que se dispara cuando se termina de instalar
svc.on('install', () => {
  console.log('¡Servicio NetManagerClientDaemon registrado en el sistema!');
  
  // 🛡️ Comando para cambiar el tipo de inicio a AUTOMÁTICO
  // Nota: El espacio después de "start=" es OBLIGATORIO en los comandos 'sc' de Windows
  const cmdAutomatico = `sc config NetManagerClientDaemon start= auto`;
  
  // 🔄 Comando opcional para que Windows lo reinicie solo si el proceso llega a fallar o cerrarse por error
  const cmdRecuperacion = `sc failure NetManagerClientDaemon reset= 86400 actions= restart/5000`;

  console.log('Configurando tipo de inicio automático y auto-recuperación...');
  
  exec(cmdAutomatico, (err) => {
    if (err) {
      console.error('Error al configurar el inicio automático en Windows:', err);
    } else {
      console.log('✅ Configuración completada: Tipo de inicio establecido en AUTOMÁTICO.');
      
      // Aplicamos las reglas de recuperación tras asegurar el inicio automático
      exec(cmdRecuperacion, () => {
        console.log('🚀 Iniciando el servicio de fondo por primera vez...');
        svc.start();
      });
    }
  });
});

// Mensaje de diagnóstico por si ocurre un error durante el proceso de instalación
svc.on('alreadyinstalled', () => {
  console.warn('⚠️ El servicio ya se encuentra instalado en esta computadora.');
  console.log('Iniciando el servicio existente...');
  svc.start();
});

// Ejecuta la instalación
svc.install();