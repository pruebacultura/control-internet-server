const { contextBridge, ipcRenderer } = require('electron');

try {
  contextBridge.exposeInMainWorld('api', {
    // 👥 ABM USUARIOS
    getUsuarios: () => ipcRenderer.invoke('usuarios:listar'),
    crearUsuario: (usuario) => ipcRenderer.invoke('usuarios:crear', usuario),
    eliminarUsuario: (id) => ipcRenderer.invoke('usuarios:eliminar', id),

    // 📊 AUDITORÍA Y REPORTES
    getReportes: () => ipcRenderer.invoke('reportes:listar'),

    // 🔒 AUTENTICACIÓN
    login: (credenciales) => ipcRenderer.invoke('auth:login', credenciales),
  
    // 🖥️ ABM PUESTOS DE TRABAJO
    getPuestos: () => ipcRenderer.invoke('puestos:listar'),
    crearPuesto: (puesto) => ipcRenderer.invoke('puestos:crear', puesto),
    eliminarPuesto: (id) => ipcRenderer.invoke('puestos:eliminar', id),
  
    // 🔌 CONTROL DE RED
    toggleInternet: (id, estado) => ipcRenderer.invoke('puestos:toggle-internet', id, estado),

    // 📡 ESCUCHADOR EN TIEMPO REAL: Suscribe a React a los cambios de conexión/desconexión
    onEstadoRedCambiado: (callback) => {
      ipcRenderer.on('network:status-changed', () => callback());
      return () => ipcRenderer.removeAllListeners('network:status-changed');
    }
  });
  console.log("ContextBridge: 'window.api' inyectado de forma segura.");
} catch (error) {
  console.error("Error al inicializar ContextBridge:", error);
}