import type React from 'react';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'primary' | 'success' | 'warning' | 'danger' | 'neutral' | 'info';
  size?: 'sm' | 'md';
  className?: string;
  pulsing?: boolean;
}

export const Badge: React.FC<BadgeProps> = ({ 
  children, 
  variant = 'neutral', 
  size = 'sm',
  className = '',
  pulsing = false
}) => {
  const variants = {
    primary: "bg-accent/10 text-accent border-accent/20",
    success: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    warning: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    danger: "bg-red-500/10 text-red-500 border-red-500/20",
    info: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    neutral: "bg-zinc-800 text-zinc-400 border-zinc-700"
  };

  const sizes = {
    sm: 'px-2 py-0.5 text-[11px]',
    md: 'px-3 py-1 text-xs',
  };

  return (
    <span className={`
      inline-flex items-center gap-1.5 rounded-md font-mono font-bold uppercase tracking-wider border
      ${sizes[size]}
      ${variants[variant] || variants.neutral} 
      ${className}
    `}>
      {pulsing && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse"></span>}
      {children}
    </span>
  );
};
