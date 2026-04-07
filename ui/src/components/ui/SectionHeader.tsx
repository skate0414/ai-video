import type React from 'react';
import type { LucideIcon } from 'lucide-react';

interface SectionHeaderProps {
    icon: LucideIcon;
    title: string;
    color?: string;
}

export const SectionHeader: React.FC<SectionHeaderProps> = ({ icon: Icon, title, color = "text-white" }) => {
    return (
        <div className="flex items-center gap-3 mb-6 border-b border-white/10 pb-2">
            <Icon className={`w-5 h-5 ${color}`} />
            <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-200">{title}</h3>
        </div>
    );
};
