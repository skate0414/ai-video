import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, X, RefreshCw, Edit2, Download, Check, Smile, Save, ImageIcon } from 'lucide-react';
import { assetUrl } from '../lib/assetUrl';
import type { PipelineScene } from '../types';

interface Props {
  scenes: PipelineScene[];
  activeSceneId: string | null;
  onClose: () => void;
  onNavigate: (direction: 'next' | 'prev' | string) => void;
  onRegenerate: (sceneId: string, feedback?: string) => void;
  onSaveScene?: (sceneId: string, updates: { narrative?: string; visualPrompt?: string }) => void;
  /** When true, show video player + audio player instead of just images */
  productionMode?: boolean;
}

export function ScenePreviewModal({ scenes, activeSceneId, onClose, onNavigate, onRegenerate, onSaveScene, productionMode }: Props) {
  const [isEditingPrompt, setIsEditingPrompt] = useState(false);
  const [isEditingNarrative, setIsEditingNarrative] = useState(false);
  const [tempPrompt, setTempPrompt] = useState('');
  const [tempNarrative, setTempNarrative] = useState('');

  const scene = scenes.find((s) => s.id === activeSceneId);

  useEffect(() => {
    if (scene) {
      setTempPrompt(scene.visualPrompt);
      setTempNarrative(scene.narrative);
      setIsEditingPrompt(false);
      setIsEditingNarrative(false);
    }
  }, [scene]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowLeft') onNavigate('prev');
    else if (e.key === 'ArrowRight') onNavigate('next');
  }, [onClose, onNavigate]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleDownload = (url: string, filename: string) => {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  if (!scene) return null;

  const imageUrl = scene.assetUrl ? assetUrl(scene.assetUrl) : scene.referenceImageUrl ? assetUrl(scene.referenceImageUrl) : null;
  const videoUrl = productionMode && scene.assetUrl && scene.assetType === 'video' ? assetUrl(scene.assetUrl) : null;
  const audioUrl = productionMode && scene.audioUrl ? assetUrl(scene.audioUrl) : null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in">
      {/* Close */}
      <button
        onClick={onClose}
        className="absolute top-6 right-8 text-zinc-400 hover:text-white bg-black/20 hover:bg-zinc-800/50 rounded-full p-2 transition-colors z-[110]"
      >
        <X size={24} />
      </button>

      <div className="relative w-full h-full max-w-[1600px] flex flex-col items-center justify-center p-6 md:p-10">
        <div className="w-full flex items-center justify-between gap-6 h-full max-h-[90vh]">
          {/* Prev */}
          <button
            onClick={() => onNavigate('prev')}
            className="group flex items-center justify-center w-14 h-14 rounded-full bg-zinc-800/30 hover:bg-zinc-700/50 border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white transition-all backdrop-blur-md shrink-0"
          >
            <ChevronLeft size={32} className="group-hover:-translate-x-0.5 transition-transform" />
          </button>

          {/* Center content */}
          <div className="flex flex-col items-center w-full max-w-5xl h-full justify-center">
            {/* Header */}
            <div className="flex items-center gap-4 mb-4 w-full px-1">
              <div className="flex items-center gap-2">
                <span className="text-3xl font-bold text-white">{scene.number.toString().padStart(2, '0')}</span>
                <div className="h-6 w-px bg-zinc-700 mx-2" />
                <span className="text-sm font-mono text-zinc-400 bg-zinc-800/50 px-2 py-1 rounded border border-zinc-700">{scene.estimatedDuration}s</span>
              </div>
              <div className="flex-1 min-w-0">
                {isEditingNarrative ? (
                  <div className="flex items-center gap-2 animate-fade-in">
                    <input
                      type="text"
                      value={tempNarrative}
                      onChange={(e) => setTempNarrative(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { onSaveScene?.(scene.id, { narrative: tempNarrative }); setIsEditingNarrative(false); } if (e.key === 'Escape') setIsEditingNarrative(false); }}
                      className="flex-1 bg-black/50 border border-indigo-500/50 rounded-lg px-3 py-1.5 text-base text-zinc-100 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20"
                      autoFocus
                    />
                    <button onClick={() => { onSaveScene?.(scene.id, { narrative: tempNarrative }); setIsEditingNarrative(false); }} className="p-1.5 text-emerald-400 hover:text-emerald-300 transition-colors"><Check size={16} /></button>
                    <button onClick={() => setIsEditingNarrative(false)} className="p-1.5 text-zinc-500 hover:text-zinc-300 transition-colors"><X size={16} /></button>
                  </div>
                ) : (
                  <p
                    className={`text-lg font-medium text-zinc-100 line-clamp-1 ${onSaveScene ? 'cursor-pointer hover:text-indigo-300 transition-colors' : ''}`}
                    onClick={() => { if (onSaveScene) { setTempNarrative(scene.narrative); setIsEditingNarrative(true); } }}
                    title={onSaveScene ? '点击编辑旁白' : undefined}
                  >
                    "{scene.narrative}"
                  </p>
                )}
              </div>
              <span className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider rounded-md border ${
                scene.status === 'done' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                  : scene.status === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/20'
                  : 'bg-zinc-800 text-zinc-400 border-zinc-700'
              }`}>
                {scene.status}
              </span>
            </div>

            {/* Media display */}
            <div className="relative w-full aspect-video rounded-lg overflow-hidden border border-zinc-700 shadow-2xl bg-black flex items-center justify-center">
              {videoUrl ? (
                <video src={videoUrl} controls className="w-full h-full object-contain" />
              ) : imageUrl ? (
                <img src={imageUrl} alt={`场景 ${scene.number}`} className="w-full h-full object-contain" />
              ) : (
                <div className="flex flex-col items-center gap-3 text-zinc-600">
                  <ImageIcon size={48} strokeWidth={1} />
                  <span className="text-xs font-mono uppercase tracking-[0.2em] text-zinc-700">尚未生成</span>
                </div>
              )}
            </div>

            {/* TTS audio player (production mode) */}
            {audioUrl && (
              <div className="mt-3 flex items-center gap-3 px-4 py-2.5 rounded-lg border border-zinc-700 bg-zinc-900/50">
                <span className="text-xs font-semibold text-zinc-400 shrink-0">🔊 语音</span>
                <audio controls preload="none" src={audioUrl} className="flex-1 h-8" />
              </div>
            )}

            {/* Actions */}
            <div className="mt-6 flex items-center justify-center gap-3">
              <button
                onClick={() => onRegenerate(scene.id)}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-full transition-colors shadow-lg shadow-indigo-500/20 hover:scale-105"
              >
                <RefreshCw size={16} /> 重新生成
              </button>
              <div className="w-px h-8 bg-zinc-700 mx-2" />
              <button
                onClick={() => setIsEditingPrompt(!isEditingPrompt)}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-full hover:text-white hover:bg-zinc-700 transition-colors"
              >
                <Edit2 size={16} /> {isEditingPrompt ? '取消' : '编辑提示词'}
              </button>
              <button
                onClick={() => onRegenerate(scene.id, '修复人脸一致性，保持角色面部特征在所有场景中统一')}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-full hover:text-white hover:bg-zinc-700 transition-colors"
                title="修复人脸一致性"
              >
                <Smile size={16} /> Face Fix
              </button>
              {imageUrl && (
                <button
                  onClick={() => handleDownload(imageUrl, `scene-${scene.number}.png`)}
                  className="inline-flex items-center gap-1.5 px-5 py-2.5 text-xs font-bold text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-full hover:text-white hover:bg-zinc-700 transition-colors"
                >
                  <Download size={16} /> 下载
                </button>
              )}
            </div>

            {/* Prompt editor / display */}
            <div className="mt-6 w-full max-w-4xl text-center">
              {isEditingPrompt ? (
                <div className="flex flex-col gap-2 animate-fade-in">
                  <textarea
                    value={tempPrompt}
                    onChange={(e) => setTempPrompt(e.target.value)}
                    className="w-full bg-black/50 border border-indigo-500/50 rounded-lg p-3 text-sm text-zinc-200 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20 resize-none h-24 font-mono leading-relaxed"
                    autoFocus
                  />
                  <div className="flex justify-center gap-2">
                    {onSaveScene && (
                      <button
                        onClick={() => { onSaveScene(scene.id, { visualPrompt: tempPrompt }); setIsEditingPrompt(false); }}
                        className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors"
                      >
                        <Save size={14} /> 保存
                      </button>
                    )}
                    <button
                      onClick={() => { onRegenerate(scene.id, tempPrompt); setIsEditingPrompt(false); }}
                      className="inline-flex items-center gap-1 px-4 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
                    >
                      <Check size={14} /> 保存并重新生成
                    </button>
                  </div>
                </div>
              ) : (
                <p
                  className="text-sm text-zinc-500 font-mono leading-relaxed max-w-3xl mx-auto cursor-pointer hover:text-zinc-400 transition-colors"
                  onClick={() => setIsEditingPrompt(true)}
                  title="点击编辑"
                >
                  <span className="uppercase text-xs font-bold tracking-wider text-zinc-600 mr-2 border border-zinc-800 px-1.5 py-0.5 rounded bg-black/30">提示词</span>
                  {scene.visualPrompt}
                </p>
              )}
            </div>
          </div>

          {/* Next */}
          <button
            onClick={() => onNavigate('next')}
            className="group flex items-center justify-center w-14 h-14 rounded-full bg-zinc-800/30 hover:bg-zinc-700/50 border border-zinc-700 hover:border-zinc-500 text-zinc-400 hover:text-white transition-all backdrop-blur-md shrink-0"
          >
            <ChevronRight size={32} className="group-hover:translate-x-0.5 transition-transform" />
          </button>
        </div>

        {/* Dots navigation */}
        <div className="absolute bottom-6 flex gap-1.5 opacity-50 hover:opacity-100 transition-opacity">
          {scenes.map((s) => (
            <div
              key={s.id}
              onClick={() => onNavigate(s.id)}
              className={`w-2 h-2 rounded-full cursor-pointer transition-all ${
                s.id === activeSceneId ? 'bg-indigo-500 scale-125 shadow-glow' : 'bg-zinc-600 hover:bg-zinc-400'
              }`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
