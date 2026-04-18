import type { ReactNode } from 'react';
import type { ProcessStatus } from '../types';

export { deriveActiveStage } from './stageUtils';

export interface ActionButton {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
  loading?: boolean;
}

const STATUS_STYLE: Record<ProcessStatus, { dot: string; text: string; label: string }> = {
  pending:    { dot: 'bg-zinc-600',   text: 'text-zinc-500',    label: '等待中' },
  processing: { dot: 'bg-white animate-pulse', text: 'text-zinc-300', label: '处理中' },
  completed:  { dot: 'bg-emerald-500', text: 'text-emerald-400', label: '已完成' },
  error:      { dot: 'bg-red-500',     text: 'text-red-400',     label: '错误' },
};

export function StageReviewShell({
  stageName,
  stageLabel,
  stageStatus,
  duration,
  issues,
  children,
}: {
  stageName: string;
  stageLabel: string;
  stageStatus: ProcessStatus;
  duration?: number;
  issues?: ReactNode;
  children: ReactNode;
}) {
  const s = STATUS_STYLE[stageStatus];

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Stage indicator */}
      <div className="flex items-center gap-2 px-1 py-2">
        <span className={`w-2 h-2 rounded-full ${s.dot}`} />
        <span className="text-xs text-zinc-500 uppercase tracking-wider">{stageLabel}</span>
        <span className={`text-xs ${s.text}`}>{s.label}</span>
        {duration != null && duration > 0 && (
          <span className="text-[10px] text-zinc-600 ml-1">
            · {duration < 60 ? `${Math.round(duration)}秒` : `${Math.floor(duration / 60)}分${Math.round(duration % 60)}秒`}
          </span>
        )}
      </div>

      {/* Main output area */}
      <div className="flex-1 overflow-auto px-2 py-2">
        {children}
      </div>

      {/* Issues area (conditional) */}
      {issues && (
        <div className="px-1 py-2 border-t border-zinc-800/50">
          {issues}
        </div>
      )}
    </div>
  );
}
