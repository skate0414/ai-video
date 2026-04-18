import type { PipelineStage, ProcessStatus } from '../types';

const ALL_STAGES: PipelineStage[] = [
  'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH', 'NARRATIVE_MAP',
  'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING', 'STORYBOARD', 'VIDEO_IR_COMPILE',
  'REFERENCE_IMAGE', 'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT',
];

const SEGMENT_COLORS: Record<ProcessStatus, string> = {
  pending:    'bg-zinc-700/60',
  processing: 'bg-white/80 animate-pulse',
  completed:  'bg-emerald-500',
  error:      'bg-red-500',
};

function formatEta(ms: number): string {
  if (ms < 60_000) return '< 1分';
  const mins = Math.ceil(ms / 60_000);
  return `~${mins}分`;
}

export function ProgressBar({
  stageStatus,
  etaMs,
}: {
  stageStatus: Record<PipelineStage, ProcessStatus>;
  etaMs?: number | null;
}) {
  const ss = stageStatus ?? {} as Record<PipelineStage, ProcessStatus>;
  const completed = ALL_STAGES.filter(s => ss[s] === 'completed').length;
  const isProcessing = ALL_STAGES.some(s => ss[s] === 'processing');

  return (
    <div className="flex items-center gap-2 min-w-0">
      <div className="flex gap-[2px] flex-1 min-w-[120px]">
        {ALL_STAGES.map((s, i) => (
          <div
            key={s}
            className={`h-1.5 flex-1 ${SEGMENT_COLORS[ss[s]] ?? SEGMENT_COLORS.pending} ${i === 0 ? 'rounded-l-full' : ''} ${i === ALL_STAGES.length - 1 ? 'rounded-r-full' : ''} transition-colors duration-500`}
          />
        ))}
      </div>
      <span className="text-[10px] text-zinc-500 font-mono whitespace-nowrap shrink-0">
        {completed}/{ALL_STAGES.length}
      </span>
      {isProcessing && etaMs != null && etaMs > 0 && (
        <span className="text-[9px] text-zinc-600 font-mono whitespace-nowrap shrink-0">
          {formatEta(etaMs)}
        </span>
      )}
    </div>
  );
}
