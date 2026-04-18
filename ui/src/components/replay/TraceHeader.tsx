import type { TraceReplayBundle } from '../../types';
import { Clock, AlertTriangle, CheckCircle, XCircle, Zap } from 'lucide-react';

function ms(v: number | undefined): string {
  if (v === undefined) return '-';
  if (v < 1000) return `${v}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function usd(v: number | undefined): string {
  if (v === undefined || v === 0) return '-';
  if (v < 0.001) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

const OUTCOME_STYLE: Record<string, { icon: React.ReactNode; color: string; bg: string; label: string }> = {
  success: { icon: <CheckCircle size={18} />, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', label: '成功' },
  error: { icon: <XCircle size={18} />, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', label: '失败' },
  aborted: { icon: <AlertTriangle size={18} />, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', label: '中止' },
  in_progress: { icon: <Clock size={18} />, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', label: '进行中' },
};

export function TraceHeader({ bundle }: { bundle: TraceReplayBundle }) {
  const style = OUTCOME_STYLE[bundle.outcome] ?? OUTCOME_STYLE.in_progress;

  return (
    <div className={`rounded-xl border p-4 ${style.bg}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className={style.color}>{style.icon}</span>
          <h2 className="text-lg font-semibold text-zinc-100">{bundle.topic}</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${style.bg} ${style.color} border`}>{style.label}</span>
        </div>
        <span className="text-xs text-zinc-500 font-mono">{bundle.traceId.slice(0, 16)}…</span>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
        <div>
          <span className="text-zinc-500">时长</span>
          <p className="text-zinc-200 font-medium flex items-center gap-1"><Clock size={14} />{ms(bundle.durationMs)}</p>
        </div>
        <div>
          <span className="text-zinc-500">阶段</span>
          <p className="text-zinc-200 font-medium">
            {bundle.totals.stagesCompleted} 完成
            {bundle.totals.stagesFailed > 0 && <span className="text-red-400 ml-1">/ {bundle.totals.stagesFailed} 失败</span>}
          </p>
        </div>
        <div>
          <span className="text-zinc-500">AI 调用</span>
          <p className="text-zinc-200 font-medium flex items-center gap-1"><Zap size={14} />{bundle.totals.llmCalls}</p>
        </div>
        <div>
          <span className="text-zinc-500">费用</span>
          <p className="text-zinc-200 font-medium">{usd(bundle.totals.costUsd)}</p>
        </div>
      </div>

      <div className="mt-3 flex gap-4 text-xs text-zinc-500">
        <span>质量: {bundle.qualityTier}</span>
        <span>开始: {new Date(bundle.startedAt).toLocaleString()}</span>
        {bundle.endedAt && <span>结束: {new Date(bundle.endedAt).toLocaleString()}</span>}
        {bundle.totals.retries > 0 && <span className="text-yellow-500">重试: {bundle.totals.retries}</span>}
      </div>
    </div>
  );
}
