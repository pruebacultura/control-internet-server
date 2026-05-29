import React, { useState } from 'react';
import { Shield, Lock, User, AlertCircle, Loader2 } from 'lucide-react';

export function Login({ onLoginSuccess }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Por favor, completa todos los campos.');
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      // Intentamos leer el puente desde cualquier variante global de Electron
      const apiSegura = window.api || (window.electron && window.electron.api) || globalThis.api;
      
      if (!apiSegura) {
        setError('Error de comunicación: El puente IPC no está disponible en el navegador.');
        setIsLoading(false);
        return;
      }

      const respuesta = await apiSegura.login({ username, password });
      
      if (respuesta.success) {
        onLoginSuccess(respuesta.user);
      } else {
        setError(respuesta.message || 'Credenciales inválidas.');
      }
    } catch (err) {
      setError('Error crítico de conexión con el proceso principal.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full flex items-center justify-center bg-[#0b192f] overflow-hidden">
      <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] rounded-full bg-blue-600/10 blur-[120px] " />
      <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] rounded-full bg-cyan-500/10 blur-[120px]" />

      <div className="w-full max-w-md p-8 mx-4 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-xl shadow-2xl transition-all duration-300 transform hover:scale-[1.01]">
        
        <div className="flex flex-col items-center mb-8">
          <div className="p-4 bg-blue-500/10 rounded-2xl border border-blue-500/20 text-blue-500 mb-3">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Control de Red</h1>
          <p className="text-slate-400 text-sm mt-1">Plataforma de Control Centralizado</p>
        </div>

        {error && (
          <div className="flex items-center gap-3 p-3.5 mb-6 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm animate-fadeIn">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Usuario
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                <User className="w-5 h-5" />
              </span>
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={isLoading}
                className="w-full pl-11 pr-4 py-3 bg-slate-900/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base"
                placeholder="Ingresa tu usuario"
                autoFocus
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Contraseña
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3.5 text-slate-500">
                <Lock className="w-5 h-5" />
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                className="w-full pl-11 pr-4 py-3 bg-slate-900/50 border border-slate-700/50 rounded-xl text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 transition-all text-base"
                placeholder="••••••••"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full flex items-center justify-center py-3.5 px-4 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-600/50 text-white font-medium rounded-xl shadow-lg shadow-blue-600/20 transition-all active:scale-[0.98] disabled:pointer-events-none mt-2 text-base"
          >
            {isLoading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              'Iniciar Sesión'
            )}
          </button>
        </form>
      </div>
    </div>
  );
}