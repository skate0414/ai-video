import { Outlet, useNavigate, useLocation } from 'react-router-dom';
import { Film } from 'lucide-react';

export function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  // Hide top nav when inside a project route (ProjectLayout provides its own header)
  const isProjectRoute = /^\/[^/]+\/(style|script|storyboard|production|replay)/.test(location.pathname);

  return (
    <div className="flex flex-col h-screen bg-[#050505] text-zinc-100 font-sans selection:bg-indigo-500/30">
      {/* Top Navigation — hidden inside project pages */}
      {!isProjectRoute && (
        <nav className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-[#0a0a0f]/90 backdrop-blur-md h-11 shrink-0">
          <div className="w-full px-5 h-full flex items-center justify-between">
            <button
              onClick={() => navigate('/')}
              className="flex items-center gap-2.5 group cursor-pointer"
            >
              <div className="w-7 h-7 rounded-md bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
                <Film size={14} />
              </div>
              <span className="font-bold text-sm tracking-tight text-white leading-none">AI 视频工作台</span>
            </button>
          </div>
        </nav>
      )}

      {/* Main Content */}
      <main className="flex-1 overflow-auto relative">
        <Outlet />
      </main>
    </div>
  );
}
