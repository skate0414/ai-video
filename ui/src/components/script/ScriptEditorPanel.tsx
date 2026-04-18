import { Loader2, ShieldCheck, Unlock, CheckCircle } from 'lucide-react';
import { SceneCard } from './SceneCard';

interface QaReviewResult {
  approved: boolean;
  scores?: { overall: number };
}

interface Props {
  scriptScenes: string[];
  activeBeatIndex: number | null;
  isLoading: boolean;
  qaReview: QaReviewResult | null;
  isPausedAtQA: boolean;
  onFocus: (index: number) => void;
  onBlur: () => void;
  onChange: (index: number, content: string) => void;
  onResume: () => void;
  onQaOverride?: () => void;
  /** Scene indices that have issues (orange border) */
  issueSceneIndices?: Set<number>;
}

export function ScriptEditorPanel({
  scriptScenes,
  activeBeatIndex,
  isLoading,
  qaReview,
  isPausedAtQA,
  onFocus,
  onBlur,
  onChange,
  onResume,
  onQaOverride,
  issueSceneIndices,
}: Props) {
  return (
    <section className="flex-1 min-w-[400px] flex flex-col relative h-full bg-studio-base">
      <div className="flex-grow overflow-y-auto relative p-8 pb-60 custom-scrollbar pt-20">
        <div className="max-w-3xl mx-auto space-y-24">
          {/* QA Review compact banner — details live in ScriptQualityPanel */}
          {isPausedAtQA && qaReview && (
            <div className={`rounded-xl bg-zinc-900/50 px-5 py-3 flex items-center justify-between border-l-4 border border-zinc-800 animate-fade-in ${
              qaReview.approved ? 'border-l-emerald-500' : 'border-l-red-500'
            }`}>
              <div className="flex items-center gap-3">
                <ShieldCheck size={16} className="text-zinc-400" />
                <span className={`text-sm font-semibold ${qaReview.approved ? 'text-emerald-400' : 'text-red-400'}`}>
                  {qaReview.approved ? '✅ 审查通过' : '❌ 未通过'}
                </span>
                {qaReview.scores && (
                  <span className="text-xs text-zinc-500">综合 {qaReview.scores.overall ?? 'N/A'}/10</span>
                )}
                <span className="text-[11px] text-zinc-600">详见右栏质量面板 →</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onResume}
                  className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
                >
                  <CheckCircle size={14} /> 确认并继续
                </button>
                {!qaReview.approved && onQaOverride && (
                  <button
                    onClick={onQaOverride}
                    className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors"
                  >
                    <Unlock size={14} /> 覆盖审查
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!scriptScenes.length && (
            <div className="text-center text-zinc-500 mt-20 flex flex-col items-center gap-3">
              {isLoading ? (
                <>
                  <Loader2 className="w-8 h-8 animate-spin text-accent" />
                  <span className="font-mono text-xs uppercase tracking-widest text-accent animate-pulse">正在生成脚本…</span>
                </>
              ) : (
                <span className="text-lg">脚本尚未生成</span>
              )}
            </div>
          )}

          {/* Scene cards */}
          {scriptScenes.map((sceneContent, index) => (
            <SceneCard
              key={index}
              index={index}
              content={sceneContent}
              isActive={activeBeatIndex === index}
              onFocus={onFocus}
              onBlur={onBlur}
              onChange={onChange}
              hasIssue={issueSceneIndices?.has(index)}
            />
          ))}

          {/* End marker */}
          {scriptScenes.length > 0 && (
            <div className="h-[40vh] flex flex-col items-center justify-start pt-24 border-t border-white/[0.02]">
              <div className="flex flex-col items-center gap-6 opacity-10 hover:opacity-40 transition-opacity duration-1000">
                <div className="w-px h-24 bg-gradient-to-b from-zinc-500 to-transparent" />
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-[0.6em] font-light">FIN</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
