import { CheckCircle, XCircle, RefreshCw } from 'lucide-react';
import type { PipelineScene } from '../types';

const STATUS_STYLES: Record<string, string> = {
  pending:   'border-zinc-700 bg-zinc-900/60',
  working:   'border-indigo-500/40 bg-indigo-500/5 ring-1 ring-indigo-500/20',
  done:      'border-emerald-500/30 bg-emerald-500/5',
  error:     'border-red-500/30 bg-red-500/5',
};

const STATUS_BADGE: Record<string, string> = {
  pending:   'bg-zinc-800 text-zinc-400 border-zinc-700',
  working:   'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  done:      'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  error:     'bg-red-500/15 text-red-400 border-red-500/30',
};

export function SceneGrid({ scenes, onRegenerate, onApprove, onReject }: {
  scenes: PipelineScene[];
  onRegenerate: (sceneId: string) => void;
  onApprove?: (sceneId: string) => void;
  onReject?: (sceneId: string) => void;
}) {
  if (!scenes?.length) return null;
  return (
    <div className="mt-4">
      <h4 className="text-sm font-semibold text-zinc-300 mb-3">🎞️ 场景</h4>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {scenes.map((scene) => (
          <div
            key={scene.id}
            className={`rounded-xl border p-3 transition-all hover:scale-[1.01] ${STATUS_STYLES[scene.status] ?? STATUS_STYLES.pending}`}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-zinc-200">场景 {scene.number}</span>
              <span className="text-[10px] font-mono text-zinc-500">{scene.estimatedDuration}s</span>
            </div>
            {scene.assetUrl && scene.assetType === 'image' && (
              <img
                src={scene.assetUrl}
                alt={`Scene ${scene.number}`}
                className="w-full h-32 object-cover rounded-lg mb-2 border border-zinc-700/50"
              />
            )}
            <p className="text-xs text-zinc-400 line-clamp-3 mb-3">{scene.narrative}</p>
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded border ${STATUS_BADGE[scene.status] ?? STATUS_BADGE.pending}`}>
                {scene.status}
              </span>
              {scene.reviewStatus === 'pending_review' && onApprove && onReject && (
                <>
                  <button
                    onClick={() => onApprove(scene.id)}
                    className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded hover:bg-emerald-500/20 transition-colors"
                  >
                    <CheckCircle size={10} /> 通过
                  </button>
                  <button
                    onClick={() => onReject(scene.id)}
                    className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors"
                  >
                    <XCircle size={10} /> 拒绝
                  </button>
                </>
              )}
              {(scene.status === 'done' || scene.status === 'error' || scene.reviewStatus === 'rejected') && (
                <button
                  onClick={() => onRegenerate(scene.id)}
                  className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-zinc-700 rounded hover:bg-zinc-700 transition-colors"
                >
                  <RefreshCw size={10} /> 重新生成
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
