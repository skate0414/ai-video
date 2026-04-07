import { useState } from 'react';
import { Save, SkipForward, CheckCircle, Image } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { SubStageProgress } from '../components/SubStageProgress';
import { SceneGrid } from '../components/SceneGrid';
import type { PipelineScene } from '../types';

const STORYBOARD_STAGES = ['STORYBOARD', 'REFERENCE_IMAGE', 'KEYFRAME_GEN'] as const;

export function StoryboardPage() {
  const { current, resumePipeline, updateScenes, regenerateScene, approveScene, rejectScene, approveReferenceImages } = useProject();
  const [editingScenes, setEditingScenes] = useState<PipelineScene[] | null>(null);

  if (!current) return null;

  const isPaused = current.isPaused;
  const pausedAt = current.pausedAtStage;
  const allDone = STORYBOARD_STAGES.every((s) => current.stageStatus[s] === 'completed');

  const handleSaveScenes = async () => {
    if (editingScenes) {
      await updateScenes(current.id, editingScenes);
      setEditingScenes(null);
    }
  };

  const handleResume = async () => {
    await resumePipeline(current.id);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-zinc-100">🎨 视觉设计</h3>
      <SubStageProgress stages={[...STORYBOARD_STAGES]} stageStatus={current.stageStatus} />

      {/* Scene editor */}
      {isPaused && pausedAt === 'STORYBOARD' && current.scenes && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
          <h4 className="text-sm font-semibold text-zinc-200">🎨 分镜编辑器</h4>
          <p className="text-xs text-zinc-500">审核并修改各场景的视觉提示词，满意后点击"保存并继续"</p>
          <div className="space-y-3">
            {(editingScenes ?? current.scenes).map((scene, idx) => (
              <div key={scene.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-bold text-zinc-200">场景 {scene.number}</span>
                  <span className="text-[10px] font-mono text-zinc-500">{scene.estimatedDuration}s</span>
                </div>
                <div>
                  <label className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">旁白文本</label>
                  <textarea
                    rows={3}
                    value={scene.narrative}
                    onChange={(e) => {
                      const updated = [...(editingScenes ?? current.scenes!)];
                      updated[idx] = { ...updated[idx], narrative: e.target.value };
                      setEditingScenes(updated);
                    }}
                    className="mt-1 w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                  />
                </div>
                <div>
                  <label className="text-[11px] font-medium text-zinc-500 uppercase tracking-wider">视觉提示词</label>
                  <textarea
                    rows={3}
                    value={scene.visualPrompt}
                    onChange={(e) => {
                      const updated = [...(editingScenes ?? current.scenes!)];
                      updated[idx] = { ...updated[idx], visualPrompt: e.target.value };
                      setEditingScenes(updated);
                    }}
                    className="mt-1 w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                  />
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { await handleSaveScenes(); await handleResume(); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
            >
              <Save size={14} /> 保存并继续
            </button>
            <button
              onClick={handleResume}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors"
            >
              <SkipForward size={14} /> 跳过编辑，继续
            </button>
          </div>
        </div>
      )}

      {/* Reference Image review */}
      {isPaused && pausedAt === 'REFERENCE_IMAGE' && current.scenes && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
          <h4 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
            <Image size={14} /> 参考图审核
          </h4>
          <p className="text-xs text-zinc-500">以下是生成的风格锚定参考图，确认风格一致性后继续</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {current.scenes.filter((s) => s.referenceImageUrl).map((scene) => (
              <div key={scene.id} className="rounded-lg border border-zinc-800 overflow-hidden bg-zinc-900/40">
                <img src={scene.referenceImageUrl} alt={`场景 ${scene.number} 参考图`} className="w-full h-32 object-cover" />
                <span className="block text-center text-[11px] text-zinc-500 py-1.5">场景 {scene.number}</span>
              </div>
            ))}
            {current.referenceImages?.map((img: string, i: number) => (
              <div key={`ref-${i}`} className="rounded-lg border border-zinc-800 overflow-hidden bg-zinc-900/40">
                <img src={img} alt={`参考图 ${i + 1}`} className="w-full h-32 object-cover" />
              </div>
            ))}
          </div>
          <button
            onClick={() => approveReferenceImages(current.id)}
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
          >
            <CheckCircle size={14} /> 确认风格，继续生成
          </button>
        </div>
      )}

      <SceneGrid
        scenes={current.scenes ?? []}
        onRegenerate={(sceneId) => regenerateScene(current.id, sceneId)}
        onApprove={(sceneId) => approveScene(current.id, sceneId)}
        onReject={(sceneId) => rejectScene(current.id, sceneId)}
      />

      {allDone && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-sm font-medium">
          <CheckCircle size={16} /> 视觉设计已完成 — 可进入下一步
        </div>
      )}
    </div>
  );
}
