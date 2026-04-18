import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, ShieldAlert, ShieldCheck } from 'lucide-react';

type ConfidenceLevel = 'confident' | 'inferred' | 'guess' | 'computed';

interface QaReviewData {
  approved: boolean;
  feedback?: string;
  scores?: {
    accuracy: number;
    styleConsistency: number;
    productionReadiness: number;
    engagement: number;
    overall: number;
  };
  issues?: string[];
  suspiciousNumericClaims?: Array<{ claim: string; reason: string }>;
  styleDeviations?: string[];
  unfilmableSentences?: Array<{ index: number; text: string; reason: string }>;
  contentContamination?: {
    score: number;
    copiedPhrases: string[];
    reusedFacts: string[];
    reusedMetaphors: string[];
  };
  seriesConsistency?: {
    score: number;
    hookStructureMatch: boolean;
    closingStructureMatch: boolean;
    rhythmSimilarity: 'high' | 'medium' | 'low';
    arcAllocationMatch: boolean;
    deviations: string[];
  };
}

interface ScriptValidationData {
  passed?: boolean;
  errors?: string[];
  warnings?: string[];
  metrics?: {
    actualWordCount?: number;
    targetWordCountMin?: number;
    targetWordCountMax?: number;
    sourceMarkerRatio?: number;
    transcriptOverlapRatio?: number;
    repeatedNgramCount?: number;
    rhythmCorrelation?: number | null;
    hookStructureMatch?: boolean | null;
    closingStructureMatch?: boolean | null;
  };
  classifiedErrors?: Array<{ class?: string; code?: string; message?: string }>;
}

interface ContaminationCheckData {
  ngram?: {
    score?: number;
    overlappingPhrases?: string[];
    isBlocking?: boolean;
  } | null;
  sourceMarkers?: {
    unmarkedClaims?: string[];
  } | null;
}

interface ResearchData {
  facts?: Array<{ content: string; source?: string }>;
}

interface NarrativeBeat {
  title?: string;
  description?: string;
  word_budget?: number;
  beat_type?: string;
}

function scoreColor(score: number) {
  if (score >= 8) return 'text-emerald-400';
  if (score >= 6) return 'text-amber-400';
  return 'text-red-400';
}

function confidenceLabel(level: ConfidenceLevel) {
  if (level === 'guess') return '猜测';
  if (level === 'inferred') return '推断';
  if (level === 'computed') return '计算';
  return '可信';
}

function confidenceBadge(level: ConfidenceLevel) {
  if (level === 'guess') return 'bg-red-500/10 text-red-300 border-red-500/30';
  if (level === 'inferred') return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
  if (level === 'computed') return 'bg-blue-500/10 text-blue-300 border-blue-500/30';
  return 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30';
}

