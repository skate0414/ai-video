import { CheckCircle, XCircle, Loader2, Clock, RotateCcw } from 'lucide-react';
import type { PipelineStage, ProcessStatus } from '../types';

const STAGE_ORDER: PipelineStage[] = [
  'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH',
  'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW',
  'STORYBOARD', 'REFERENCE_IMAGE', 'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS',
  'ASSEMBLY', 'REFINEMENT',
];

export const STAGE_LABELS: Record<PipelineStage, string> = {
  CAPABILITY_ASSESSMENT: '🛡️ 能力评估',
  STYLE_EXTRACTION: '🔍 风格提取',
  RESEARCH: '📚 深度调研',
  NARRATIVE_MAP: '🗺️ 叙事地图',
  SCRIPT_GENERATION: '✍️ 脚本生成',
  QA_REVIEW: '✅ 质量审核',
  STORYBOARD: '🎨 分镜设计',
  REFERENCE_IMAGE: '🖼️ 参考图',
  KEYFRAME_GEN: '🎞️ 关键帧',
  VIDEO_GEN: '🎬 视频生成',
  TTS: '🔊 语音合成',
  ASSEMBLY: '🎥 视频合成',
  REFINEMENT: '🔧 精修',
};

const STATUS_CONFIG: Record<ProcessStatus, { icon: typeof Clock; color: string; bg: string; border: string }> = {
  pending:    { icon: Clock,       color: 'text-zinc-500', bg: 'bg-zinc-800',          border: 'border-zinc-700' },
  processing: { icon: Loader2,     color: 'text-indigo-400', bg: 'bg-indigo-500/15',   border: 'border-indigo-500/30' },
  completed:  { icon: CheckCircle, color: 'text-emerald-400', bg: 'bg-emerald-500/15', border: 'border-emerald-500/30' },
  error:      { icon: XCircle,     color: 'text-red-400', bg: 'bg-red-500/15',         border: 'border-red-500/30' },
};

export function StageTimeline({ stageStatus, onRetry }: {
  stageStatus: Record<PipelineStage, ProcessStatus>;
  onRetry: (stage: PipelineStage) => void;
}) {
  return (
    <div className="space-y-1">
      {STAGE_ORDER.map((stage, i) => {
        const status = stageStatus[stage];
        const cfg = STATUS_CONFIG[status];
        const Icon = cfg.icon;
        return (
          <div key={stage} className={`flex items-center gap-3 px-3 py-2 rounded-lg border ${cfg.bg} ${cfg.border}`}>
            <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${cfg.color} ${status === 'completed' ? 'bg-emerald-500/20' : 'bg-zinc-800'}`}>
              {i + 1}
            </div>
            <Icon size={14} className={`${cfg.color} ${status === 'processing' ? 'animate-spin' : ''}`} />
            <span className={`flex-1 text-sm ${cfg.color}`}>{STAGE_LABELS[stage]}</span>
            <span className={`text-[10px] uppercase tracking-wider font-bold ${cfg.color}`}>{status}</span>
            {status === 'error' && (
              <button
                onClick={() => onRetry(stage)}
                className="flex items-center gap-1 px-2 py-0.5 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
              >
                <RotateCcw size={10} /> 重试
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
