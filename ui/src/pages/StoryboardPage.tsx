import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle, Image, RotateCcw, ArrowRight, Palette, Edit3, Loader2, Sparkles, ChevronDown, ChevronUp, ClipboardList } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { logger } from '../lib/logger';
import { SceneGrid } from '../components/SceneGrid';
import { ScenePreviewModal } from '../components/ScenePreviewModal';
import { AnchorModal } from '../components/AnchorModal';
import { FloatingActionBar } from '../components/FloatingActionBar';
import { StageReviewShell, deriveActiveStage } from '../components/StageReviewShell';
import { ConfirmModal } from '../components/ConfirmModal';
import { ArtifactReportPanel } from '../components/ArtifactReportPanel';
import { useAutoSave } from '../hooks/useAutoSave';
import { usePageGuard } from '../hooks/usePageGuard';
import { useAsyncAction } from '../hooks/useAsyncAction';
import type { PipelineScene } from '../types';
import { assetUrl } from '../lib/assetUrl';
import { api } from '../api/client';

const STORYBOARD_STAGES = ['STORYBOARD', 'VIDEO_IR_COMPILE', 'REFERENCE_IMAGE', 'KEYFRAME_GEN'] as const;

/* ---- VideoIR Production Plan Preview ---- */

interface VideoIRScene {
  sceneNumber?: number;
  durationSec?: number;
  assetType?: string;
  narrative?: string;
  cameraMotion?: string;
}