function Section({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-left text-xs font-semibold text-zinc-300 hover:bg-zinc-800/50 transition-colors"
      >
        <span>{title}</span>
        {open ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
      </button>
      {open && <div className="px-3 pb-3 space-y-2">{children}</div>}
    </div>
  );
}

export function ScriptQualityPanel({
  qaReview,
  scriptValidation,
  contaminationCheck,
  styleConfidence,
  researchData,
  narrativeMap,
  onFactEdit,
  onFactDelete,
  onBeatEdit,
}: {
  qaReview: QaReviewData | null;
  scriptValidation: ScriptValidationData | null;
  contaminationCheck: ContaminationCheckData | null;
  styleConfidence: Record<string, ConfidenceLevel>;
  researchData: ResearchData | null;
  narrativeMap: NarrativeBeat[] | null;
  onFactEdit?: (index: number, content: string) => void;
  onFactDelete?: (index: number) => void;
  onBeatEdit?: (index: number, updates: Partial<{ description: string; word_budget: number }>) => void;
}) {
  const confidenceWarnings = useMemo(
    () =>
      Object.entries(styleConfidence).filter(([, level]) => level === 'guess' || level === 'inferred') as Array<[
        string,
        ConfidenceLevel,
      ]>,
    [styleConfidence],
  );

  const [editingFact, setEditingFact] = useState<number | null>(null);
  const [factDraft, setFactDraft] = useState('');
  const [editingBeat, setEditingBeat] = useState<number | null>(null);
  const [beatDraft, setBeatDraft] = useState('');
  const [beatBudgetDraft, setBeatBudgetDraft] = useState<number | undefined>();

  const ngram = contaminationCheck?.ngram;
  const sourceMarkers = contaminationCheck?.sourceMarkers;
  const metrics = scriptValidation?.metrics;

  return (
    <aside className="w-[380px] shrink-0 overflow-y-auto pr-1 custom-scrollbar space-y-3">
      {/* Prominent issues list at top */}
      {qaReview && (
        (() => {
          const allIssues: Array<{ text: string; severity: 'red' | 'amber' }> = [];
          if (qaReview.issues) {
            for (const issue of qaReview.issues) allIssues.push({ text: issue, severity: 'amber' });
          }
          if (qaReview.unfilmableSentences) {
            for (const s of qaReview.unfilmableSentences) allIssues.push({ text: `不可拍摄: ${s.text}${s.reason ? ` — ${s.reason}` : ''}`, severity: 'red' });
          }
          if (qaReview.suspiciousNumericClaims) {
            for (const c of qaReview.suspiciousNumericClaims) allIssues.push({ text: `可疑数字: ${c.claim}${c.reason ? ` — ${c.reason}` : ''}`, severity: 'amber' });
          }
          if (qaReview.styleDeviations) {
            for (const d of qaReview.styleDeviations) allIssues.push({ text: `风格偏离: ${d}`, severity: 'amber' });
          }
          if (allIssues.length === 0) return null;
          return (
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-bold text-red-300 mb-1">
                <AlertTriangle size={12} /> 需要关注的问题 ({allIssues.length})
              </div>
              {allIssues.map((item, i) => (
                <div
                  key={i}
                  className={`text-[11px] px-2 py-1.5 rounded border ${
                    item.severity === 'red'
                      ? 'text-red-300 bg-red-500/10 border-red-500/20'
                      : 'text-amber-300 bg-amber-500/10 border-amber-500/20'
                  }`}
                >
                  {item.text}
                </div>
              ))}
            </div>
          );
        })()
      )}

      <Section title="质量总览" defaultOpen>
        {!qaReview ? (
          <p className="text-xs text-zinc-500">尚未生成 QA 审核数据</p>
        ) : (
          <>
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-bold ${
                  qaReview.approved
                    ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                    : 'bg-red-500/10 border-red-500/30 text-red-300'
                }`}
              >
                {qaReview.approved ? <CheckCircle2 size={12} /> : <ShieldAlert size={12} />}
                {qaReview.approved ? '审查通过' : '需要人工处理'}
              </span>
              {qaReview.scores?.overall != null && (
                <span className={`text-lg font-bold ${scoreColor(qaReview.scores.overall)}`}>
                  {qaReview.scores.overall}/10
                </span>
              )}
            </div>
            {qaReview.feedback && <p className="text-xs text-zinc-400 leading-relaxed">{qaReview.feedback}</p>}

            {qaReview.scores && (
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="rounded bg-zinc-800/60 px-2 py-1.5">准确性: <span className={scoreColor(qaReview.scores.accuracy ?? 0)}>{qaReview.scores.accuracy ?? 0}</span></div>
                <div className="rounded bg-zinc-800/60 px-2 py-1.5">风格一致: <span className={scoreColor(qaReview.scores.styleConsistency ?? 0)}>{qaReview.scores.styleConsistency ?? 0}</span></div>
                <div className="rounded bg-zinc-800/60 px-2 py-1.5">可制作性: <span className={scoreColor(qaReview.scores.productionReadiness ?? 0)}>{qaReview.scores.productionReadiness ?? 0}</span></div>
                <div className="rounded bg-zinc-800/60 px-2 py-1.5">吸引力: <span className={scoreColor(qaReview.scores.engagement ?? 0)}>{qaReview.scores.engagement ?? 0}</span></div>
              </div>
            )}

            {qaReview.issues && qaReview.issues.length > 0 && (
              <div className="space-y-1">
                {qaReview.issues.map((issue, i) => (
                  <div key={i} className="text-[11px] text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded px-2 py-1.5">
                    {issue}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Section>

      <Section title="Series Consistency" defaultOpen={false}>
        {!qaReview?.seriesConsistency ? (
          <p className="text-xs text-zinc-500">未返回 seriesConsistency 数据</p>
        ) : (
          <div className="space-y-2 text-[11px] text-zinc-300">
            <div className="font-semibold">评分: <span className={scoreColor(qaReview.seriesConsistency.score)}>{qaReview.seriesConsistency.score}/10</span></div>
            <div className="grid grid-cols-2 gap-1.5">
              <span className="px-2 py-1 rounded bg-zinc-800/70">Hook 模板: {qaReview.seriesConsistency.hookStructureMatch ? '匹配' : '偏离'}</span>
              <span className="px-2 py-1 rounded bg-zinc-800/70">Closing 模板: {qaReview.seriesConsistency.closingStructureMatch ? '匹配' : '偏离'}</span>
              <span className="px-2 py-1 rounded bg-zinc-800/70">节奏相似: {qaReview.seriesConsistency.rhythmSimilarity}</span>
              <span className="px-2 py-1 rounded bg-zinc-800/70">弧线分配: {qaReview.seriesConsistency.arcAllocationMatch ? '匹配' : '偏离'}</span>
            </div>
            {(qaReview.seriesConsistency.deviations ?? []).length > 0 && (
              <div className="space-y-1">
                {(qaReview.seriesConsistency.deviations ?? []).map((d, i) => (
                  <div key={i} className="text-[11px] text-zinc-400">• {d}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="污染与来源检测" defaultOpen>
        <div className="space-y-2 text-[11px]">
          {ngram ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2">
              <div className="flex items-center justify-between">
                <span className="text-zinc-300">n-gram 重叠</span>
                <span className={ngram.isBlocking ? 'text-red-300' : 'text-zinc-300'}>
                  {((ngram.score ?? 0) * 100).toFixed(1)}%
                </span>
              </div>
              {!!ngram.overlappingPhrases?.length && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {ngram.overlappingPhrases.slice(0, 8).map((phrase, i) => (
                    <span key={i} className="px-1.5 py-0.5 rounded bg-red-500/10 border border-red-500/20 text-red-200 text-[10px]">
                      {phrase}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-zinc-500">未检测到 n-gram 数据</p>
          )}

          {sourceMarkers ? (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2">
              <div className="text-zinc-300 mb-1">来源标记缺失</div>
              {sourceMarkers.unmarkedClaims?.length ? (
                sourceMarkers.unmarkedClaims.slice(0, 6).map((claim, i) => (
                  <div key={i} className="text-amber-300 text-[11px]">• {claim}</div>
                ))
              ) : (
                <div className="text-emerald-300 text-[11px]">未发现缺失标记的数字声明</div>
              )}
            </div>
          ) : (
            <p className="text-zinc-500">未检测到来源标记数据</p>
          )}

          {qaReview?.contentContamination && (
            <div className="rounded-lg border border-zinc-700 bg-zinc-800/50 p-2 space-y-1">
              <div className="text-zinc-300">AI 自评污染分: {((qaReview.contentContamination.score ?? 0) * 100).toFixed(1)}%</div>
              {(qaReview.contentContamination.copiedPhrases ?? []).length > 0 && (
                <div className="text-red-300">复制短语: {(qaReview.contentContamination.copiedPhrases ?? []).join(' / ')}</div>
              )}
              {(qaReview.contentContamination.reusedFacts ?? []).length > 0 && (
                <div className="text-amber-300">复用事实: {(qaReview.contentContamination.reusedFacts ?? []).join(' / ')}</div>
              )}
              {(qaReview.contentContamination.reusedMetaphors ?? []).length > 0 && (
                <div className="text-amber-300">复用隐喻: {(qaReview.contentContamination.reusedMetaphors ?? []).join(' / ')}</div>
              )}
            </div>
          )}
        </div>
      </Section>

      <Section title="Script Validation 指标" defaultOpen={false}>
        {!scriptValidation ? (
          <p className="text-xs text-zinc-500">未找到 script-validation 数据</p>
        ) : (
          <div className="space-y-2 text-[11px]">
            <div className={`inline-flex items-center gap-1 px-2 py-1 rounded border ${scriptValidation.passed ? 'text-emerald-300 border-emerald-500/30 bg-emerald-500/10' : 'text-red-300 border-red-500/30 bg-red-500/10'}`}>
              {scriptValidation.passed ? <ShieldCheck size={12} /> : <AlertTriangle size={12} />}
              {scriptValidation.passed ? '验证通过' : '验证未通过'}
            </div>
            {metrics && (
              <div className="grid grid-cols-2 gap-1.5">
                <span className="rounded bg-zinc-800/60 px-2 py-1">字数: {metrics.actualWordCount ?? '-'}</span>
                <span className="rounded bg-zinc-800/60 px-2 py-1">目标: {metrics.targetWordCountMin ?? '-'}-{metrics.targetWordCountMax ?? '-'}</span>
                <span className="rounded bg-zinc-800/60 px-2 py-1">来源标记率: {metrics.sourceMarkerRatio != null ? `${(metrics.sourceMarkerRatio * 100).toFixed(0)}%` : '-'}</span>
                <span className="rounded bg-zinc-800/60 px-2 py-1">转录重叠: {metrics.transcriptOverlapRatio != null ? `${(metrics.transcriptOverlapRatio * 100).toFixed(1)}%` : '-'}</span>
                <span className="rounded bg-zinc-800/60 px-2 py-1">重复 ngram: {metrics.repeatedNgramCount ?? '-'}</span>
                <span className="rounded bg-zinc-800/60 px-2 py-1">节奏相关: {metrics.rhythmCorrelation != null ? metrics.rhythmCorrelation.toFixed(2) : '-'}</span>
              </div>
            )}
            {scriptValidation.errors && scriptValidation.errors.length > 0 && (
              <div className="space-y-1">
                {scriptValidation.errors.slice(0, 6).map((e, i) => (
                  <div key={i} className="text-red-300">• {e}</div>
                ))}
              </div>
            )}
            {scriptValidation.warnings && scriptValidation.warnings.length > 0 && (
              <div className="space-y-1">
                {scriptValidation.warnings.slice(0, 6).map((w, i) => (
                  <div key={i} className="text-amber-300">• {w}</div>
                ))}
              </div>
            )}
          </div>
        )}
      </Section>

      <Section title="低置信度约束" defaultOpen={false}>
        {confidenceWarnings.length === 0 ? (
          <p className="text-xs text-zinc-500">当前风格约束均为高置信度</p>
        ) : (
          <div className="space-y-1.5">
            {confidenceWarnings.map(([field, level]) => (
              <div key={field} className="flex items-center justify-between rounded bg-zinc-800/50 border border-zinc-700 px-2 py-1.5 text-[11px]">
                <span className="text-zinc-300 truncate mr-2">{field}</span>
                <span className={`px-1.5 py-0.5 rounded border text-[10px] ${confidenceBadge(level)}`}>
                  {confidenceLabel(level)}
                </span>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="研究素材（可编辑）" defaultOpen={false}>
        {!researchData?.facts?.length ? (
          <p className="text-xs text-zinc-500">暂无 research facts</p>
        ) : (
          <div className="space-y-2">
            {researchData.facts.slice(0, 12).map((fact, i) => (
              <div key={i} className="rounded border border-zinc-700 bg-zinc-800/50 p-2 space-y-1">
                {editingFact === i ? (
                  <>
                    <textarea
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300"
                      rows={3}
                      value={factDraft}
                      onChange={(e) => setFactDraft(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          onFactEdit?.(i, factDraft);
                          setEditingFact(null);
                        }}
                        className="px-2 py-1 rounded bg-indigo-600 text-white text-[10px]"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingFact(null)}
                        className="px-2 py-1 rounded bg-zinc-700 text-zinc-200 text-[10px]"
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-zinc-300 leading-relaxed">{fact.content}</p>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          setEditingFact(i);
                          setFactDraft(fact.content);
                        }}
                        className="px-2 py-1 rounded bg-zinc-700 text-zinc-200 text-[10px]"
                      >
                        编辑
                      </button>
                      <button
                        onClick={() => onFactDelete?.(i)}
                        className="px-2 py-1 rounded bg-red-500/20 text-red-300 text-[10px]"
                      >
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title="叙事结构（可编辑）" defaultOpen={false}>
        {!narrativeMap?.length ? (
          <p className="text-xs text-zinc-500">暂无 narrative map</p>
        ) : (
          <div className="space-y-2">
            {narrativeMap.map((beat, i) => (
              <div key={i} className="rounded border border-zinc-700 bg-zinc-800/50 p-2 space-y-1">
                <div className="text-[10px] text-indigo-300 font-bold uppercase tracking-wider">
                  {beat.title ?? beat.beat_type ?? `Beat ${i + 1}`}
                </div>
                {editingBeat === i ? (
                  <>
                    <textarea
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300"
                      rows={3}
                      value={beatDraft}
                      onChange={(e) => setBeatDraft(e.target.value)}
                    />
                    <input
                      type="number"
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300"
                      value={beatBudgetDraft ?? ''}
                      onChange={(e) => setBeatBudgetDraft(e.target.value ? Number(e.target.value) : undefined)}
                      placeholder="word budget"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          onBeatEdit?.(i, { description: beatDraft, word_budget: beatBudgetDraft });
                          setEditingBeat(null);
                        }}
                        className="px-2 py-1 rounded bg-indigo-600 text-white text-[10px]"
                      >
                        保存
                      </button>
                      <button
                        onClick={() => setEditingBeat(null)}
                        className="px-2 py-1 rounded bg-zinc-700 text-zinc-200 text-[10px]"
                      >
                        取消
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-[11px] text-zinc-300">{beat.description}</p>
                    <div className="text-[10px] text-zinc-500">字数预算: {beat.word_budget ?? '-'}</div>
                    <button
                      onClick={() => {
                        setEditingBeat(i);
                        setBeatDraft(beat.description ?? '');
                        setBeatBudgetDraft(beat.word_budget);
                      }}
                      className="px-2 py-1 rounded bg-zinc-700 text-zinc-200 text-[10px]"
                    >
                      编辑
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>
    </aside>
  );
}
