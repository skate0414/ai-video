import { useRef, useMemo, useState, type ReactNode } from 'react';
import type { PipelineLogEntry } from '../types';

const ADAPTER_RE = /ChatAdapter|GeminiAdapter|FallbackAdapter|edge-tts|free tier|balanced|premium|api adapter|chat adapter|quota|fallback/i;

const STAGE_FILTERS = [
  { value: '', label: '全部' },
  { value: 'CAPABILITY_ASSESSMENT', label: '评估' },
  { value: 'STYLE_EXTRACTION', label: '风格' },
  { value: 'RESEARCH', label: '调研' },
  { value: 'NARRATIVE_MAP', label: '叙事' },
  { value: 'SCRIPT_GENERATION', label: '脚本' },
  { value: 'QA_REVIEW', label: '审核' },
  { value: 'TEMPORAL_PLANNING', label: '时间' },
  { value: 'STORYBOARD', label: '分镜' },
  { value: 'VIDEO_IR_COMPILE', label: '编译' },
  { value: 'REFERENCE_IMAGE', label: '参考图' },
  { value: 'KEYFRAME_GEN', label: '关键帧' },
  { value: 'VIDEO_GEN', label: '视频' },
  { value: 'TTS', label: '语音' },
  { value: 'ASSEMBLY', label: '合成' },
  { value: 'REFINEMENT', label: '精修' },
];

function formatMessage(msg: string): ReactNode {
  if (!ADAPTER_RE.test(msg)) return <>{msg}</>;
  const splitRe = /(ChatAdapter|GeminiAdapter|FallbackAdapter|edge-tts|free tier|balanced|premium|api adapter|chat adapter|quota|fallback)/gi;
  const parts = msg.split(splitRe);
  return (
    <>
      {parts.map((part, i) => 
        ADAPTER_RE.test(part)
          ? <span key={i} className="px-1 rounded bg-indigo-500/15 text-indigo-400 font-semibold">{part}</span>
          : part
      )}
    </>
  );
}

export function LogPanel({ logs }: { logs: PipelineLogEntry[] }) {
  const endRef = useRef<HTMLDivElement>(null);
  const [stageFilter, setStageFilter] = useState('');

  const filtered = useMemo(() => {
    if (!stageFilter) return logs;
    return logs.filter((l) => l.stage === stageFilter);
  }, [logs, stageFilter]);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-1.5 overflow-x-auto shrink-0">
        {STAGE_FILTERS.map((f) => {
          const count = f.value ? logs.filter(l => l.stage === f.value).length : logs.length;
          return (
            <button
              key={f.value}
              className={`px-2 py-0.5 text-[11px] font-bold uppercase tracking-wider rounded whitespace-nowrap transition-colors
                ${stageFilter === f.value
                  ? 'bg-zinc-700/50 text-zinc-200 border border-zinc-600/50'
                  : 'text-zinc-600 hover:text-zinc-400 border border-transparent'
                }`}
              onClick={() => setStageFilter(f.value)}
            >
              {f.label}{count > 0 && stageFilter !== f.value ? <span className="ml-1 text-zinc-600">{count}</span> : null}
            </button>
          );
        })}
      </div>
      <div className="flex-1 overflow-y-auto px-4 pb-2 font-mono text-xs">
        {filtered.map((log) => {
          const color = log.type === 'error' ? 'text-red-400' : log.type === 'success' ? 'text-emerald-400' : log.type === 'warning' ? 'text-amber-400' : 'text-zinc-300';
          const isError = log.type === 'error';
          return (
            <div key={log.id} className={`flex gap-3 py-0.5 ${color} hover:bg-white/[0.02] rounded-sm transition-colors ${isError ? 'border-l-2 border-l-red-500 pl-2' : ''}`}>
              <span className="text-zinc-500 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
              {log.stage && <span className="text-zinc-500 font-semibold shrink-0">[{log.stage}]</span>}
              <span>{formatMessage(log.message)}</span>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>
    </div>
  );
}
