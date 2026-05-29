import React, { useState, useEffect } from 'react';
import { Plus, Users, UserMinus, ShieldAlert, User, Key, ShieldCheck } from 'lucide-react';

export function Usuarios() {
  const [usuarios, setUsuarios] = useState([]);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('operador');
  const [error, setError] = useState('');

  const cargarUsuarios = async () => {
    const apiSegura = window.api || globalThis.api;
    if (apiSegura?.getUsuarios) {
      const lista = await apiSegura.getUsuarios();
      setUsuarios(lista);
    }
  };

  useEffect(() => {
    cargarUsuarios();
  }, []);

  const handleAgregarUsuario = async (e) => {
    e.preventDefault();
    setError('');

    if (!username.trim() || !password.trim()) {
      setError('Todos los campos son obligatorios.');
      return;
    }

    const apiSegura = window.api || globalThis.api;
    const res = await apiSegura.crearUsuario({ username, password, role });
    
    if (res.success) {
      setUsername(''); setPassword(''); setRole('operador');
      cargarUsuarios();
    } else {
      setError(res.message || 'Error al guardar el usuario.');
    }
  };

  const handleEliminarUsuario = async (id, targetName) => {
    if (targetName === 'admin') {
      alert('Por motivos de seguridad, no puedes eliminar el usuario "admin" del sistema.');
      return;
    }

    if (confirm(`¿Estás seguro de que deseas eliminar al usuario "${targetName}"? Perderá acceso inmediato.`)) {
      const apiSegura = window.api || globalThis.api;
      const res = await apiSegura.eliminarUsuario(id);
      if (res.success) cargarUsuarios();
    }
  };

  return (
    <div className="space-y-8">
      {/* Formulario de Alta */}
      <section className="bg-white border-2 border-slate-200 rounded-2xl p-6 shadow-sm">
        <div className="flex items-center gap-2.5 text-slate-800 mb-5">
          <Users className="w-5 h-5 text-blue-600" />
          <h3 className="text-base font-bold tracking-tight">Dar de Alta Nuevo Operador</h3>
        </div>

        {error && <p className="text-sm text-red-600 font-bold mb-4 bg-red-50 border border-red-200 p-2.5 rounded-xl">{error}</p>}

        <form onSubmit={handleAgregarUsuario} className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Usuario</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 text-sm focus:outline-none focus:border-blue-600 focus:bg-white transition-all" placeholder="Ej: marcos.lopez" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Contraseña</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 text-sm focus:outline-none focus:border-blue-600 focus:bg-white transition-all" placeholder="••••••••" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">Rol de Acceso</label>
            <select value={role} onChange={e => setRole(e.target.value)} className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-800 text-sm focus:outline-none focus:border-blue-600 focus:bg-white transition-all">
              <option value="operador">Operador (Sólo activa terminales)</option>
              <option value="admin">Administrador (Control total)</option>
            </select>
          </div>
          <button type="submit" className="flex items-center justify-center gap-2 py-2.5 px-4 bg-blue-700 hover:bg-blue-600 text-white text-sm font-bold rounded-xl shadow-md transition-all active:scale-[0.98]">
            <Plus className="w-4 h-4" />
            <span>Registrar Usuario</span>
          </button>
        </form>
      </section>

      {/* Listado de Operadores existentes */}
      <section className="bg-white border-2 border-slate-200 rounded-2xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-slate-500" />
          <h4 className="text-sm font-bold text-slate-700 uppercase tracking-wider">Usuarios Registrados ({usuarios.length})</h4>
        </div>
        <div className="divide-y divide-slate-200">
          {usuarios.map(user => (
            <div key={user.id} className="flex items-center justify-between p-5 hover:bg-slate-50/50 transition-colors">
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-slate-100 rounded-xl border border-slate-200 text-slate-600">
                  <User className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-bold text-slate-900">{user.username}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <ShieldCheck className={`w-3.5 h-3.5 ${user.role === 'admin' ? 'text-blue-500' : 'text-slate-400'}`} />
                    <span className={`text-xs font-semibold capitalize ${user.role === 'admin' ? 'text-blue-600 font-bold' : 'text-slate-500'}`}>
                      {user.role}
                    </span>
                  </div>
                </div>
              </div>
              
              <button 
                onClick={() => handleEliminarUsuario(user.id, user.username)}
                disabled={user.username === 'admin'}
                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 border border-transparent hover:border-red-200 rounded-xl transition-all disabled:opacity-30 disabled:pointer-events-none"
                aria-label="Eliminar usuario"
              >
                <UserMinus className="w-4 h-4" />
              </button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}