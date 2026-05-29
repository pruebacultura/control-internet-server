import React, { useState, useEffect } from 'react';
import { Plus, Monitor, Activity, Trash2, Cpu, Network, AlertTriangle, CheckCircle, WifiOff, RefreshCw } from 'lucide-react';

// =========================================================================
// SUBCOMPONENTE: TARJETA DEL PUESTO DE TRABAJO (Estructura Adaptada a Tiempo Real)
// =========================================================================
function PuestoCard({ puesto, onToggle, onEliminar }) {
  const [cronometro, setCronometro] = useState('00:00:00');

  useEffect(() => {
    let intervalo = null;

    if (puesto.estado_actual === 'ON' && puesto.ultima_conexion) {
      intervalo = setInterval(() => {
        const inicio = new Date(puesto.ultima_conexion).getTime();
        const ahora = Date.now();
        const diferencia = ahora - inicio;

        if (diferencia > 0) {
          const horas = Math.floor(diferencia / 3600000).toString().padStart(2, '0');
          const minutos = Math.floor((diferencia % 3600000) / 60000).toString().padStart(2, '0');
          const segundos = Math.floor((diferencia % 60000) / 1000).toString().padStart(2, '0');
          setCronometro(`${horas}:${minutos}:${segundos}`);
        }
      }, 1000);
    } else {
      setCronometro('00:00:00');
    }

    return () => {
      if (intervalo) clearInterval(intervalo);
    };
  }, [puesto.estado_actual, puesto.ultima_conexion]);

  // 🎨 Determinamos estilos dinámicos basados en "estado_red" (enviado por el nuevo main.js)
  let bgClass = "bg-white border-slate-200/80 shadow-sm";
  let statusBadge = null;
  let disabledAction = false;

  if (puesto.estado_red === 'ON') {
    bgClass = "bg-emerald-50/40 border-emerald-200 shadow-md shadow-emerald-500/5";
    statusBadge = (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
        <CheckCircle className="w-3.5 h-3.5" /> En línea (Habilitado)
      </span>
    );
  } else if (puesto.estado_red === 'OFF') {
    bgClass = "bg-slate-50/80 border-slate-300 shadow-sm";
    statusBadge = (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-slate-200 text-slate-700 border border-slate-300">
        <Network className="w-3.5 h-3.5" /> En línea (Bloqueado)
      </span>
    );
  } else if (puesto.estado_red === 'DESINCRONIZADO') {
    bgClass = "bg-amber-50/50 border-amber-300 shadow-md";
    statusBadge = (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200 animate-pulse">
        <AlertTriangle className="w-3.5 h-3.5" /> Sesión Colgada (Sin Red)
      </span>
    );
    disabledAction = true; // Frenamos clicks accidentales comerciales
  } else {
    // DESCONECTADO (Apagada o Cable desconectado)
    bgClass = "bg-slate-100 border-slate-200 opacity-75 shadow-none";
    statusBadge = (
      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold bg-slate-200 text-slate-400 border border-slate-300">
        <WifiOff className="w-3.5 h-3.5" /> Desconectado / Apagado
      </span>
    );
    disabledAction = true; // Frenamos clicks accidentales comerciales
  }

  return (
    <div className={`flex flex-col h-[230px] rounded-2xl border p-5 transition-all duration-200 ${bgClass}`}>
      <div className="flex items-start justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`p-3 rounded-xl border flex-shrink-0 ${puesto.estado_red === 'ON' ? 'bg-emerald-500 border-emerald-600 text-white' : puesto.estado_red === 'DESINCRONIZADO' ? 'bg-amber-500 border-amber-600 text-white' : 'bg-slate-800 border-slate-900 text-slate-400'}`}>
            <Monitor className="w-5 h-5" />
          </div>
          <div className="min-w-0">
            <h4 className="text-base font-bold text-slate-900 truncate tracking-tight">{puesto.nombre}</h4>
            <p className="text-xs font-mono text-slate-400 truncate tracking-tight mt-0.5">{puesto.ip_address}</p>
          </div>
        </div>
        
        <button 
          onClick={() => onEliminar(puesto.id, puesto.nombre)}
          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-100 rounded-xl transition-all flex-shrink-0"
          aria-label="Eliminar puesto de trabajo"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 flex flex-col justify-center min-h-0 py-2">
        <div className="flex items-baseline gap-1.5 justify-center font-mono font-bold tracking-tight">
          <span className={`text-3xl ${puesto.estado_actual === 'ON' ? 'text-emerald-600' : 'text-slate-400'}`}>
            {cronometro}
          </span>
        </div>
        <p className="text-[10px] uppercase font-bold tracking-wider text-slate-400 text-center mt-1">Tiempo de uso</p>
      </div>

      <div className="flex items-center justify-between gap-3 mt-4 pt-4 border-t border-slate-200/60 flex-shrink-0">
        {statusBadge}

        <button
          onClick={() => onToggle(puesto.id, puesto.estado_actual)}
          disabled={disabledAction}
          className={`px-4 py-2 text-xs font-bold rounded-xl shadow-sm transition-all select-none ${
            disabledAction 
              ? 'bg-slate-200 text-slate-400 cursor-not-allowed shadow-none' 
              : puesto.estado_actual === 'ON'
                ? 'bg-red-600 hover:bg-red-500 text-white active:scale-[0.98]'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white active:scale-[0.98]'
          }`}
        >
          {puesto.estado_actual === 'ON' ? 'Cerrar Conexión' : 'Habilitar Red'}
        </button>
      </div>
    </div>
  );
}

