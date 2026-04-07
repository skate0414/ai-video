import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Settings, Film } from 'lucide-react';

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const isHome = location.pathname === '/';

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Top Navigation */}
      <nav className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-[#0a0a0f]/90 backdrop-blur-md h-14 shrink-0">
        <div className="w-full px-6 h-full flex items-center justify-between">
          <button
            onClick={() => navigate('/')}
            className={`flex items-center gap-3 group ${isHome ? '' : 'cursor-pointer'}`}
          >
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Film size={18} />
            </div>
            <div className="flex flex-col items-start">
              <span className="font-bold text-base tracking-tight text-white leading-none">AI 视频工作台</span>
              <span className="text-[9px] text-indigo-400 uppercase font-mono tracking-widest leading-none mt-0.5">Pipeline Studio</span>
            </div>
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="w-9 h-9 rounded-lg bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-700/50 flex items-center justify-center transition-colors"
            title="设置"
          >
            <Settings size={16} className="text-zinc-400" />
          </button>
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 overflow-auto relative">
        <Outlet />
      </main>
    </div>
  );
}
