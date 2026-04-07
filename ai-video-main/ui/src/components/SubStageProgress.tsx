import type { PipelineStage, ProcessStatus } from '../types';

const STAGE_LABELS: Record<PipelineStage, string> = {
  CAPABILITY_ASSESSMENT: '能力评估',
  STYLE_EXTRACTION: '风格提取',
  RESEARCH: '深度调研',
  NARRATIVE_MAP: '叙事地图',
  SCRIPT_GENERATION: '脚本生成',
  QA_REVIEW: '质量审核',
  STORYBOARD: '分镜设计',
  REFERENCE_IMAGE: '参考图',
  KEYFRAME_GEN: '关键帧',
  VIDEO_GEN: '视频生成',
  TTS: '语音合成',
  ASSEMBLY: '视频合成',
  REFINEMENT: '精修',
};

const STATUS_STYLES: Record<ProcessStatus, string> = {
  pending: 'bg-zinc-800 text-zinc-500 border-zinc-700',
  processing: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30 animate-pulse',
  completed: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  error: 'bg-red-500/15 text-red-400 border-red-500/30',
};

export function SubStageProgress({ stages, stageStatus }: {
  stages: PipelineStage[];
  stageStatus: Record<PipelineStage, ProcessStatus>;
}) {
  const completed = stages.filter((s) => stageStatus[s] === 'completed').length;
  const pct = (completed / stages.length) * 100;

  return (
    <div className="mb-6">
      {/* Progress bar */}
      <div className="h-1 w-full bg-zinc-800 rounded-full overflow-hidden mb-3">
        <div
          className="h-full bg-gradient-to-r from-indigo-500 to-emerald-500 rounded-full transition-all duration-700"
          style={{ width: `${pct}%` }}
        />
      </div>
      {/* Stage chips */}
      <div className="flex flex-wrap gap-1.5">
        {stages.map((stage) => (
          <span
            key={stage}
            className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border ${STATUS_STYLES[stageStatus[stage]]}`}
          >
            {STAGE_LABELS[stage]}
          </span>
        ))}
      </div>
    </div>
  );
}
