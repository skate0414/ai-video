import type React from 'react';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  active?: boolean;
  onClick?: () => void;
  noPadding?: boolean;
}

export const Card: React.FC<CardProps> = ({ 
  children, 
  className = '', 
  hover = false, 
  active = false,
  onClick,
  noPadding = false
}) => {
  return (
    <div 
      onClick={onClick}
      className={`
        bg-zinc-900/50 backdrop-blur-sm rounded-xl border transition-all duration-200 shadow-sm shadow-black/20
        ${active ? 'border-accent ring-1 ring-accent/30' : 'border-white/8'}
        ${hover ? 'hover:border-white/20 cursor-pointer hover:shadow-xl hover:bg-zinc-900 hover:scale-[1.005]' : ''}
        ${noPadding ? '' : 'p-6'}
        ${className}
      `}
    >
      {children}
    </div>
  );
};
