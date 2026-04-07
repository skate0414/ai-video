import type React from 'react';

interface IconBoxProps {
  icon: React.ReactNode | string;
  color?: 'primary' | 'green' | 'blue' | 'purple' | 'gray' | 'yellow' | 'red';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export const IconBox: React.FC<IconBoxProps> = ({ 
  icon, 
  color = 'gray', 
  size = 'md',
  className = '' 
}) => {
  const colorStyles = {
    primary: "bg-accent/20 text-accent border border-accent/20",
    green: "bg-emerald-500/20 text-emerald-500 border border-emerald-500/20",
    blue: "bg-blue-500/20 text-blue-500 border border-blue-500/20",
    purple: "bg-purple-500/20 text-purple-400 border border-purple-500/20",
    gray: "bg-zinc-800 text-zinc-400 border border-zinc-700",
    yellow: "bg-amber-500/20 text-amber-500 border border-amber-500/20",
    red: "bg-red-500/20 text-red-500 border border-red-500/20",
  };

  const sizes = {
    sm: "w-8 h-8 text-xs",
    md: "w-10 h-10 text-sm",
    lg: "w-12 h-12 text-base",
  };

  const renderIcon = () => {
    if (typeof icon === 'string') {
      return <span className="material-icons text-lg">{icon}</span>;
    }
    return icon;
  };

  return (
    <div className={`rounded-lg flex items-center justify-center shrink-0 shadow-inner ${colorStyles[color]} ${sizes[size]} ${className}`}>
      {renderIcon()}
    </div>
  );
};
