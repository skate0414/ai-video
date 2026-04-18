import { useEffect, useState } from 'react';
import { api } from '../api/client';
import type { PipelineStage, ProcessStatus } from '../types';

const STAGE_LABELS: Record<PipelineStage, string> = {
  CAPABILITY_ASSESSMENT: '能力评估',
  STYLE_EXTRACTION: '风格提取',
  RESEARCH: '深度调研',
  NARRATIVE_MAP: '叙事地图',
  SCRIPT_GENERATION: '脚本生成',
  QA_REVIEW: '质量审核',
  TEMPORAL_PLANNING: '时间规划',
  STORYBOARD: '分镜设计',
  VIDEO_IR_COMPILE: '视频编译',
  REFERENCE_IMAGE: '参考图',
  KEYFRAME_GEN: '关键帧',
  VIDEO_GEN: '视频生成',
  TTS: '语音合成',
  ASSEMBLY: '视频合成',
  REFINEMENT: '精修',
};

const STATUS_STYLES: Record<ProcessStatus, string> = {
  pending: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  processing: 'bg-zinc-700/50 text-zinc-300 border-zinc-600/50 animate-pulse',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  error: 'bg-red-500/15 text-red-400 border-red-500/30',
};

function formatEta(ms: number): string {
  if (ms < 60_000) return '< 1 分钟';
  const mins = Math.ceil(ms / 60_000);
  return `约 ${mins} 分钟`;
}

export function SubStageProgress({ stages, stageStatus, projectId }: {
  stages: PipelineStage[];
  stageStatus: Record<PipelineStage, ProcessStatus>;
  projectId?: string;
}) {
  const ss = stageStatus ?? {} as Record<PipelineStage, ProcessStatus>;
  const completed = stages.filter((s) => ss[s] === 'completed').length;
  const isProcessing = stages.some((s) => ss[s] === 'processing');
  const pct = (completed / stages.length) * 100;

  const [eta, setEta] = useState<{ etaMs: number | null; confidence?: 'high' | 'low' } | null>(null);

  useEffect(() => {
    if (!projectId || !isProcessing) {
      setEta(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      api.getEta(projectId).then((data) => {
        if (!cancelled) setEta(data);
      }).catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [projectId, isProcessing, completed]);

  return (
    <div className="mb-6">
      {/* Progress bar */}
      <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-emerald-500 rounded-full transition-all duration-700 shadow-[0_0_8px_rgba(52,211,153,0.3)]"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* ETA indicator */}
      {isProcessing && eta?.etaMs != null && (
        <p className="text-xs text-zinc-500 mb-2">
          ⏳ 预计还需 {formatEta(eta.etaMs)}
          {eta.confidence === 'low' && ' (粗略估计)'}
        </p>
      )}
      {/* Stage chips */}
      <div className="flex flex-wrap gap-2">
        {stages.map((stage) => (
          <span
            key={stage}
            className={`px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider rounded-md border ${STATUS_STYLES[ss[stage]] ?? STATUS_STYLES.pending}`}
          >
            {STAGE_LABELS[stage]}
          </span>
        ))}
      </div>
    </div>
  );
}
