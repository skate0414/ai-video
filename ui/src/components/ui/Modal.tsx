import type React from 'react';
import { X } from 'lucide-react';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
  maxWidth?: string;
}

export const Modal: React.FC<ModalProps> = ({ 
  isOpen, 
  onClose, 
  title, 
  children, 
  footer,
  maxWidth = 'max-w-2xl'
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
      <div 
        className={`w-full ${maxWidth} bg-[#09090b] rounded-2xl shadow-2xl border border-white/10 flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-white/5 flex justify-between items-center bg-[#0a0a0a]">
          <h3 className="text-sm font-black text-white uppercase tracking-widest flex items-center gap-2">
            {title}
          </h3>
          <button 
            onClick={onClose} 
            className="text-zinc-500 hover:text-white transition-colors rounded-full p-1 hover:bg-white/10"
          >
            <X size={18} />
          </button>
        </div>
        <div className="p-0 text-zinc-300">
          {children}
        </div>
        {footer && (
          <div className="px-6 py-4 border-t border-white/5 bg-[#0a0a0a] flex justify-end gap-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
};
