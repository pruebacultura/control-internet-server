import React, { useState, useEffect, useRef } from 'react';
import { Calendar, Clock, Monitor, RefreshCw, Activity, WifiOff, CheckCircle, FileSpreadsheet, X, ChevronDown } from 'lucide-react';

export function Reportes() {
  const [historial, setHistorial] = useState([]);
  const [puestosDisponibles, setPuestosDisponibles] = useState([]);
  const [cargando, setCargando] = useState(false);
  
  // Estados de filtros
  const [fechaInicio, setFechaInicio] = useState('');
  const [fechaFin, setFechaFin] = useState('');
  const [puestosSeleccionados, setPuestosSeleccionados] = useState([]); // Array de IDs seleccionados
  
  // UI States
  const [menuPuestosAbierto, setMenuPuestosAbierto] = useState(false);
  const [notificacion, setNotificacion] = useState({ mensaje: '', tipo: '' });
  const menuRef = useRef(null);

  const mostrarMensaje = (mensaje, tipo = 'success') => {
    setNotificacion({ mensaje, tipo });
    setTimeout(() => setNotificacion({ mensaje: '', tipo: '' }), 5000);
  };

  // Cargar datos iniciales
  const cargarDatos = async () => {
    setCargando(true);
    const apiSegura = window.api || globalThis.api;
    
    // 1. Cargar historial
    if (apiSegura?.getReportes) {
      const data = await apiSegura.getReportes();
      setHistorial(data);
    }
    
    // 2. Cargar catálogo de puestos para el filtro múltiple
    if (apiSegura?.getPuestos) {
      const listaPuestos = await apiSegura.getPuestos();
      setPuestosDisponibles(listaPuestos);
    }
    
    setCargando(false);
  };

  useEffect(() => {
    cargarDatos();

    // Cerrar el menú desplegable si hacen clic afuera
    const clickAfuera = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setMenuPuestosAbierto(false);
      }
    };
    document.addEventListener('mousedown', clickAfuera);
    return () => document.removeEventListener('mousedown', clickAfuera);
  }, []);

  // Manejar la selección/deselección en el selector múltiple
  const handleTogglePuestoFiltro = (id) => {
    if (puestosSeleccionados.includes(id)) {
      setPuestosSeleccionados(puestosSeleccionados.filter(item => item !== id));
    } else {
      setPuestosSeleccionados([...puestosSeleccionados, id]);
    }
  };

  const limpiarFiltros = () => {
    setFechaInicio('');
    setFechaFin('');
    setPuestosSeleccionados([]);
  };

  // 📥 EXPORTAR EXCEL CON TODOS LOS REGISTROS FILTRADOS
  const handleExportarExcel = async () => {
    const apiSegura = window.api || globalThis.api;
    if (!apiSegura?.exportarExcel) return;

    const respuesta = await apiSegura.exportarExcel({ 
      fechaInicio, 
      fechaFin, 
      puestosFiltrados: puestosSeleccionados 
    });
    
    if (respuesta.success) {
      mostrarMensaje(respuesta.message, 'success');
    } else {
      mostrarMensaje(respuesta.message, 'error');
    }
  };

  // 🔎 FILTRADO EN TIEMPO REAL (FRONTEND)
  const historialFiltrado = historial.filter((log) => {
    // Filtro por fechas
    if (log.fecha_inicio) {
      const fechaLog = log.fecha_inicio.split('T')[0];
      if (fechaInicio && fechaLog < fechaInicio) return false;
      if (fechaFin && fechaLog > fechaFin) return false;
    }
    // Filtro por selector múltiple de puestos
    if (puestosSeleccionados.length > 0 && !puestosSeleccionados.includes(log.puesto_id)) {
      return false;
    }
    return true;
  });

  // 🛑 LIMITACIÓN COMERCIAL: Solo se exponen los primeros 100 registros en la tabla visual
  const registrosVisuales = historialFiltrado.slice(0, 100);

  const formatDuracion = (totalSegundos, esFallo) => {
    if (esFallo) return 'Corte de red';
    if (!totalSegundos) return 'En curso...';
    const horas = Math.floor(totalSegundos / 3600).toString().padStart(2, '0');
    const minutos = Math.floor((totalSegundos % 3600) / 60).toString().padStart(2, '0');
    const segundos = (totalSegundos % 60).toString().padStart(2, '0');
    return `${horas}:${minutos}:${segundos}`;
  };

  const formatFecha = (isoString) => {
    if (!isoString) return '-';
    try {
      const fecha = new Date(isoString);
      return fecha.toLocaleString('es-ES', {
        day: '2-digit', month: '2-digit', year: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    } catch (e) { return isoString; }
  };

  return (
    <div className="flex-1 overflow-y-auto p-8 max-w-[1920px] mx-auto w-full relative">
      
      {/* Alerta de notificación flotante */}
      {notificacion.mensaje && (
        <div className={`fixed top-6 right-6 z-50 flex items-center gap-3 px-5 py-4 rounded-xl shadow-xl border animate-slide-in max-w-md ${
          notificacion.tipo === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-rose-50 border-rose-200 text-rose-800'
        }`}>
          <p className="text-sm font-bold tracking-tight">{notificacion.mensaje}</p>
        </div>
      )}

      {/* 🛠️ BARRA DE FILTROS AVANZADOS */}
      <section className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-end gap-4 flex-1">
          
          {/* Calendario Desde */}
          <div className="w-[160px]">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Desde Fecha</label>
            <input 
              type="date" 
              value={fechaInicio} 
              onChange={(e) => setFechaInicio(e.target.value)} 
              className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-blue-500 font-medium text-slate-700" 
            />
          </div>

          {/* Calendario Hasta */}
          <div className="w-[160px]">
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Hasta Fecha</label>
            <input 
              type="date" 
              value={fechaFin} 
              onChange={(e) => setFechaFin(e.target.value)} 
              className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm focus:outline-none focus:border-blue-500 font-medium text-slate-700" 
            />
          </div>

          {/* 🖥️ SELECTOR MÚLTIPLE NATIVO DE PUESTOS */}
          <div className="w-[240px] relative" ref={menuRef}>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Filtrar por Puestos</label>
            <button
              type="button"
              onClick={() => setMenuPuestosAbierto(!menuPuestosAbierto)}
              className="w-full px-4 py-2 bg-slate-50 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 flex items-center justify-between shadow-sm hover:bg-slate-100/50 transition-colors"
            >
              <span className="truncate">
                {puestosSeleccionados.length === 0 
                  ? 'Todos los puestos' 
                  : `${puestosSeleccionados.length} seleccionado(s)`}
              </span>
              <ChevronDown className={`w-4 h-4 text-slate-400 transition-transform duration-200 ${menuPuestosAbierto ? 'rotate-180' : ''}`} />
            </button>

            {/* Panel Desplegable Flotante */}
            {menuPuestosAbierto && (
              <div className="absolute left-0 right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-xl z-30 max-h-[220px] overflow-y-auto p-2 divide-y divide-slate-100">
                {puestosDisponibles.length === 0 ? (
                  <p className="text-xs text-slate-400 p-2 text-center">No hay terminales dadas de alta</p>
                ) : (
                  puestosDisponibles.map((p) => {
                    const chequeado = puestosSeleccionados.includes(p.id);
                    return (
                      <label 
                        key={p.id} 
                        className="flex items-center gap-3 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-lg cursor-pointer transition-colors select-none font-medium"
                      >
                        <input
                          type="checkbox"
                          checked={chequeado}
                          onChange={() => handleTogglePuestoFiltro(p.id)}
                          className="w-4 h-4 text-blue-600 border-slate-300 rounded focus:ring-blue-500"
                        />
                        <span className="truncate">{p.nombre}</span>
                      </label>
                    );
                  })
                )}
              </div>
            )}
          </div>

          {/* Botón de resetear filtros */}
          {(fechaInicio || fechaFin || puestosSeleccionados.length > 0) && (
            <button 
              onClick={limpiarFiltros}
              className="h-[38px] px-3 border border-slate-200 hover:bg-slate-50 text-slate-500 rounded-xl transition-all text-xs font-semibold flex items-center gap-1.5"
            >
              <X className="w-4 h-4" />
              <span>Limpiar Filtros</span>
            </button>
          )}
        </div>

        {/* Botón Exportación */}
        <button 
          onClick={handleExportarExcel}
          className="h-[40px] px-5 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-bold rounded-xl shadow-md transition-all active:scale-[0.98] flex items-center gap-2 select-none"
        >
          <FileSpreadsheet className="w-4 h-4" />
          <span>Exportar Todo a Excel</span>
        </button>
      </section>

      {/* 📊 TABLA OPERATIVA VISUAL */}
      <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100 bg-slate-50/50">
          <div className="flex items-center gap-2.5">
            <Activity className="w-5 h-5 text-blue-600" />
            <div>
              <h3 className="text-base font-bold text-slate-800 tracking-tight">
                Vista de Auditoría Visual
              </h3>
              <p className="text-xs text-slate-400 mt-0.5 font-medium">
                Mostrando {registrosVisuales.length} de {historialFiltrado.length} registros encontrados en base a los filtros.
              </p>
            </div>
          </div>
          <button 
            onClick={cargarDatos}
            disabled={cargando}
            className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-xl transition-all disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-400 text-[11px] uppercase font-bold tracking-wider bg-slate-50/30">
                <th className="px-6 py-3.5 font-bold">ID</th>
                <th className="px-6 py-3.5 font-bold">Identificador de Terminal</th>
                <th className="px-6 py-3.5 font-bold">Apertura / Evento</th>
                <th className="px-6 py-3.5 font-bold">Estado del Cierre</th>
                <th className="px-6 py-3.5 text-right font-bold">Duración Acumulada</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm">
              {registrosVisuales.length === 0 ? (
                <tr>
                  <td colSpan="5" className="text-center py-12 text-slate-400 font-medium">
                    No existen registros para los filtros seleccionados.
                  </td>
                </tr>
              ) : (
                registrosVisuales.map((log) => {
                  const activa = log.fecha_fin === null;
                  const esFalloRed = log.evento === 'FALLO_RED';

                  let rowBg = "hover:bg-slate-50/50";
                  if (esFalloRed) rowBg = "bg-rose-50/40 hover:bg-rose-50/60 transition-colors text-rose-900";

                  return (
                    <tr key={log.id} className={rowBg}>
                      <td className={`px-6 py-4 font-mono font-semibold ${esFalloRed ? 'text-rose-400' : 'text-slate-400'}`}>
                        #{log.id}
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2.5">
                          <div className={`p-1.5 rounded-lg border ${
                            esFalloRed ? 'bg-rose-100 text-rose-600 border-rose-200' 
                            : activa ? 'bg-emerald-50 text-emerald-600 border-emerald-100' 
                            : 'bg-slate-50 text-slate-500 border-slate-200'
                          }`}>
                            <Monitor className="w-4 h-4" />
                          </div>
                          <span className="font-bold">{log.puesto_nombre || `Puesto (ID: ${log.puesto_id})`}</span>
                        </div>
                      </td>
                      <td className="px-6 py-4 font-medium">
                        <div className="flex items-center gap-1.5">
                          <Calendar className={`w-3.5 h-3.5 ${esFalloRed ? 'text-rose-400' : 'text-slate-400'}`} />
                          {formatFecha(log.fecha_inicio)}
                        </div>
                      </td>
                      <td className="px-6 py-4 font-mono text-xs">
                        {esFalloRed ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-rose-100 text-rose-700 border border-rose-200">
                            <WifiOff className="w-3 h-3" /> PÉRDIDA DE COMUNICACIÓN
                          </span>
                        ) : activa ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200/60 animate-pulse">
                            <CheckCircle className="w-3 h-3" /> Abierta Actualmente
                          </span>
                        ) : (
                          <div className="flex items-center gap-1.5 font-sans text-slate-500">
                            <Calendar className="w-3.5 h-3.5 text-slate-400" />
                            {formatFecha(log.fecha_fin)}
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right font-mono font-bold">
                        <div className="inline-flex items-center gap-1.5 justify-end">
                          <Clock className={`w-3.5 h-3.5 ${esFalloRed ? 'text-rose-400' : activa ? 'text-emerald-500' : 'text-slate-400'}`} />
                          <span className={esFalloRed ? 'text-rose-700 font-bold' : activa ? 'text-emerald-700' : 'text-slate-600'}>
                            {formatDuracion(log.duracion_segundos, esFalloRed)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Alerta de limitación visual al fondo de la tabla si sobrepasa los 100 */}
        {historialFiltrado.length > 100 && (
          <div className="p-4 bg-slate-50 border-t border-slate-200 text-center text-xs font-semibold text-slate-500">
            ⚠️ La interfaz web solo muestra los últimos 100 registros para optimizar el rendimiento. Para analizar los {historialFiltrado.length} registros restantes, utiliza el botón superior de exportación a Excel.
          </div>
        )}
      </div>
    </div>
  );
}