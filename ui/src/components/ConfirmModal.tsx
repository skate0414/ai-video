import { useEffect, useRef } from 'react';
import { AlertTriangle, Trash2, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  isOpen,
  title,
  description,
  confirmLabel = '确认',
  cancelLabel = '取消',
  variant = 'warning',
  onConfirm,
  onCancel,
}: Props) {
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Focus the cancel-side on open so Enter doesn't accidentally confirm
  useEffect(() => {
    if (isOpen) {
      // Slight delay so modal is rendered before focusing
      const t = setTimeout(() => confirmRef.current?.focus(), 50);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  const isDanger = variant === 'danger';
  const Icon = isDanger ? Trash2 : AlertTriangle;
  const iconColor = isDanger ? 'text-red-400' : 'text-amber-400';
  const iconBg = isDanger ? 'bg-red-500/10 border-red-500/20' : 'bg-amber-500/10 border-amber-500/20';
  const confirmBg = isDanger
    ? 'bg-red-600 hover:bg-red-500 shadow-red-500/20'
    : 'bg-amber-600 hover:bg-amber-500 shadow-amber-500/20';

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 backdrop-blur-sm animate-fade-in"
      onClick={onCancel}
    >
      <div
        className="relative w-full max-w-md mx-4 rounded-2xl border border-zinc-800 bg-zinc-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close button */}
        <button
          onClick={onCancel}
          className="absolute top-4 right-4 text-zinc-500 hover:text-white p-1 rounded-full hover:bg-zinc-800 transition-colors"
        >
          <X size={16} />
        </button>

        {/* Icon + Title */}
        <div className="flex items-start gap-4">
          <div className={`flex items-center justify-center w-10 h-10 rounded-xl border shrink-0 ${iconBg}`}>
            <Icon size={18} className={iconColor} />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-zinc-100">{title}</h3>
            <p className="text-sm text-zinc-400 mt-1.5 leading-relaxed">{description}</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-2 mt-6">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-lg transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            onClick={onConfirm}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors shadow-lg ${confirmBg}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
