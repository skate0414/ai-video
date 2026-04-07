import { Loader2, PartyPopper, CheckCircle } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { SubStageProgress } from '../components/SubStageProgress';
import { VideoPlayer } from '../components/VideoPlayer';

const PRODUCTION_STAGES = ['VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT'] as const;

export function ProductionPage() {
  const { current } = useProject();

  if (!current) return null;

  const allDone = PRODUCTION_STAGES.every((s) => current.stageStatus[s] === 'completed');
  const isRunning = PRODUCTION_STAGES.some((s) => current.stageStatus[s] === 'processing');

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-zinc-100">🎬 制作交付</h3>
      <SubStageProgress stages={[...PRODUCTION_STAGES]} stageStatus={current.stageStatus} />

      {isRunning && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-indigo-500/20 bg-indigo-500/5 text-indigo-400 text-sm">
          <Loader2 size={16} className="animate-spin" /> 视频制作中，请耐心等待...
        </div>
      )}

      <VideoPlayer project={current} />

      {allDone && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-sm font-medium">
          <PartyPopper size={16} /> 所有流程已完成！视频已生成。
        </div>
      )}
    </div>
  );
}
