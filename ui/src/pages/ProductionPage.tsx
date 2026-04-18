import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2, PartyPopper, Play, RotateCcw, Square, LayoutDashboard, History, Volume2, RefreshCw, ChevronDown, ChevronUp, Film, ImageIcon, Sliders } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { logger } from '../lib/logger';
import { VideoPlayer } from '../components/VideoPlayer';
import { StageReviewShell, deriveActiveStage } from '../components/StageReviewShell';
import { usePageGuard } from '../hooks/usePageGuard';
import { FloatingActionBar } from '../components/FloatingActionBar';
import type { ActionButton } from '../components/FloatingActionBar';
import { ConfirmModal } from '../components/ConfirmModal';
import { ScenePreviewModal } from '../components/ScenePreviewModal';
import { ArtifactReportPanel } from '../components/ArtifactReportPanel';
import { assetUrl } from '../lib/assetUrl';
import type { PipelineStage, PipelineScene } from '../types';

const PRODUCTION_STAGES = ['VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT'] as const;

const STAGE_NAME: Record<string, string> = {
  VIDEO_GEN: '视频生成', TTS: '语音合成', ASSEMBLY: '视频组装', REFINEMENT: '精修',
};



function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}秒`;
  return `${Math.floor(s / 60)}分${s % 60}秒`;
}

export function ProductionPage() {
  const guardReady = usePageGuard(['KEYFRAME_GEN']);
  const { current, startPipeline, stopPipeline, retryStage, regenerateScene } = useProject();
  const [startLoading, setStartLoading] = useState(false);
  const [stopLoading, setStopLoading] = useState(false);
  const [retryLoading, setRetryLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'rerun' | 'stop' | null>(null);
  const [scenesExpanded, setScenesExpanded] = useState(true);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [regeneratingScenes, setRegeneratingScenes] = useState<Set<string>>(new Set());
  const showReplayTools = import.meta.env.DEV;


  if (!current || !guardReady) return null;
  logger.debug('navigation', 'view_production', { projectId: current.id });

  const allDone = PRODUCTION_STAGES.every((s) => (current.stageStatus ?? {} as any)[s] === 'completed');
  const isRunning = PRODUCTION_STAGES.some((s) => (current.stageStatus ?? {} as any)[s] === 'processing');
  const hasError = PRODUCTION_STAGES.some((s) => (current.stageStatus ?? {} as any)[s] === 'error');
  const scenes = current.scenes ?? [];
  // Can start if pre-production stages (up to KEYFRAME_GEN) are done but production hasn't finished
  const preProductionDone = ['CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH', 'NARRATIVE_MAP',
    'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING', 'STORYBOARD', 'VIDEO_IR_COMPILE', 'REFERENCE_IMAGE', 'KEYFRAME_GEN',
  ].every((s) => (current.stageStatus ?? {} as any)[s as PipelineStage] === 'completed');
  const canStart = preProductionDone && !allDone && !isRunning;
  const failedStage = PRODUCTION_STAGES.find((s) => (current.stageStatus ?? {} as any)[s] === 'error');
  const { stageName, stageLabel, status: activeStatus } = deriveActiveStage(PRODUCTION_STAGES, current.stageStatus);

  const handleStart = async () => {
    setStartLoading(true);
    logger.info('user', 'start_production', { projectId: current.id });
    try { await startPipeline(current.id); } finally { setStartLoading(false); }
  };

  const handleRetry = async () => {
    if (!failedStage) return;
    setRetryLoading(true);
    logger.info('user', 'retry_production_stage', { projectId: current.id, stage: failedStage });
    try { await retryStage(current.id, failedStage); } finally { setRetryLoading(false); }
  };

  const handleStop = async () => {
    setStopLoading(true);
    logger.info('user', 'stop_production', { projectId: current.id });
    try { await stopPipeline(current.id); } finally { setStopLoading(false); }
  };

  const handleRegenerateScene = async (sceneId: string, feedback?: string) => {
    setRegeneratingScenes(prev => new Set([...prev, sceneId]));
    try { await regenerateScene(current.id, sceneId, feedback); } finally {
      setRegeneratingScenes(prev => { const next = new Set(prev); next.delete(sceneId); return next; });
    }
  };

  // Compute total duration from first to last log entry
  let totalDurationMs = 0;
  if (allDone && current.logs.length > 0) {
    const sorted = current.logs.map(l => new Date(l.timestamp).getTime()).sort((a, b) => a - b);
    totalDurationMs = sorted[sorted.length - 1] - sorted[0];
  }

  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();

  // Build FAB actions based on current state
  const fabActions: ActionButton[] = [];
  if (!isRunning && !allDone && !hasError) {
    if (canStart) {
      fabActions.push({ label: '开始生产', icon: <Play size={14} />, onClick: handleStart, loading: startLoading });
    } else {
      fabActions.push({ label: '开始生产', icon: <Play size={14} />, onClick: () => {}, disabled: true });
    }
  }
  if (isRunning) {
    fabActions.push({ label: '停止', icon: <Square size={14} />, onClick: () => setConfirmAction('stop'), variant: 'secondary', loading: stopLoading });
  }
  if (hasError && failedStage) {
    fabActions.push({ label: `重试 ${STAGE_NAME[failedStage] ?? failedStage}`, icon: <RotateCcw size={14} />, onClick: handleRetry, loading: retryLoading });
    fabActions.push({ label: '重新运行全部', icon: <Play size={14} />, onClick: () => setConfirmAction('rerun'), variant: 'secondary', loading: startLoading });
  }
  if (allDone) {
    fabActions.push({ label: '精修视频', icon: <Sliders size={14} />, onClick: () => navigate('../refine') });
    if (showReplayTools) {
      fabActions.push({ label: '查看回放', icon: <History size={14} />, onClick: () => navigate('../replay'), variant: 'secondary' });
    }
    fabActions.push({ label: '回到仪表盘', icon: <LayoutDashboard size={14} />, onClick: () => navigate('/'), variant: 'secondary' });
  }

  return (
    <div className="flex flex-col h-full">
      <StageReviewShell stageName={stageName} stageLabel={stageLabel} stageStatus={activeStatus}>
      <div className="space-y-4">

      {isRunning && (
        <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-xl border border-zinc-700/50 bg-zinc-800/50 text-zinc-300 text-sm">
          <div className="flex items-center gap-2">
            <Loader2 size={16} className="animate-spin" /> 视频制作中，请耐心等待...
          </div>
          {scenes.length > 0 && (
            <span className="text-xs text-zinc-400">
              {scenes.filter(s => s.status === 'done').length}/{scenes.length} 场景完成
            </span>
          )}
        </div>
      )}

      {hasError && failedStage && (
        <div className="flex items-center gap-1.5 px-4 py-3 rounded-xl border border-red-500/20 bg-red-500/5 text-sm text-red-400">
          <span className="w-2 h-2 rounded-full bg-red-400" />
          {STAGE_NAME[failedStage] ?? failedStage} 失败
        </div>
      )}

      <VideoPlayer project={current} />

      {allDone && (
        <div className="space-y-3 animate-fade-in">
          <div className="flex items-center gap-2 px-5 py-4 rounded-xl border border-emerald-500/30 bg-gradient-to-r from-emerald-500/10 via-emerald-500/5 to-emerald-500/3 text-emerald-400 text-sm font-semibold border-glow-emerald">
            <PartyPopper size={18} /> 所有流程已完成！{totalDurationMs > 0 && `总耗时 ${formatDuration(totalDurationMs)}。`}
          </div>
        </div>
      )}

      {/* Per-scene preview grid with TTS playback */}
      {scenes.length > 0 && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
          <button
            onClick={() => setScenesExpanded(!scenesExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition-colors"
          >
            <span className="flex items-center gap-2">
              <Film size={14} className="text-zinc-500" />
              🎬 场景详情（{scenes.length} 个场景）
            </span>
            {scenesExpanded ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
          </button>
          {scenesExpanded && (
            <div className="px-4 pb-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {scenes.map((scene) => {
                  const videoSrc = scene.assetUrl && scene.assetType === 'video' ? assetUrl(scene.assetUrl) : null;
                  const imageSrc = scene.assetUrl && scene.assetType === 'image' ? assetUrl(scene.assetUrl) : scene.referenceImageUrl ? assetUrl(scene.referenceImageUrl) : null;
                  const audioSrc = scene.audioUrl ? assetUrl(scene.audioUrl) : null;
                  const isGenerating = scene.status === 'generating' || scene.status === 'processing';

                  return (
                    <div
                      key={scene.id}
                      className="group rounded-xl border border-zinc-800 bg-zinc-900/30 overflow-hidden hover:border-zinc-700 transition-colors cursor-pointer"
                      onClick={() => setPreviewSceneId(scene.id)}
                    >
                      {/* Thumbnail area */}
                      <div className="relative aspect-video bg-black flex items-center justify-center overflow-hidden">
                        {videoSrc ? (
                          <video src={videoSrc} className="w-full h-full object-cover" controls muted preload="metadata" onClick={(e) => e.stopPropagation()} />
                        ) : imageSrc ? (
                          <img src={imageSrc} alt={`场景 ${scene.number}`} className="w-full h-full object-cover" />
                        ) : (
                          <ImageIcon size={24} className="text-zinc-700" />
                        )}
                        {/* Play icon overlay for videos without controls visible */}
                        {videoSrc && !isGenerating && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-60 group-hover:opacity-0 transition-opacity">
                            <div className="w-10 h-10 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                              <Play size={18} className="text-white ml-0.5" />
                            </div>
                          </div>
                        )}
                        {isGenerating && (
                          <div className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm">
                            <Loader2 size={20} className="text-indigo-400 animate-spin" />
                          </div>
                        )}
                        <div className="absolute top-2 left-2 flex items-center gap-1.5">
                          <span className="px-1.5 py-0.5 text-[10px] font-bold text-white bg-black/60 backdrop-blur-sm rounded">{scene.number.toString().padStart(2, '0')}</span>
                          <span className="px-1.5 py-0.5 text-[10px] font-mono text-zinc-300 bg-black/60 backdrop-blur-sm rounded">{scene.estimatedDuration}s</span>
                        </div>
                        {scene.status === 'done' && (
                          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-emerald-500" title="完成" />
                        )}
                        {scene.status === 'error' && (
                          <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" title="失败" />
                        )}
                      </div>

                      {/* Info area */}
                      <div className="p-3 space-y-2">
                        <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">{scene.narrative}</p>

                        {/* TTS audio player */}
                        {audioSrc && (
                          <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                            <Volume2 size={12} className="text-zinc-500 shrink-0" />
                            <audio controls preload="none" src={audioSrc} className="h-7 w-full [&::-webkit-media-controls-panel]:bg-zinc-800 [&::-webkit-media-controls-panel]:rounded-lg" />
                          </div>
                        )}

                        {/* Regen button */}
                        <button
                          disabled={regeneratingScenes.has(scene.id)}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRegenerateScene(scene.id);
                          }}
                          className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-zinc-700 rounded hover:bg-zinc-700 hover:text-zinc-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <RefreshCw size={10} className={regeneratingScenes.has(scene.id) ? 'animate-spin' : ''} /> {regeneratingScenes.has(scene.id) ? '生成中…' : '重新生成'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Scene Preview Modal (reused from StoryboardPage) */}
      {previewSceneId && scenes.length > 0 && (
        <ScenePreviewModal
          scenes={scenes}
          activeSceneId={previewSceneId}
          onClose={() => setPreviewSceneId(null)}
          onNavigate={(direction) => {
            if (!previewSceneId || !scenes.length) return;
            if (direction === 'next' || direction === 'prev') {
              const idx = scenes.findIndex((s) => s.id === previewSceneId);
              const next = direction === 'next' ? (idx + 1) % scenes.length : (idx - 1 + scenes.length) % scenes.length;
              setPreviewSceneId(scenes[next].id);
            } else {
              setPreviewSceneId(direction);
            }
          }}
          onRegenerate={(sceneId, feedback) => handleRegenerateScene(sceneId, feedback)}
          productionMode
        />
      )}
      {/* Quality reports */}
      <ArtifactReportPanel
        projectId={current.id}
        reports={[
          { filename: 'assembly-validation.json', label: '组装验证报告' },
          { filename: 'final-risk-gate.json', label: '最终风险评估' },
          { filename: 'refinement.json', label: '精修报告' },
        ]}
      />
      </div>
      </StageReviewShell>
      <FloatingActionBar
        hint={
          canStart && !hasError ? '前期准备已完成，点击开始生产视频'
          : !canStart && !isRunning && !allDone && !hasError ? `前置阶段尚未全部完成，请先完成分镜和关键帧生成`
          : isRunning ? `视频制作中… ${scenes.filter(s => s.status === 'done').length}/${scenes.length} 场景完成`
          : hasError && failedStage ? `${STAGE_NAME[failedStage] ?? failedStage} 失败，可以重试或重新运行`
          : allDone ? '制作完成！可以精修视频或下载'
          : undefined
        }
        actions={fabActions} />
      <ConfirmModal
        isOpen={confirmAction === 'rerun'}
        title="重新运行全部生产"
        description="这将丢弃当前所有已生成的视频、语音和合成结果，从头重新运行完整的生产流水线。此操作耗时较长且消耗计算资源。"
        confirmLabel="确认重新运行"
        variant="danger"
        onConfirm={() => { setConfirmAction(null); handleStart(); }}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmModal
        isOpen={confirmAction === 'stop'}
        title="停止生产"
        description="正在进行的视频生成将被中断，当前阶段进度将丢失。你可以之后重新启动。"
        confirmLabel="确认停止"
        variant="warning"
        onConfirm={() => { setConfirmAction(null); handleStop(); }}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
}