// =========================================================================
// COMPONENTE PRINCIPAL: DASHBOARD CONTROLLER
// =========================================================================
export function Dashboard() {
  const [puestos, setPuestos] = useState([]);
  const [nombre, setNombre] = useState('');
  const [ipAddress, setIpAddress] = useState('');
  const [macAddress, setMacAddress] = useState('');
  const [error, setError] = useState('');
  const [notificacion, setNotificacion] = useState({ mensaje: '', tipo: '' });

  const mostrarMensajeTemp = (mensaje, tipo = 'error') => {
    setNotificacion({ mensaje, tipo });
    setTimeout(() => setNotificacion({ mensaje: '', tipo: '' }), 6000);
  };

  const cargarPuestos = async () => {
    const apiSegura = window.api || globalThis.api;
    if (apiSegura?.getPuestos) {
      const lista = await apiSegura.getPuestos();
      setPuestos(lista);
    }
  };

  // 📡 INTEGRACIÓN DE EVENTOS EN TIEMPO REAL
  useEffect(() => {
    cargarPuestos(); // Carga inicial al montar la vista

    const apiSegura = window.api || globalThis.api;
    
    // Si nuestro nuevo escuchador está expuesto en el preload, nos suscribimos
    if (apiSegura?.onEstadoRedCambiado) {
      const desuscribir = apiSegura.onEstadoRedCambiado(() => {
        console.log("📡 Cambio de conectividad detectado en red local. Refrescando...");
        cargarPuestos(); // Vuelve a consultar de fondo y repinta la UI sin parpadeos
      });

      return () => desuscribir(); // Limpieza al desmontar el componente
    }
  }, []);

  const handleAgregarPuesto = async (e) => {
    e.preventDefault();
    setError('');

    if (!nombre.trim() || !ipAddress.trim() || !macAddress.trim()) {
      setError('Todos los campos de red son obligatorios.');
      return;
    }

    const apiSegura = window.api || globalThis.api;
    const res = await apiSegura.crearPuesto({ nombre, ip_address: ipAddress, mac_address: macAddress });
    
    if (res.success) {
      setNombre(''); setIpAddress(''); setMacAddress('');
      cargarPuestos();
    } else {
      setError(res.message || 'Error de base de datos.');
    }
  };

  const handleEliminarPuesto = async (id, nombrePuesto) => {
    if (!window.confirm(`¿Estás completamente seguro de dar de baja la terminal "${nombrePuesto}"?`)) return;
    
    const apiSegura = window.api || globalThis.api;
    const res = await apiSegura.eliminarPuesto(id);
    if (res.success) {
      cargarPuestos();
    } else {
      mostrarMensajeTemp(res.message || 'No se pudo eliminar el puesto.');
    }
  };

const handleToggleInternet = async (puestoId, estadoActual) => {
  const apiSegura = window.api || globalThis.api;
  
  // Usar la función que ya existe en tu preload (toggleInternet)
  // la cual llama internamente a 'puestos:toggle-internet'
  const res = await apiSegura.toggleInternet(puestoId, estadoActual);
  
  if (res.success) {
    cargarPuestos();
  } else {
    mostrarMensajeTemp(res.message, 'error');
  }
};

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-[1920px] mx-auto w-full">
      {/* Notificación Flotante Protectora */}
      {notificacion.mensaje && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-xl border animate-slide-in max-w-md ${
          notificacion.tipo === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${notificacion.tipo === 'success' ? 'text-emerald-600' : 'text-rose-600'}`} />
          <p className="text-sm font-bold tracking-tight">{notificacion.mensaje}</p>
        </div>
      )}

      {/* Panel Superior: Registrar Puesto */}
      <section className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm mb-8">
        <div className="flex items-center gap-2.5 text-slate-800 mb-5">
          <Network className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-bold tracking-tight">Dar de Alta Terminal Operativa</h3>
        </div>
        
        <form onSubmit={handleAgregarPuesto} className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Identificador (Ej: Puesto 01)</label>
            <input type="text" value={nombre} onChange={(e) => setNombre(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-blue-500" placeholder="Nombre identificativo" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Dirección IP Estática</label>
            <input type="text" value={ipAddress} onChange={(e) => setIpAddress(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-blue-500 font-mono" placeholder="192.168.1.XX" />
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Dirección MAC Física</label>
            <input type="text" value={macAddress} onChange={(e) => setMacAddress(e.target.value)} className="w-full px-4 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-blue-500 font-mono" placeholder="00:1A:2B:3C:4D:5E" />
          </div>
          
          <button type="submit" className="h-[42px] px-6 bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold rounded-xl shadow-md transition-all active:scale-[0.98] flex items-center gap-2">
            <Plus className="w-4 h-4" />
            <span>Registrar Terminal</span>
          </button>
        </form>
        {error && <p className="text-xs font-bold text-red-600 mt-3 flex items-center gap-1.5"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>}
      </section>

      {/* Grilla Operativa */}
      <section>
        <div className="flex items-center justify-between text-slate-800 mb-5">
          <div className="flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold tracking-tight">Terminales en Red Local ({puestos.length})</h3>
          </div>
          <button 
            onClick={cargarPuestos} 
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all"
            title="Refrescar lista manualmente"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {puestos.length === 0 ? (
          <div className="text-center py-16 bg-white border-2 border-slate-300 border-dashed rounded-2xl">
            <Cpu className="w-10 h-10 text-slate-400 mx-auto mb-3" />
            <p className="text-sm font-bold text-slate-500">No hay puestos registrados en el sistema.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-3 2xl:grid-cols-4 3xl:grid-cols-5 gap-6">
            {puestos.map((puesto) => (
              <PuestoCard 
                key={puesto.id} 
                puesto={puesto} 
                onToggle={handleToggleInternet}
                onEliminar={handleEliminarPuesto}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}