function ProductionPlanPreview({ projectId, visible }: { projectId: string; visible: boolean }) {
  const [videoIR, setVideoIR] = useState<{ scenes?: VideoIRScene[]; totalDurationSec?: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!visible || loaded.current) return;
    api.loadArtifact<{ scenes?: VideoIRScene[]; totalDurationSec?: number }>(projectId, 'video-ir.cir.json')
      .then((data) => { loaded.current = true; setVideoIR(data); })
      .catch(() => {});
  }, [projectId, visible]);

  if (!videoIR?.scenes?.length) return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <ClipboardList size={14} className="text-zinc-500" />
          📋 生产计划预览
          <span className="text-[10px] font-mono text-zinc-500">
            {videoIR.scenes.length} 场景
            {videoIR.totalDurationSec ? ` · ${videoIR.totalDurationSec.toFixed(1)}s` : ''}
          </span>
        </span>
        {expanded ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4">
          <div className="rounded-lg border border-zinc-800 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-zinc-800/50 text-zinc-400 border-b border-zinc-800">
                  <th className="px-3 py-2 text-left font-semibold">#</th>
                  <th className="px-3 py-2 text-left font-semibold">时长</th>
                  <th className="px-3 py-2 text-left font-semibold">资产类型</th>
                  <th className="px-3 py-2 text-left font-semibold">镜头运动</th>
                  <th className="px-3 py-2 text-left font-semibold">旁白</th>
                </tr>
              </thead>
              <tbody>
                {videoIR.scenes.map((s, i) => (
                  <tr key={i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                    <td className="px-3 py-2 font-mono text-zinc-400">{(s.sceneNumber ?? i + 1).toString().padStart(2, '0')}</td>
                    <td className="px-3 py-2 font-mono text-indigo-400">{s.durationSec != null ? `${s.durationSec}s` : '-'}</td>
                    <td className="px-3 py-2">
                      <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-zinc-300 text-[10px] font-bold uppercase">
                        {s.assetType ?? 'video'}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{s.cameraMotion ?? '-'}</td>
                    <td className="px-3 py-2 text-zinc-300 max-w-[200px] truncate" title={s.narrative}>{s.narrative ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export function StoryboardPage() {
  const guardReady = usePageGuard(['QA_REVIEW']);
  const { current, resumePipeline, updateScenes, regenerateScene, approveScene, rejectScene, approveReferenceImages, retryStage, setStyleProfile } = useProject();
  const navigate = useNavigate();
  const draftKey = current?.id ? `scenes-${current.id}` : 'scenes-new';
  const [editingScenes, setEditingScenes, hasDraft, clearDraft] = useAutoSave<PipelineScene[] | null>(draftKey, null);
  const [previewSceneId, setPreviewSceneId] = useState<string | null>(null);
  const [showAnchorModal, setShowAnchorModal] = useState(false);
  const [approving, setApproving] = useState(false);
  const [showRetryConfirm, setShowRetryConfirm] = useState(false);
  const [rejectingSceneId, setRejectingSceneId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');

  const isPaused = current?.isPaused;
  const pausedAt = current?.pausedAtStage;

  if (!current || !guardReady) return null;

  const handleApproveReference = async () => {
    if (approving) return;
    setApproving(true);
    try { await approveReferenceImages(current.id); } finally { setApproving(false); }
  };

  const allDone = STORYBOARD_STAGES.every((s) => (current.stageStatus ?? {} as any)[s] === 'completed');
  const runningStage = STORYBOARD_STAGES.find((s) => (current.stageStatus ?? {} as any)[s] === 'processing');
  const scenes = current.scenes ?? [];
  const { stageName, stageLabel, status: activeStatus } = deriveActiveStage(STORYBOARD_STAGES, current.stageStatus);

  const handlePreviewNavigate = (direction: 'next' | 'prev' | string) => {
    if (!previewSceneId || !scenes.length) return;
    if (direction === 'next' || direction === 'prev') {
      const idx = scenes.findIndex((s) => s.id === previewSceneId);
      const next = direction === 'next' ? (idx + 1) % scenes.length : (idx - 1 + scenes.length) % scenes.length;
      setPreviewSceneId(scenes[next].id);
    } else {
      setPreviewSceneId(direction); // direct scene id
    }
  };

  /** Single smart action: persist any draft edits, then resume the pipeline */
  const [handleConfirmAndContinue, confirming] = useAsyncAction(async () => {
    if (editingScenes) {
      logger.info('user', 'save_scenes', { projectId: current.id, sceneCount: editingScenes.length });
      await updateScenes(current.id, editingScenes);
      clearDraft();
      setEditingScenes(null);
    }
    logger.info('user', 'resume_pipeline', { projectId: current.id, from: 'storyboard' });
    await resumePipeline(current.id);
  });

  const handleSaveScene = (sceneId: string, updates: { narrative?: string; visualPrompt?: string }) => {
    const base = editingScenes ?? [...(current.scenes ?? [])];
    const idx = base.findIndex((s) => s.id === sceneId);
    if (idx === -1) return;
    const updated = [...base];
    updated[idx] = { ...updated[idx], ...updates };
    setEditingScenes(updated);
  };

  // Resolve scenes: prefer draft edits, fall back to current project scenes
  const displayScenes = editingScenes ?? scenes;

  return (
    <div className="flex flex-col h-full">
      <StageReviewShell stageName={stageName} stageLabel={stageLabel} stageStatus={activeStatus}>
      <div className="space-y-4">

      {/* Processing banner — shown when a stage is actively running */}
      {!isPaused && runningStage && (
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20">
              <Loader2 size={18} className="text-amber-400 animate-spin" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-zinc-200">
                {runningStage === 'STORYBOARD' && '🎬 正在生成分镜…'}
                {runningStage === 'REFERENCE_IMAGE' && '🖼️ 正在生成风格参考图…'}
                {runningStage === 'KEYFRAME_GEN' && '🎨 正在生成关键帧…'}
              </h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {runningStage === 'STORYBOARD' && '正在分解脚本为视觉场景，请稍候'}
                {runningStage === 'REFERENCE_IMAGE' && `正在为 ${scenes.length > 0 ? scenes.length : ''} 个场景生成参考图`}
                {runningStage === 'KEYFRAME_GEN' && `正在生成高质量关键帧 · ${scenes.filter(s => s.assetUrl).length}/${scenes.length} 完成`}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Completion banner — all storyboard stages done */}
      {allDone && !isPaused && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
              <Sparkles size={18} className="text-emerald-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-zinc-200">✨ 视觉设计完成</h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {scenes.length} 个场景已全部生成 · 可以继续到制作阶段
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Compact storyboard banner — replaces the old flat textarea list */}
      {isPaused && pausedAt === 'STORYBOARD' && current.scenes && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
              <Edit3 size={18} className="text-indigo-400" />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-zinc-200">🎨 审核分镜</h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                {scenes.length} 个场景 · 点击卡片查看和编辑旁白与提示词
                {hasDraft && editingScenes ? ' · 有未保存的修改' : ''}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Reference Image review — compact card with AnchorModal */}
      {isPaused && pausedAt === 'REFERENCE_IMAGE' && current.scenes && (
        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-4">
          <div className="flex items-center gap-3">
            <div className="flex -space-x-3">
              {current.scenes.filter((s) => s.referenceImageUrl).slice(0, 3).map((s) => (
                <img
                  key={s.id}
                  src={assetUrl(s.referenceImageUrl)}
                  alt={`场景 ${s.number}`}
                  className="w-12 h-12 rounded-lg object-cover border-2 border-zinc-900"
                />
              ))}
            </div>
            <div>
              <h4 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                <Palette size={14} className="text-indigo-400" /> 风格参考图已生成
              </h4>
              <p className="text-[11px] text-zinc-500 mt-0.5">
                已生成 {current.scenes.filter((s) => s.referenceImageUrl).length} 张样本 · 确认后将为全部 {scenes.length} 个场景生成图片
              </p>
            </div>
            <button
              onClick={() => setShowAnchorModal(true)}
              className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 hover:text-zinc-200 transition-colors"
            >
              <Image size={12} /> 查看详情
            </button>
          </div>
        </div>
      )}

      {/* AnchorModal */}
      <AnchorModal
        isOpen={showAnchorModal}
        onClose={() => setShowAnchorModal(false)}
        scenes={scenes}
        referenceImages={current.referenceImages as string[] | undefined}
        styleProfile={(current.styleProfile as Record<string, unknown>) ?? null}
        onApprove={() => { handleApproveReference(); setShowAnchorModal(false); }}
        onRetry={() => setShowRetryConfirm(true)}
        onUpdateStyleProfile={(profile) => setStyleProfile(current.id, { styleProfile: profile })}
      />

      <SceneGrid
        scenes={displayScenes}
        onRegenerate={(sceneId, feedback) => regenerateScene(current.id, sceneId, feedback)}
        onApprove={(sceneId) => approveScene(current.id, sceneId)}
        onReject={(sceneId) => { setRejectingSceneId(sceneId); setRejectionReason(''); }}
        onSceneClick={(sceneId) => setPreviewSceneId(sceneId)}
        reviewMode={!!(isPaused && pausedAt === 'STORYBOARD')}
        anchorPrompt={(current.styleProfile as Record<string, unknown> | null)?.visualStyle as string | undefined}
        onAnchorClick={() => setShowAnchorModal(true)}
        viewMode={isPaused && pausedAt === 'STORYBOARD' ? 'timeline' : undefined}
      />

      {previewSceneId && (
        <ScenePreviewModal
          scenes={displayScenes}
          activeSceneId={previewSceneId}
          onClose={() => setPreviewSceneId(null)}
          onNavigate={handlePreviewNavigate}
          onRegenerate={(sceneId, feedback) => regenerateScene(current.id, sceneId, feedback)}
          onSaveScene={handleSaveScene}
        />
      )}

      {/* VideoIR production plan preview — shown after all storyboard stages complete */}
      <ProductionPlanPreview projectId={current.id} visible={allDone} />

      {/* Quality reports */}
      <ArtifactReportPanel
        projectId={current.id}
        reports={[
          { filename: 'subject-isolation.json', label: '主体隔离报告' },
        ]}
      />

      </div>
      </StageReviewShell>

      <FloatingActionBar
        hint={
          isPaused && pausedAt === 'STORYBOARD' ? `共 ${scenes.length} 个场景，点击卡片可查看和编辑，确认后生成风格参考图`
          : isPaused && pausedAt === 'REFERENCE_IMAGE' ? '请查看风格参考图，满意后将为所有场景生成图片'
          : allDone ? '视觉设计已完成，继续到视频制作阶段'
          : undefined
        }
        actions={[
        ...(isPaused && pausedAt === 'STORYBOARD' ? [
          { label: confirming ? '处理中…' : '确认分镜，生成参考图', icon: <ArrowRight size={14} />, onClick: handleConfirmAndContinue, disabled: confirming },
        ] : []),
        ...(isPaused && pausedAt === 'REFERENCE_IMAGE' ? [
          { label: approving ? '处理中…' : '风格满意，生成全部场景', icon: <CheckCircle size={14} />, onClick: handleApproveReference, disabled: approving },
          { label: '不满意，重新生成参考图', icon: <RotateCcw size={14} />, onClick: () => setShowRetryConfirm(true), variant: 'secondary' as const },
        ] : []),
        ...(allDone ? [
          { label: '继续到制作', icon: <ArrowRight size={14} />, onClick: () => navigate('../production') },
        ] : []),
      ]} />

      <ConfirmModal
        isOpen={showRetryConfirm}
        title="重新生成参考图"
        description="将丢弃当前参考图并重新生成，确认继续？"
        confirmLabel="重新生成"
        variant="warning"
        onConfirm={() => {
          retryStage(current.id, 'REFERENCE_IMAGE');
          setShowAnchorModal(false);
          setShowRetryConfirm(false);
        }}
        onCancel={() => setShowRetryConfirm(false)}
      />

      {/* Rejection reason dialog */}
      {rejectingSceneId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setRejectingSceneId(null)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">拒绝场景</h3>
            <p className="text-xs text-zinc-400 mb-3">可以说明拒绝原因，方便后续改进。留空也可以直接拒绝。</p>
            <textarea
              className="w-full h-20 bg-zinc-800 border border-zinc-600 rounded-lg p-3 text-sm text-zinc-200 placeholder-zinc-500 resize-none focus:outline-none focus:border-red-500"
              placeholder="例如：构图不对、光线太暗、与脚本不符…"
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={() => setRejectingSceneId(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors"
                onClick={() => {
                  rejectScene(current.id, rejectingSceneId, rejectionReason.trim() || undefined);
                  setRejectingSceneId(null);
                  setRejectionReason('');
                }}
              >
                确认拒绝
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
