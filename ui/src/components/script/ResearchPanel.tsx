import { useState } from 'react';
import { ChevronDown, Pencil, Trash2, Check, X } from 'lucide-react';

interface ResearchFact {
  content: string;
  source?: string;
}

interface ResearchData {
  facts?: ResearchFact[];
  myths?: string[];
  glossary?: Array<{ term: string; definition: string }>;
}

interface CalibrationData {
  reference_total_words?: number;
  reference_duration_sec?: number;
  actual_speech_rate?: string;
  new_video_target_duration_sec?: number;
  target_word_count?: number;
  target_word_count_min?: string;
  target_word_count_max?: string;
}

interface Props {
  researchData: ResearchData | null;
  calibration: CalibrationData | null;
  currentWordCount: number;
  onFactEdit?: (index: number, content: string) => void;
  onFactDelete?: (index: number) => void;
}

export function ResearchPanel({ researchData, calibration, currentWordCount, onFactEdit, onFactDelete }: Props) {
  const [expandedSections, setExpandedSections] = useState<string[]>([]);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  const toggleSection = (section: string) => {
    setExpandedSections((prev) =>
      prev.includes(section) ? prev.filter((s) => s !== section) : [...prev, section],
    );
  };

  return (
    <section className="w-1/4 min-w-[260px] max-w-[340px] shrink-0 flex flex-col h-full bg-white/[0.02] backdrop-blur-md border-r border-white/5">
      {/* Calibration bar */}
      {calibration && calibration.target_word_count && (
        <div className="px-4 pt-4 pb-2 border-b border-white/5 space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-wider">
            <span>目标字数</span>
            <span className={currentWordCount >= (calibration.target_word_count ?? 0) * 0.9 && currentWordCount <= (calibration.target_word_count ?? 0) * 1.1 ? 'text-emerald-400' : currentWordCount > (calibration.target_word_count ?? 0) * 1.2 ? 'text-red-400' : 'text-amber-400'}>
              {currentWordCount} / {calibration.target_word_count}
            </span>
          </div>
          <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                currentWordCount >= (calibration.target_word_count ?? 0) * 0.9 && currentWordCount <= (calibration.target_word_count ?? 0) * 1.1
                  ? 'bg-emerald-500'
                  : currentWordCount > (calibration.target_word_count ?? 0) * 1.2
                    ? 'bg-red-500'
                    : 'bg-amber-500'
              }`}
              style={{ width: `${Math.min((currentWordCount / (calibration.target_word_count ?? 1)) * 100, 100)}%` }}
            />
          </div>
          {calibration.actual_speech_rate && (
            <p className="text-[9px] text-zinc-600">语速: {calibration.actual_speech_rate} · 目标时长: {calibration.new_video_target_duration_sec}s</p>
          )}
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-grow overflow-y-auto px-4 pb-4 space-y-4 custom-scrollbar">
        {!researchData ? (
          <div className="text-center p-8 text-zinc-600 text-xs">暂无研究数据</div>
        ) : (
          <>
            {/* Facts */}
            {researchData.facts && researchData.facts.length > 0 && (
              <div className="space-y-2 pt-3">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 sticky top-0 bg-studio-base/95 backdrop-blur py-2 z-10 border-b border-white/5">
                  研究素材 ({researchData.facts.length})
                </h3>
                {researchData.facts.map((fact, i) => (
                  <div
                    key={i}
                    className="p-3 rounded-lg bg-white/[0.02] border border-white/5 text-xs text-zinc-400 leading-relaxed hover:bg-white/[0.04] hover:border-white/10 transition-all cursor-default group"
                  >
                    {editingIndex === i ? (
                      <div className="space-y-2">
                        <textarea
                          value={editValue}
                          onChange={(e) => setEditValue(e.target.value)}
                          className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-xs text-zinc-300 resize-none focus:outline-none focus:border-blue-500"
                          rows={3}
                          autoFocus
                        />
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => { onFactEdit?.(i, editValue); setEditingIndex(null); }}
                            className="p-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 transition-colors"
                            title="保存"
                          >
                            <Check size={10} className="text-emerald-400" />
                          </button>
                          <button
                            onClick={() => setEditingIndex(null)}
                            className="p-1 rounded bg-zinc-700 hover:bg-zinc-600 transition-colors"
                            title="取消"
                          >
                            <X size={10} className="text-zinc-400" />
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-2">
                        <span className="inline-flex items-center justify-center w-4 h-4 mt-0.5 shrink-0 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-full text-[9px] font-bold">
                          {i + 1}
                        </span>
                        <span className="flex-1">{fact.content}</span>
                        {(onFactEdit || onFactDelete) && (
                          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                            {onFactEdit && (
                              <button
                                onClick={() => { setEditingIndex(i); setEditValue(fact.content); }}
                                className="p-1 rounded hover:bg-white/10 transition-colors"
                                title="编辑"
                              >
                                <Pencil size={10} className="text-zinc-500" />
                              </button>
                            )}
                            {onFactDelete && (
                              <button
                                onClick={() => onFactDelete(i)}
                                className="p-1 rounded hover:bg-red-500/20 transition-colors"
                                title="删除"
                              >
                                <Trash2 size={10} className="text-red-400/60" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {(onFactEdit || onFactDelete) && (
              <p className="text-[9px] text-amber-500/60 italic px-1">⚠ 修改后需重新生成脚本</p>
            )}

            {/* Myths */}
            {researchData.myths && researchData.myths.length > 0 && (
              <div className="space-y-2 pt-4 border-t border-white/5">
                <button
                  onClick={() => toggleSection('myths')}
                  className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500 py-2"
                >
                  <span>⚠ 常见误区 ({researchData.myths.length})</span>
                  <ChevronDown size={12} className={`transition-transform duration-300 ${expandedSections.includes('myths') ? 'rotate-180' : ''}`} />
                </button>
                {expandedSections.includes('myths') && (
                  <div className="space-y-2 animate-fade-in">
                    {researchData.myths.map((myth, i) => (
                      <div key={i} className="p-3 rounded-lg bg-red-900/10 border border-red-500/20 text-xs text-zinc-400 italic">
                        {myth}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Glossary */}
            {researchData.glossary && researchData.glossary.length > 0 && (
              <div className="space-y-2 pt-4 border-t border-white/5">
                <button
                  onClick={() => toggleSection('glossary')}
                  className="w-full flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-zinc-500 py-2"
                >
                  <span>📖 术语表 ({researchData.glossary.length})</span>
                  <ChevronDown size={12} className={`transition-transform duration-300 ${expandedSections.includes('glossary') ? 'rotate-180' : ''}`} />
                </button>
                {expandedSections.includes('glossary') && (
                  <div className="space-y-2 animate-fade-in">
                    {researchData.glossary.map((item, i) => (
                      <div key={i} className="p-3 rounded-lg bg-emerald-900/10 border border-emerald-500/20">
                        <div className="text-[10px] font-bold text-emerald-400 mb-1 font-mono">{item.term}</div>
                        <div className="text-[10px] text-zinc-500 leading-relaxed">{item.definition}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
