import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';

export interface ActionButton {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
}

export function FloatingActionBar({ actions, hint }: { actions: ActionButton[]; hint?: string }) {
  if (actions.length === 0) return null;

  return (
    <div className="shrink-0 border-t border-white/5 bg-[#0a0a0f]/80 backdrop-blur-md">
      {hint && (
        <div className="text-center text-[11px] text-zinc-500 pt-2 px-6">{hint}</div>
      )}
      <div className="flex items-center justify-center gap-2 px-6 py-3">
        {actions.map((action, i) => {
          const isPrimary = action.variant !== 'secondary';
          return (
            <button
              key={i}
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              className={`
                inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium rounded-lg transition-all
                ${isPrimary
                  ? action.disabled
                    ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                    : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/25 hover:scale-[1.02]'
                  : action.disabled
                    ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                }
                disabled:opacity-60
              `}
            >
              {action.loading ? <Loader2 size={14} className="animate-spin" /> : action.icon}
              {action.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
