import { useEffect } from 'react';
import { Music, Check, X } from 'lucide-react';

interface Props {
  originalName: string;
  onAccept: () => void;
  onDismiss: () => void;
}

export function DownloadConfirmToast({ originalName, onAccept, onDismiss }: Props) {
  // Auto-dismiss after 30 seconds
  useEffect(() => {
    const timer = setTimeout(onDismiss, 30_000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 z-[60] w-80 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-4 space-y-3 animate-in slide-in-from-bottom-4 fade-in duration-300">
      <div className="flex items-start gap-3">
        <div className="shrink-0 mt-0.5 p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <Music size={14} className="text-emerald-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold text-zinc-200">已导入音乐库</p>
          <p className="text-xs text-zinc-400 truncate mt-0.5">{originalName}</p>
          <p className="text-[10px] text-zinc-600 mt-1">设为当前项目的 BGM？</p>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 p-1 text-zinc-500 hover:text-zinc-300 rounded transition-colors"
          title="关闭"
        >
          <X size={12} />
        </button>
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={onAccept}
          className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/20 transition-colors"
        >
          <Check size={12} />
          设为 BGM
        </button>
        <button
          onClick={onDismiss}
          className="flex-1 inline-flex items-center justify-center px-3 py-1.5 text-xs font-medium text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors"
        >
          稍后
        </button>
      </div>
      <p className="text-[10px] text-zinc-600 text-center">Pixabay 标签页仍在打开中</p>
    </div>
  );
}
