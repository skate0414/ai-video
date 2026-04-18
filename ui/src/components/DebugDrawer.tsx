import { useEffect, useCallback } from 'react';
import { ChevronDown } from 'lucide-react';
import { LogPanel } from './LogPanel';
import type { PipelineLogEntry } from '../types';

export function DebugDrawer({
  logs,
  open,
  onToggle,
}: {
  logs: PipelineLogEntry[];
  open: boolean;
  onToggle: () => void;
}) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'd') {
        e.preventDefault();
        onToggle();
      }
    },
    [onToggle],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div
      className={`border-t border-white/5 bg-[#0a0a0f] transition-all duration-200 ${open ? 'h-80' : 'h-8'}`}
    >
      <button
        className="w-full h-8 px-4 flex items-center justify-between text-zinc-500 hover:text-white transition-colors"
        onClick={onToggle}
      >
        <span className="flex items-center gap-1.5 font-mono text-[10px]">
          日志 ({logs.length})
          <kbd className="hidden sm:inline px-1 py-0.5 text-[9px] border border-zinc-700 rounded text-zinc-600">⌘D</kbd>
        </span>
        <ChevronDown
          size={12}
          className={`transition-transform ${open ? '' : 'rotate-180'}`}
        />
      </button>
      {open && (
        <div className="h-[calc(100%-2rem)] overflow-hidden">
          <LogPanel logs={logs} />
        </div>
      )}
    </div>
  );
}
