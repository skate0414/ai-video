import { useState } from 'react';
import { CheckCircle, XCircle, RefreshCw, CheckSquare, Square, ImageIcon, Loader2, Check, AlertTriangle, Maximize2, Palette, Image, LayoutGrid, List } from 'lucide-react';
import { logger } from '../lib/logger';
import { assetUrl } from '../lib/assetUrl';
import type { PipelineScene } from '../types';

export function SceneGrid({ scenes, onRegenerate, onApprove, onReject, onSceneClick, reviewMode, anchorPrompt, onAnchorClick, viewMode: controlledViewMode, onViewModeChange }: {
  scenes: PipelineScene[];
  onRegenerate: (sceneId: string, feedback?: string) => void;
  onApprove?: (sceneId: string) => void;
  onReject?: (sceneId: string) => void;
  onSceneClick?: (sceneId: string) => void;
  /** When true, cards show narrative+prompt as always-visible large text overlay (STORYBOARD review) */
  reviewMode?: boolean;
  /** Visual style directive text for the anchor/reference card */
  anchorPrompt?: string;
  /** Click handler for the anchor card */
  onAnchorClick?: () => void;
  /** Controlled view mode */
  viewMode?: 'grid' | 'timeline';
  /** View mode change callback */
  onViewModeChange?: (mode: 'grid' | 'timeline') => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [internalViewMode, setInternalViewMode] = useState<'grid' | 'timeline'>('grid');
  const viewMode = controlledViewMode ?? internalViewMode;
  const setViewMode = onViewModeChange ?? setInternalViewMode;

  if (!scenes?.length) {
    return (
      <div className="mt-4">
        <h4 className="text-sm font-semibold text-zinc-300 mb-3">🎞️ 场景</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="rounded-2xl aspect-video bg-zinc-900/50 border border-zinc-800/50 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  const allSelected = selected.size === scenes.length;
  const someSelected = selected.size > 0;

  const toggleAll = () => {
    setSelected(allSelected ? new Set() : new Set(scenes.map((s) => s.id)));
  };

  const toggleOne = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const batchApprove = () => {
    if (!onApprove) return;
    logger.info('user', 'batch_approve_scenes', { count: selected.size });
    for (const id of selected) onApprove(id);
    setSelected(new Set());
  };

  const batchRegenerate = () => {
    logger.info('user', 'batch_regenerate_scenes', { count: selected.size });
    for (const id of selected) onRegenerate(id);
    setSelected(new Set());
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-zinc-300">🎞️ 场景</h4>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-zinc-700 rounded hover:bg-zinc-700 transition-colors"
          >
            {allSelected ? <CheckSquare size={12} /> : <Square size={12} />}
            {allSelected ? '取消全选' : '全选'}
          </button>
          {someSelected && (
            <>
              <span className="text-[10px] text-zinc-500">已选 {selected.size} 个</span>
              {onApprove && (
                <button
                  onClick={batchApprove}
                  className="flex items-center gap-0.5 px-2 py-1 text-[10px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded hover:bg-emerald-500/20 transition-colors"
                >
                  <CheckCircle size={10} /> 批量通过
                </button>
              )}
              <button
                onClick={batchRegenerate}
                className="flex items-center gap-0.5 px-2 py-1 text-[10px] font-bold text-zinc-400 bg-zinc-800 border border-zinc-700 rounded hover:bg-zinc-700 transition-colors"
              >
                <RefreshCw size={10} /> 批量重新生成
              </button>
            </>
          )}
          {/* View mode toggle — disabled when externally controlled */}
          <div className={`flex items-center border border-zinc-700 rounded overflow-hidden ml-1${controlledViewMode ? ' opacity-50 pointer-events-none' : ''}`}>
            <button
              onClick={() => setViewMode('timeline')}
              className={`p-1 transition-colors ${viewMode === 'timeline' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="列表视图"
              disabled={!!controlledViewMode}
            >
              <List size={12} />
            </button>
            <button
              onClick={() => setViewMode('grid')}
              className={`p-1 transition-colors ${viewMode === 'grid' ? 'bg-zinc-700 text-zinc-200' : 'text-zinc-500 hover:text-zinc-300'}`}
              title="网格视图"
              disabled={!!controlledViewMode}
            >
              <LayoutGrid size={12} />
            </button>
          </div>
        </div>
      </div>

      {/* Timeline view */}
      {viewMode === 'timeline' ? (
        <div className="space-y-2">
          {scenes.map((scene) => {
            const hasImage = !!(scene.assetUrl && scene.assetType === 'image');
            const hasRefImage = !!scene.referenceImageUrl;
            const imgSrc = hasImage ? assetUrl(scene.assetUrl) : hasRefImage ? assetUrl(scene.referenceImageUrl) : null;
            const isGenerating = scene.status === 'generating' || scene.status === 'processing';
            const isDone = scene.status === 'done' || scene.status === 'completed';
            const isError = scene.status === 'error';

            return (
              <div
                key={scene.id}
                className={`flex items-start gap-3 px-3 py-2.5 rounded-xl border transition-colors cursor-pointer
                  ${selected.has(scene.id) ? 'border-indigo-500/40 bg-indigo-500/5' : 'border-zinc-800 bg-zinc-900/30 hover:bg-zinc-800/50'}
                `}
                onClick={() => onSceneClick?.(scene.id)}
              >
                {/* Thumbnail */}
                <div className="relative w-24 aspect-video rounded-lg overflow-hidden shrink-0 bg-black">
                  {imgSrc ? (
                    <img src={imgSrc} alt={`场景 ${scene.number}`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center"><ImageIcon size={14} className="text-zinc-700" /></div>
                  )}
                  {isGenerating && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                      <Loader2 size={12} className="text-indigo-400 animate-spin" />
                    </div>
                  )}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[10px] font-bold text-zinc-500">{scene.number.toString().padStart(2, '0')}</span>
                    <span className="text-[10px] font-mono text-zinc-600">{scene.estimatedDuration}s</span>
                    {isDone && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                    {isError && <span className="w-1.5 h-1.5 rounded-full bg-red-500" />}
                    {isGenerating && <span className="text-[10px] text-indigo-400">生成中…</span>}
                  </div>
                  <p className="text-xs text-zinc-300 line-clamp-2 leading-relaxed">{scene.narrative}</p>
                  {scene.visualPrompt && (
                    <p className="text-[10px] text-zinc-600 font-mono line-clamp-1 mt-0.5">{scene.visualPrompt}</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={(e) => toggleOne(e, scene.id)} className="text-zinc-600 hover:text-zinc-300 transition-colors p-0.5">
                    {selected.has(scene.id) ? <CheckSquare size={12} className="text-indigo-400" /> : <Square size={12} />}
                  </button>
                  {onApprove && isDone && (
                    <button onClick={(e) => { e.stopPropagation(); onApprove(scene.id); }} className="text-zinc-600 hover:text-emerald-400 transition-colors p-0.5" title="通过">
                      <CheckCircle size={12} />
                    </button>
                  )}
                  <button onClick={(e) => { e.stopPropagation(); onRegenerate(scene.id); }} className="text-zinc-600 hover:text-zinc-300 transition-colors p-0.5" title="重新生成">
                    <RefreshCw size={10} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {/* Anchor / Reference Image card — first in grid */}
        {(anchorPrompt || onAnchorClick) && (
          <div
            className="group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-500 aspect-video hover:scale-[1.02] hover:shadow-[0_20px_50px_rgba(0,0,0,0.5)] border-2 border-dashed border-indigo-500/30 hover:border-indigo-500/60"
            onClick={onAnchorClick}
          >
            <div className="absolute inset-0 z-0 bg-gradient-to-br from-indigo-950/40 via-zinc-900/80 to-zinc-900/80">
              <div className="absolute inset-0 flex items-center justify-center">
                <Palette size={48} className="text-indigo-500/10" />
              </div>
            </div>
            <div className="absolute inset-0 z-10 flex flex-col justify-between p-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-500/20 backdrop-blur-md rounded-full border border-indigo-500/30">
                  <Palette size={10} className="text-indigo-400" />
                  <span className="text-[10px] font-bold text-indigo-300 uppercase tracking-widest">风格锚点</span>
                </div>
              </div>
              <div className="space-y-1.5">
                {anchorPrompt ? (
                  <p className="text-sm text-zinc-300 font-serif italic leading-relaxed line-clamp-4">"{anchorPrompt}"</p>
                ) : (
                  <p className="text-xs text-zinc-600 italic">尚未设置视觉风格指令</p>
                )}
                <span className="text-[9px] font-mono text-indigo-400/60 uppercase tracking-[0.2em]">点击编辑风格</span>
              </div>
            </div>
          </div>
        )}

        {scenes.map((scene) => {
          const hasImage = !!(scene.assetUrl && scene.assetType === 'image');
          const isGenerating = scene.status === 'generating' || scene.status === 'processing';
          const isDone = scene.status === 'done' || scene.status === 'completed';
          const isError = scene.status === 'error';
          const isReview = reviewMode && !hasImage && !scene.referenceImageUrl;

          return (
          <div
            key={scene.id}
            className={`group relative rounded-2xl overflow-hidden cursor-pointer transition-all duration-500 aspect-video
              hover:scale-[1.02] hover:shadow-[0_20px_50px_rgba(0,0,0,0.5)]
              ${selected.has(scene.id) ? 'ring-2 ring-indigo-500/60 ring-offset-2 ring-offset-[#050505]' : ''}
            `}
            onClick={() => onSceneClick?.(scene.id)}
          >
            <div className="absolute inset-0 z-0">
              {hasImage ? (
                <img src={assetUrl(scene.assetUrl)} alt={`场景 ${scene.number}`}
                  className={`w-full h-full object-cover transition-all duration-700 ${isGenerating ? 'opacity-30 blur-xl scale-110' : 'opacity-100 group-hover:scale-105'}`} />
              ) : scene.referenceImageUrl ? (
                <img src={assetUrl(scene.referenceImageUrl)} alt={`场景 ${scene.number}`}
                  className="w-full h-full object-cover transition-all duration-700 opacity-60 group-hover:scale-105" />
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900/80">
                  <ImageIcon size={32} className="text-zinc-800" />
                </div>
              )}
            </div>

            {/* Review mode: always-visible text overlay on gray placeholder */}
            {isReview ? (
              <>
                <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent z-10" />
                <div className="absolute inset-0 z-20 flex flex-col justify-between p-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl font-black text-white/30">{scene.number.toString().padStart(2, '0')}</span>
                      <span className="text-[9px] font-mono text-zinc-500 bg-black/30 px-1.5 py-0.5 rounded">{scene.estimatedDuration}s</span>
                    </div>
                    <button onClick={(e) => toggleOne(e, scene.id)} className="text-zinc-500 hover:text-white transition-colors">
                      {selected.has(scene.id) ? <CheckSquare size={14} className="text-indigo-400" /> : <Square size={14} />}
                    </button>
                  </div>
                  <div className="space-y-1.5 overflow-hidden">
                    <p className="text-sm font-medium text-zinc-200 leading-relaxed line-clamp-2">{scene.narrative}</p>
                    {scene.visualPrompt && (
                      <p className="text-[11px] text-zinc-500 font-mono leading-relaxed line-clamp-3">{scene.visualPrompt}</p>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <>
                {/* Normal mode: hover-reveal overlays */}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-500 z-10" />
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between z-20 opacity-0 group-hover:opacity-100 transition-all duration-500 -translate-y-2 group-hover:translate-y-0">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl font-black text-white/20">{scene.number.toString().padStart(2, '0')}</span>
                    {isGenerating && <Loader2 size={12} className="text-amber-500 animate-spin" />}
                    {isDone && <Check size={12} className="text-emerald-500" />}
                    {isError && <AlertTriangle size={12} className="text-red-500" />}
                  </div>
                  <button onClick={(e) => toggleOne(e, scene.id)} className="text-zinc-400 hover:text-white transition-colors">
                    {selected.has(scene.id) ? <CheckSquare size={14} className="text-indigo-400" /> : <Square size={14} />}
                  </button>
                </div>
                <div className="absolute bottom-3 left-3 right-3 z-20 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-y-2 group-hover:translate-y-0">
                  <p className="text-xs text-zinc-200 font-medium leading-relaxed line-clamp-2 mb-1">{scene.narrative}</p>
                  {!hasImage && scene.visualPrompt && (
                    <p className="text-[10px] text-zinc-500 font-mono line-clamp-1 mb-1">{scene.visualPrompt}</p>
                  )}
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-mono text-zinc-500">{scene.estimatedDuration}s{scene.assetType && scene.assetType !== 'placeholder' ? ` · ${scene.assetType}` : ''}</span>
                    <div className="flex gap-1.5">
                      {scene.reviewStatus === 'pending_review' && onApprove && onReject && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); onApprove(scene.id); }} className="p-1.5 rounded-full bg-emerald-500/20 hover:bg-emerald-500/30 transition-colors" title="通过"><CheckCircle size={12} className="text-emerald-400" /></button>
                          <button onClick={(e) => { e.stopPropagation(); onReject(scene.id); }} className="p-1.5 rounded-full bg-red-500/20 hover:bg-red-500/30 transition-colors" title="拒绝"><XCircle size={12} className="text-red-400" /></button>
                        </>
                      )}
                      {(isDone || isError || scene.reviewStatus === 'rejected') && (
                        <>
                          <button onClick={(e) => { e.stopPropagation(); onRegenerate(scene.id, '重新生成关键帧，保持构图和风格一致'); }} className="p-1.5 rounded-full bg-indigo-500/20 hover:bg-indigo-500/30 transition-colors" title="重新生成关键帧"><Image size={12} className="text-indigo-400" /></button>
                          <button onClick={(e) => { e.stopPropagation(); onRegenerate(scene.id); }} className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors" title="重新生成"><RefreshCw size={12} className="text-white" /></button>
                        </>
                      )}
                      <button onClick={(e) => { e.stopPropagation(); onSceneClick?.(scene.id); }} className="p-1.5 rounded-full bg-white/10 hover:bg-white/20 transition-colors" title="预览"><Maximize2 size={12} className="text-white" /></button>
                    </div>
                  </div>
                </div>
              </>
            )}

            {isGenerating && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-md z-30">
                <Loader2 size={32} className="text-indigo-400 animate-spin mb-3" />
                <span className="text-[10px] text-indigo-300 font-mono uppercase tracking-[0.3em] animate-pulse">{scene.progressMessage || '生成中'}</span>
              </div>
            )}
          </div>
          );
        })}
      </div>
      )}
    </div>
  );
}
