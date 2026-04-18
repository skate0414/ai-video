import { Type, Clock } from 'lucide-react';

interface Props {
  index: number;
  content: string;
  isActive: boolean;
  onFocus: (index: number) => void;
  onBlur: () => void;
  onChange: (index: number, newContent: string) => void;
  setRef?: (el: HTMLDivElement | null) => void;
  /** Mark this scene as having an issue (orange left border) */
  hasIssue?: boolean;
}

const HEADER_PATTERN = /^(?:#{0,6}\s*)?(?:[\*\_\[【])?(?:(?:Scene|Sequence|Section|Beat)\s+(?:\d+|[IVX]+)|(?:场景|幕|场次)\s*(?:\d+|[一二三四五六七八九十百]+)|(?:第\s*[0-9一二三四五六七八九十百]+\s*[场幕]))(?:[:\uff1a\.\]】])?.*$/i;

export function SceneCard({ index, content, isActive, onFocus, onBlur, onChange, setRef, hasIssue }: Props) {
  const lines = content.split('\n');
  const headerMatch = lines[0]?.match(HEADER_PATTERN);
  const displayHeader = (headerMatch ? headerMatch[0] : `场景 ${index + 1}`)
    .replace(/^[#*【\[]+/, '')
    .replace(/[*:\uff1a\]】]+$/, '')
    .trim();
  const body = headerMatch ? lines.slice(1).join('\n').trim() : content;

  // Word count
  const plainText = body.replace(/##.*\n/g, '').replace(/\[Fact-\d+\]/g, '').trim();
  const englishWords = (plainText.match(/[\w'-]+/g) || []).length;
  const cjkChars = (plainText.match(/[\u4e00-\u9fa5]/g) || []).length;
  const wordCount = englishWords + cjkChars;
  const estimatedDuration = (wordCount / 150) * 60;

  return (
    <div
      ref={setRef}
      data-scene-index={index}
      onClick={() => onFocus(index)}
      className={`group transition-all duration-700 relative ${
        isActive ? 'z-10' : 'hover:opacity-100'
      } ${hasIssue ? 'border-l-2 border-l-amber-500 pl-4' : ''}`}
    >
      {/* Header HUD */}
      <div className="flex items-center justify-between mb-6 select-none">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className={`text-[10px] font-black uppercase tracking-[0.4em] transition-colors duration-700 ${
              isActive ? 'text-blue-500' : 'text-zinc-800 group-hover:text-zinc-600'
            }`}>
              {displayHeader}
            </span>
            <div className={`h-0.5 mt-2 transition-all duration-700 ${
              isActive ? 'bg-blue-500 w-12' : 'bg-zinc-900 w-4 group-hover:bg-zinc-700'
            }`} />
          </div>
          <div className="flex items-center gap-4 opacity-0 group-hover:opacity-100 transition-all duration-500 translate-x-[-8px] group-hover:translate-x-0">
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
              <Type size={10} className="opacity-50" />
              <span>{wordCount} 字</span>
            </div>
            <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-zinc-600">
              <Clock size={10} className="opacity-50" />
              <span>{estimatedDuration.toFixed(1)}s</span>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      {isActive ? (
        <div className="relative">
          <div className="absolute -left-8 top-0 bottom-0 w-0.5 bg-blue-500/20 rounded-full" />
          <textarea
            value={content}
            onChange={(e) => onChange(index, e.target.value)}
            onBlur={onBlur}
            className="w-full bg-transparent border-none text-zinc-100 text-xl font-serif leading-[1.8] p-0 focus:ring-0 focus:outline-none resize-none overflow-hidden selection:bg-blue-500/30"
            rows={Math.max(4, content.split('\n').length)}
            autoFocus
            spellCheck={false}
            placeholder="..."
          />
        </div>
      ) : (
        <div className="text-zinc-500 text-xl font-serif leading-[1.8] whitespace-pre-wrap transition-all duration-700 group-hover:text-zinc-300">
          {body || <span className="text-zinc-900 italic">...</span>}
        </div>
      )}

      {/* Active glow */}
      {isActive && (
        <div className="absolute -inset-x-8 -inset-y-6 bg-blue-500/[0.02] blur-3xl rounded-[80px] -z-10 pointer-events-none" />
      )}
    </div>
  );
}
