import { useState } from 'react';
import { Loader2, Pencil, Check, X } from 'lucide-react';

interface NarrativeBeat {
  title?: string;
  description?: string;
  word_budget?: number;
  beat_type?: string;
  linked_facts?: string[];
}

interface Props {
  narrativeMap: NarrativeBeat[] | null;
  activeBeatIndex: number | null;
  onBeatClick: (index: number) => void;
  isLoading?: boolean;
  onBeatEdit?: (index: number, updates: Partial<NarrativeBeat>) => void;
}

export function NarrativePanel({ narrativeMap, activeBeatIndex, onBeatClick, isLoading, onBeatEdit }: Props) {
  const beatCount = narrativeMap?.length ?? 0;
  const [editingBeat, setEditingBeat] = useState<number | null>(null);
  const [editDesc, setEditDesc] = useState('');
  const [editBudget, setEditBudget] = useState<number | undefined>();

  return (
    <section className="w-1/4 min-w-[260px] max-w-[340px] shrink-0 flex flex-col h-full bg-white/[0.02] backdrop-blur-md border-r border-white/5">
      <div className="flex-grow overflow-y-auto px-4 pb-4 flex flex-col gap-4 relative custom-scrollbar pt-4">
        {/* Timeline spine */}
        <div className="absolute left-8 top-6 bottom-6 w-0.5 bg-zinc-800 z-0">
          {activeBeatIndex !== null && (
            <div
              className="absolute w-2 h-2 bg-blue-500 rounded-full -left-[3px] shadow-[0_0_10px_#3b82f6] transition-all duration-500 ease-in-out"
              style={{ top: `${(activeBeatIndex / (beatCount || 1)) * 100}%` }}
            />
          )}
        </div>

        {isLoading || !narrativeMap ? (
          <div className="flex flex-col items-center justify-center h-40 text-zinc-600 text-xs text-center z-10">
            <Loader2 className="w-6 h-6 animate-spin mb-2 opacity-50" />
            暂无叙事结构
          </div>
        ) : (
          narrativeMap.map((beat, i) => {
            const isActive = activeBeatIndex === i;
            return (
              <div
                key={i}
                onClick={() => onBeatClick(i)}
                className={`relative z-10 pl-8 cursor-pointer group transition-all duration-500 ${
                  isActive ? '' : 'opacity-40 hover:opacity-80'
                }`}
              >
                {/* Timeline dot */}
                <div className={`absolute left-[13px] top-3 w-3 h-3 rounded-full border-2 transition-all duration-500 ${
                  isActive
                    ? 'bg-blue-500 border-blue-500 shadow-[0_0_8px_#3b82f6]'
                    : 'bg-zinc-900 border-zinc-700 group-hover:border-zinc-500'
                }`} />

                <div className={`p-3 rounded-lg transition-all duration-300 ${
                  isActive ? 'bg-blue-500/5 border border-blue-500/20' : 'bg-transparent border border-transparent hover:bg-white/[0.02] hover:border-white/5'
                }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`text-[10px] font-black uppercase tracking-[0.3em] ${
                      isActive ? 'text-blue-400' : 'text-zinc-600 group-hover:text-zinc-400'
                    }`}>
                      {beat.title ?? beat.beat_type ?? `Beat ${i + 1}`}
                    </span>
                    {onBeatEdit && editingBeat !== i && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEditingBeat(i); setEditDesc(beat.description ?? ''); setEditBudget(beat.word_budget); }}
                        className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-white/10 transition-all ml-auto"
                        title="编辑"
                      >
                        <Pencil size={9} className="text-zinc-500" />
                      </button>
                    )}
                    {!onBeatEdit && beat.word_budget && (
                      <span className="text-[9px] font-mono text-zinc-600 ml-auto">
                        {beat.word_budget}字
                      </span>
                    )}
                  </div>

                  {editingBeat === i ? (
                    <div className="space-y-2 mt-1">
                      <textarea
                        value={editDesc}
                        onChange={(e) => setEditDesc(e.target.value)}
                        className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-[11px] text-zinc-300 resize-none focus:outline-none focus:border-blue-500"
                        rows={3}
                        autoFocus
                      />
                      <div className="flex items-center gap-2">
                        <label className="text-[9px] text-zinc-500">字数</label>
                        <input
                          type="number"
                          value={editBudget ?? ''}
                          onChange={(e) => setEditBudget(e.target.value ? Number(e.target.value) : undefined)}
                          className="w-16 bg-zinc-800 border border-zinc-600 rounded px-1.5 py-0.5 text-[10px] text-zinc-300 focus:outline-none focus:border-blue-500"
                        />
                        <div className="flex gap-1 ml-auto">
                          <button
                            onClick={(e) => { e.stopPropagation(); onBeatEdit?.(i, { description: editDesc, word_budget: editBudget }); setEditingBeat(null); }}
                            className="p-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 transition-colors"
                          >
                            <Check size={10} className="text-emerald-400" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); setEditingBeat(null); }}
                            className="p-1 rounded bg-zinc-700 hover:bg-zinc-600 transition-colors"
                          >
                            <X size={10} className="text-zinc-400" />
                          </button>
                        </div>
                      </div>
                      <p className="text-[9px] text-amber-500/60 italic">⚠ 修改后需重新生成脚本</p>
                    </div>
                  ) : (
                    <>
                      {beat.description && (
                        <p className="text-[11px] text-zinc-500 leading-relaxed line-clamp-3">
                          {beat.description}
                        </p>
                      )}
                      {onBeatEdit && beat.word_budget && (
                        <span className="text-[9px] font-mono text-zinc-600 mt-1 inline-block">
                          {beat.word_budget}字
                        </span>
                      )}
                    </>
                  )}
                  {beat.linked_facts && beat.linked_facts.length > 0 && (
                    <div className="flex gap-1 mt-1.5 flex-wrap">
                      {beat.linked_facts.map((fid, fi) => (
                        <span key={fi} className="inline-flex items-center justify-center w-4 h-4 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full text-[8px] font-bold">
                          {fid.replace(/\D/g, '')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}
