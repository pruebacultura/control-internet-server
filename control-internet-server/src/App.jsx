import React, { useState } from 'react';
import { Login } from './views/Login.jsx';
import { Dashboard } from './views/Dashboard.jsx';
import { Reportes } from './views/Reportes.jsx';
import { Usuarios } from './views/Usuarios.jsx';
import { LayoutDashboard, Users, FileBarChart, LogOut, Shield } from 'lucide-react';

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [vistaActual, setVistaActual] = useState('dashboard');

  if (!usuario) {
    return <Login onLoginSuccess={(user) => setUsuario(user)} />;
  }

  return (
    <div className="flex h-screen w-screen bg-slate-50 overflow-hidden">
      <aside className="w-64 bg-[#0b192f] text-slate-400 flex flex-col justify-between border-r border-slate-800 flex-shrink-0">
        <div>
          <div className="flex items-center gap-3 px-6 py-5 border-b border-slate-800 text-white">
            <Shield className="w-6 h-6 text-blue-500" />
            <span className="font-bold tracking-tight text-lg">NetManager</span>
          </div>

          <div className="px-6 py-4 bg-slate-900/40 border-b border-slate-800/60">
            <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Operador</p>
            <p className="text-sm font-medium text-slate-200 mt-0.5">{usuario.username}</p>
            <span className="inline-block px-2 py-0.5 text-[10px] font-bold uppercase rounded bg-blue-500/10 text-blue-400 border border-blue-500/20 mt-1">
              {usuario.role}
            </span>
          </div>

          <nav className="p-4 space-y-1.5">
            <button onClick={() => setVistaActual('dashboard')} className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${vistaActual === 'dashboard' ? 'bg-blue-600 text-white font-semibold' : 'hover:bg-slate-900 hover:text-slate-200'}`}>
              <LayoutDashboard className="w-5 h-5" />
              <span>Control de Puestos</span>
            </button>

            {usuario.role === 'admin' && (
              <button onClick={() => setVistaActual('usuarios')} className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${vistaActual === 'usuarios' ? 'bg-blue-600 text-white font-semibold' : 'hover:bg-slate-900 hover:text-slate-200'}`}>
                <Users className="w-5 h-5" />
                <span>Gestión de Usuarios</span>
              </button>
            )}

            <button onClick={() => setVistaActual('reportes')} className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all ${vistaActual === 'reportes' ? 'bg-blue-600 text-white font-semibold' : 'hover:bg-slate-900 hover:text-slate-200'}`}>
              <FileBarChart className="w-5 h-5" />
              <span>Auditoría y Reportes</span>
            </button>
          </nav>
        </div>

        <div className="p-4 border-t border-slate-800">
          <button onClick={() => setUsuario(null)} className="w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium hover:bg-red-500/10 text-slate-400 hover:text-red-400 transition-all">
            <LogOut className="w-5 h-5" />
            <span>Cerrar Sesión</span>
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 bg-slate-50 overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
          <h2 className="text-xl font-bold text-slate-800 capitalize tracking-tight">
            {vistaActual === 'dashboard' ? 'Panel de Control Remoto' : vistaActual === 'usuarios' ? 'Administración de Usuarios' : 'Reportes de Conectividad'}
          </h2>
        </header>

        <div className="flex-1 overflow-y-auto p-8">
          {vistaActual === 'dashboard' && <Dashboard />}
          {vistaActual === 'usuarios' && <Usuarios />}
          {vistaActual === 'reportes' && <Reportes />}
        </div>
      </main>
    </div>
  );
}