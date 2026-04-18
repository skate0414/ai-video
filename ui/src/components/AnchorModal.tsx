import { useState } from 'react';
import { X, CheckCircle, RotateCcw, Palette, Eye } from 'lucide-react';
import { assetUrl } from '../lib/assetUrl';
import type { PipelineScene } from '../types';

interface StyleProfile {
  visualStyle?: string;
  tone?: string;
  colorPalette?: string[];
  pacing?: string;
  targetAudience?: string;
  [key: string]: unknown;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
  scenes: PipelineScene[];
  referenceImages?: string[];
  styleProfile: StyleProfile | null;
  onApprove: () => void;
  onRetry: () => void;
  onUpdateStyleProfile?: (profile: Partial<StyleProfile>) => void;
}

export function AnchorModal({ isOpen, onClose, scenes, referenceImages, styleProfile, onApprove, onRetry, onUpdateStyleProfile }: Props) {
  const [activeThumbIdx, setActiveThumbIdx] = useState(0);
  const [editingDirective, setEditingDirective] = useState(false);
  const [directiveText, setDirectiveText] = useState(styleProfile?.visualStyle ?? '');

  if (!isOpen) return null;

  // Collect all reference images: global reference sheet first, then scene samples
  const allImages: { url: string; label: string }[] = [];
  referenceImages?.forEach((img) => {
    allImages.push({ url: img, label: '风格参考图' });
  });
  scenes.filter((s) => s.referenceImageUrl).forEach((s) => {
    allImages.push({ url: s.referenceImageUrl!, label: `场景 ${s.number}` });
  });

  const activeImage = allImages[activeThumbIdx] ?? allImages[0];
  const colors = styleProfile?.colorPalette ?? [];
  const tone = styleProfile?.tone ?? '未定义';

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/90 backdrop-blur-md animate-fade-in">
      <div className="relative w-full max-w-6xl max-h-[90vh] mx-6 rounded-2xl border border-zinc-800 bg-zinc-950 overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800">
          <h2 className="text-lg font-bold text-zinc-100 flex items-center gap-2">
            <Palette size={18} className="text-indigo-400" />
            风格锚定
          </h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white p-1 rounded-full hover:bg-zinc-800 transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Body — two columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left — reference image viewer (5/12) */}
          <div className="w-5/12 relative flex flex-col border-r border-zinc-800">
            {/* Main image with blurred background */}
            <div className="flex-1 relative overflow-hidden flex items-center justify-center bg-black">
              {activeImage && (
                <>
                  <img
                    src={assetUrl(activeImage.url)}
                    alt={activeImage.label}
                    className="absolute inset-0 w-full h-full object-cover blur-3xl opacity-30 scale-110"
                  />
                  <img
                    src={assetUrl(activeImage.url)}
                    alt={activeImage.label}
                    className="relative z-10 max-h-full max-w-full object-contain p-4"
                  />
                  {/* Tone badge */}
                  <div className="absolute top-4 left-4 z-20">
                    <span className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-indigo-300 bg-indigo-500/20 border border-indigo-500/30 rounded-full backdrop-blur-sm">
                      {tone}
                    </span>
                  </div>
                  <div className="absolute bottom-4 left-4 z-20">
                    <span className="text-xs font-semibold text-white/70">{activeImage.label}</span>
                  </div>
                </>
              )}
              {!activeImage && (
                <div className="text-zinc-600 text-sm">暂无参考图</div>
              )}
            </div>

            {/* Thumbnail strip */}
            {allImages.length > 1 && (
              <div className="flex gap-2 p-3 overflow-x-auto bg-zinc-900/50">
                {allImages.map((img, i) => (
                  <button
                    key={i}
                    onClick={() => setActiveThumbIdx(i)}
                    className={`shrink-0 w-16 h-12 rounded-lg overflow-hidden border-2 transition-all ${
                      i === activeThumbIdx ? 'border-indigo-500 scale-105' : 'border-transparent opacity-60 hover:opacity-100'
                    }`}
                  >
                    <img src={assetUrl(img.url)} alt={img.label} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right — style controls (7/12) */}
          <div className="w-7/12 overflow-y-auto p-6 space-y-6">
            {/* Visual directive */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
                  <Eye size={14} className="text-indigo-400" /> 视觉指令
                </h3>
                <button
                  onClick={() => setEditingDirective(!editingDirective)}
                  className="text-[10px] text-indigo-400 hover:text-indigo-300 uppercase tracking-wider font-bold"
                >
                  {editingDirective ? '关闭' : '编辑'}
                </button>
              </div>
              {editingDirective ? (
                <div className="space-y-2">
                  <textarea
                    value={directiveText}
                    onChange={(e) => setDirectiveText(e.target.value)}
                    className="w-full h-24 px-3 py-2 text-sm bg-zinc-900 border border-zinc-700 rounded-lg text-zinc-200 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                    placeholder="描述整体视觉风格..."
                  />
                  <button
                    onClick={() => {
                      onUpdateStyleProfile?.({ visualStyle: directiveText });
                      setEditingDirective(false);
                    }}
                    className="px-3 py-1.5 text-xs font-bold text-white bg-indigo-600 rounded-lg hover:bg-indigo-500 transition-colors"
                  >
                    保存
                  </button>
                </div>
              ) : (
                <p className="text-sm text-zinc-400 leading-relaxed bg-zinc-900/50 rounded-lg px-3 py-2 border border-zinc-800">
                  {styleProfile?.visualStyle || '尚未设置视觉指令'}
                </p>
              )}
            </section>

            {/* Color palette */}
            <section>
              <h3 className="text-sm font-semibold text-zinc-200 mb-2 flex items-center gap-1.5">
                <Palette size={14} className="text-indigo-400" /> 配色方案
              </h3>
              <div className="flex flex-wrap gap-2">
                {colors.length > 0 ? colors.map((color, i) => (
                  <div
                    key={i}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-zinc-700 bg-zinc-900/50"
                  >
                    <div
                      className="w-4 h-4 rounded-full border border-white/10"
                      style={{ backgroundColor: color }}
                    />
                    <span className="text-xs font-mono text-zinc-400">{color}</span>
                  </div>
                )) : (
                  <span className="text-xs text-zinc-600">无配色数据</span>
                )}
              </div>
            </section>

            {/* Style parameters */}
            {styleProfile && (
              <section>
                <h3 className="text-sm font-semibold text-zinc-200 mb-2">风格参数</h3>
                <div className="grid grid-cols-2 gap-2">
                  {styleProfile.pacing && (
                    <div className="px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">节奏</span>
                      <p className="text-xs text-zinc-300 mt-0.5">{styleProfile.pacing}</p>
                    </div>
                  )}
                  {styleProfile.targetAudience && (
                    <div className="px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">目标受众</span>
                      <p className="text-xs text-zinc-300 mt-0.5">{styleProfile.targetAudience}</p>
                    </div>
                  )}
                  {styleProfile.tone && (
                    <div className="px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800">
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">色调</span>
                      <p className="text-xs text-zinc-300 mt-0.5">{styleProfile.tone}</p>
                    </div>
                  )}
                </div>
              </section>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-zinc-800 bg-zinc-900/30">
          <button
            onClick={onRetry}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors"
          >
            <RotateCcw size={14} /> 不满意，重新生成参考图
          </button>
          <button
            onClick={onApprove}
            className="inline-flex items-center gap-1.5 px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors shadow-lg shadow-indigo-500/20"
          >
            <CheckCircle size={14} /> 风格满意，生成全部场景
          </button>
        </div>
      </div>
    </div>
  );
}
