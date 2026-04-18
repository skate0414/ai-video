import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

export function TrackPanel({ title, icon, children, defaultOpen = false }: {
  title: string; icon: string; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center gap-3 px-5 py-3.5 text-left hover:bg-zinc-800/40 transition-colors">
        <span>{icon}</span>
        <span className="text-sm font-bold text-white flex-1">{title}</span>
        {open ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
      </button>
      {open && <div className="px-5 pb-5 border-t border-zinc-800 pt-4">{children}</div>}
    </div>
  );
}
