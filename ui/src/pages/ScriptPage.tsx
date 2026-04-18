import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Save, SkipForward, ArrowRight, ChevronDown, ChevronUp, FileText, Pencil, RefreshCw } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { logger } from '../lib/logger';
import { ScriptEditorPanel } from '../components/script/ScriptEditorPanel';
import { ScriptQualityPanel } from '../components/script/ScriptQualityPanel';
import { useAutoSave } from '../hooks/useAutoSave';
import { usePageGuard } from '../hooks/usePageGuard';
import { api } from '../api/client';
import { FloatingActionBar } from '../components/FloatingActionBar';
import { StageReviewShell, deriveActiveStage } from '../components/StageReviewShell';
import { ConfirmModal } from '../components/ConfirmModal';
import { ArtifactReportPanel } from '../components/ArtifactReportPanel';

const SCRIPT_STAGES = ['RESEARCH', 'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW'] as const;


/* ---- Script Audit Report (collapsible) ---- */

function ScriptAuditSection({ audit }: {
  audit: {
    corrections?: Array<{ original?: string; corrected?: string; reason?: string }>;
    styleConsistency?: number;
    summary?: string;
    issues?: string[];
  };
}) {
  const hasCorrections = audit.corrections && audit.corrections.length > 0;
  const [expanded, setExpanded] = useState(!!hasCorrections);

  // Sync expanded when audit data changes (async re-fetch)
  useEffect(() => {
    if (hasCorrections) setExpanded(true);
  }, [hasCorrections]);

  const hasIssues = audit.issues && audit.issues.length > 0;
  if (!hasCorrections && !hasIssues && !audit.summary) return null;

  return (
    <div className="mx-8 mb-4 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <FileText size={14} className="text-zinc-500" />
          📝 脚本审计报告
          {audit.styleConsistency != null && (
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
              audit.styleConsistency >= 0.8 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : audit.styleConsistency >= 0.6 ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
            }`}>
              风格一致性 {(audit.styleConsistency * 100).toFixed(0)}%
            </span>
          )}
        </span>
        {expanded ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {audit.summary && (
            <p className="text-xs text-zinc-400 leading-relaxed">{audit.summary}</p>
          )}

          {hasCorrections && (
            <div className="space-y-1.5">
              <h5 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">自动修正</h5>
              {audit.corrections!.map((c, i) => (
                <div key={i} className="rounded-lg bg-zinc-800/50 border border-zinc-700/50 p-3 space-y-1">
                  {c.original && (
                    <p className="text-[11px] text-red-400/70 line-through">{c.original}</p>
                  )}
                  {c.corrected && (
                    <p className="text-[11px] text-emerald-400">{c.corrected}</p>
                  )}
                  {c.reason && (
                    <p className="text-[10px] text-zinc-500 italic">{c.reason}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {hasIssues && (
            <div className="space-y-1.5">
              <h5 className="text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">发现的问题</h5>
              {audit.issues!.map((issue, i) => (
                <div key={i} className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/5 border border-amber-500/10">
                  <span className="text-amber-400 mt-0.5 shrink-0 text-xs">⚠️</span>
                  <span className="text-[11px] text-amber-300/90 leading-relaxed">{issue}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/** Split script text into scene-level chunks (by ## Scene N / 场景 N headers) */
function splitScriptToScenes(scriptText: string): string[] {
  if (!scriptText.trim()) return [];
  const pattern = /^(?=#{1,3}\s*(?:Scene|场景|幕)\s*\d)/im;
  const parts = scriptText.split(pattern).filter((s) => s.trim());
  return parts.length > 0 ? parts : [scriptText];
}

/** Join scene chunks back into a single script string */
function joinScenes(scenes: string[]): string {
  return scenes.join('\n\n');
}

/** Count words (handles both CJK and western text) */
function countWords(text: string): number {
  const plain = text.replace(/##.*\n/g, '').replace(/\[Fact-\d+\]/g, '').trim();
  return (plain.match(/[\w'-]+/g) || []).length + (plain.match(/[\u4e00-\u9fa5]/g) || []).length;
}

export function ScriptPage() {
  const guardReady = usePageGuard(['STYLE_EXTRACTION']);
  const { current, resumePipeline, updateScript, qaOverride, retryStage } = useProject();
  const navigate = useNavigate();
  const draftKey = current?.id ? `script-${current.id}` : 'script-new';
  const [editingScript, setEditingScript, hasDraft, clearDraft] = useAutoSave(draftKey, '');
  const [activeBeatIndex, setActiveBeatIndex] = useState<number | null>(null);
  const [showQaOverrideConfirm, setShowQaOverrideConfirm] = useState(false);
  const [editModeAfterDone, setEditModeAfterDone] = useState(false);
  const [showDirectiveDialog, setShowDirectiveDialog] = useState(false);
  const [directive, setDirective] = useState('');
  const [retrying, setRetrying] = useState(false);


  // Artifact data loaded lazily
  const [researchData, setResearchData] = useState<any>(null);
  const [narrativeMap, setNarrativeMap] = useState<any[] | null>(null);
  const [scriptValidation, setScriptValidation] = useState<any>(null);
  const [contaminationCheck, setContaminationCheck] = useState<any>(null);
  const [scriptAudit, setScriptAudit] = useState<{
    corrections?: Array<{ original?: string; corrected?: string; reason?: string }>;
    styleConsistency?: number;
    summary?: string;
    issues?: string[];
  } | null>(null);

  // Derive a fingerprint from relevant stage statuses so artifacts reload when stages complete
  const artifactTrigger = current
    ? SCRIPT_STAGES.map(s => current.stageStatus[s] ?? '').join(',')
    : '';

  const scriptText = current?.scriptOutput?.scriptText ?? '';
  const isPausedAtScripting = current?.isPaused && current?.pausedAtStage === 'SCRIPT_GENERATION';
  const isPausedAtQA = current?.isPaused && current?.pausedAtStage === 'QA_REVIEW';

  // Load artifacts when project is available or when relevant stages change status
  useEffect(() => {
    if (!current?.id) return;
    const projectId = current.id;
    api.loadArtifact(projectId, 'research.json').then(setResearchData).catch(() => {});
    api.loadArtifact<{ narrativeMap?: any[] }>(projectId, 'narrative-map.json')
      .then((d) => setNarrativeMap((d as any)?.narrativeMap ?? (d as any)?.narrative_map ?? null))
      .catch(() => {});
    api.loadArtifact(projectId, 'contamination-check.json').then(setContaminationCheck).catch(() => {});
    api.loadArtifact(projectId, 'script-validation-post-audit.json')
      .then(setScriptValidation)
      .catch(() => {
        api.loadArtifact(projectId, 'script-validation.json').then(setScriptValidation).catch(() => {});
      });
    api.loadArtifact<any>(projectId, 'script-audit.json').then(setScriptAudit).catch(() => {});
  }, [current?.id, artifactTrigger]);

  useEffect(() => {
    if (isPausedAtScripting && scriptText && !editingScript) {
      setEditingScript(scriptText);
    }
  }, [isPausedAtScripting, scriptText, editingScript]);

  const scriptScenes = useMemo(() => {
    const src = (isPausedAtScripting || editModeAfterDone) ? editingScript : scriptText;
    return splitScriptToScenes(src);
  }, [isPausedAtScripting, editModeAfterDone, editingScript, scriptText]);

  const currentWordCount = useMemo(() => countWords((isPausedAtScripting || editModeAfterDone) ? editingScript : scriptText), [isPausedAtScripting, editModeAfterDone, editingScript, scriptText]);

  const handleSceneChange = useCallback((index: number, newContent: string) => {
    const updated = [...scriptScenes];
    updated[index] = newContent;
    setEditingScript(joinScenes(updated));
  }, [scriptScenes, setEditingScript]);

  if (!current || !guardReady) return null;

  const handleSaveScript = async () => {
    logger.info('user', 'save_script', { projectId: current.id, length: editingScript.length });
    await updateScript(current.id, editingScript);
    clearDraft();
  };

  const handleResume = async () => {
    logger.info('user', 'resume_pipeline', { projectId: current.id, from: 'script' });
    await resumePipeline(current.id);
  };

  const handleFactEdit = useCallback((index: number, content: string) => {
    if (!researchData?.facts || !current?.id) return;
    const updated = { ...researchData, facts: researchData.facts.map((f: any, i: number) => i === index ? { ...f, content } : f) };
    setResearchData(updated);
    api.updateArtifact(current.id, 'research.json', updated).catch(() => {});
  }, [researchData, current?.id]);

  const handleFactDelete = useCallback((index: number) => {
    if (!researchData?.facts || !current?.id) return;
    const updated = { ...researchData, facts: researchData.facts.filter((_: any, i: number) => i !== index) };
    setResearchData(updated);
    api.updateArtifact(current.id, 'research.json', updated).catch(() => {});
  }, [researchData, current?.id]);

  const handleBeatEdit = useCallback((index: number, updates: Partial<{ description: string; word_budget: number }>) => {
    if (!narrativeMap || !current?.id) return;
    const updatedMap = narrativeMap.map((b: any, i: number) => i === index ? { ...b, ...updates } : b);
    setNarrativeMap(updatedMap);
    api.updateArtifact(current.id, 'narrative-map.json', { narrativeMap: updatedMap }).catch(() => {});
  }, [narrativeMap, current?.id]);

  const handleRegenerateScript = useCallback(async () => {
    if (!current?.id || retrying) return;
    setRetrying(true);
    logger.info('user', 'regenerate_script', { projectId: current.id, hasDirective: !!directive.trim() });
    try {
      await retryStage(current.id, 'SCRIPT_GENERATION' as any, directive.trim() || undefined);
    } finally {
      setRetrying(false);
      setShowDirectiveDialog(false);
      setDirective('');
    }
  }, [current?.id, retrying, directive, retryStage]);

  const showEditor = isPausedAtScripting || isPausedAtQA || (!isPausedAtScripting && !isPausedAtQA && scriptText);
  const allScriptDone = ['RESEARCH', 'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW'].every(
    (s) => (current.stageStatus ?? {} as any)[s as keyof typeof current.stageStatus] === 'completed'
  );
  const isScriptEditable = isPausedAtScripting || editModeAfterDone;
  const styleConfidence = ((current.styleProfile as any)?.nodeConfidence ?? {}) as Record<string, 'confident' | 'inferred' | 'guess' | 'computed'>;
  const validationData = scriptValidation ?? contaminationCheck?.scriptValidation ?? null;

  const { stageName, stageLabel, status: activeStatus } = deriveActiveStage(SCRIPT_STAGES, current.stageStatus);

  // Derive scene indices with issues from QA review
  const issueSceneIndices = useMemo(() => {
    const indices = new Set<number>();
    const qa = current.qaReviewResult;
    if (qa?.unfilmableSentences) {
      for (const s of qa.unfilmableSentences) {
        if (s.index != null) indices.add(s.index);
      }
    }
    return indices;
  }, [current.qaReviewResult]);

  // QA issues for the issues slot
  const qaIssues = isPausedAtQA && current.qaReviewResult && !current.qaReviewResult.approved ? (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/20 bg-amber-500/5 text-xs text-amber-400">
      <span>⚠ QA 审核未通过 — {current.qaReviewResult.summary ?? '请检查脚本质量'}</span>
    </div>
  ) : undefined;

  return (
    <div className="flex flex-col h-full">
      <StageReviewShell
        stageName={stageName}
        stageLabel={stageLabel}
        stageStatus={activeStatus}
        issues={qaIssues}
      >

        {/* Three-panel layout */}
        {showEditor ? (
        <>
        <div className="flex-1 flex overflow-hidden gap-4">
          <div className="flex-1 min-w-0">
            <ScriptEditorPanel
              scriptScenes={scriptScenes}
              activeBeatIndex={activeBeatIndex}
              isLoading={!scriptText && !isPausedAtScripting}
              qaReview={isPausedAtQA ? (current.qaReviewResult ?? null) : null}
              isPausedAtQA={!!isPausedAtQA}
              onFocus={setActiveBeatIndex}
              onBlur={() => setActiveBeatIndex(null)}
              onChange={isScriptEditable ? handleSceneChange : () => {}}
              onResume={handleResume}
              onQaOverride={isPausedAtQA && current.qaReviewResult && !current.qaReviewResult.approved
                ? () => setShowQaOverrideConfirm(true)
                : undefined}
              issueSceneIndices={issueSceneIndices.size > 0 ? issueSceneIndices : undefined}
            />
          </div>

          <ScriptQualityPanel
            qaReview={current.qaReviewResult ?? null}
            scriptValidation={validationData}
            contaminationCheck={contaminationCheck}
            styleConfidence={styleConfidence}
            researchData={researchData}
            narrativeMap={narrativeMap}
            onFactEdit={handleFactEdit}
            onFactDelete={handleFactDelete}
            onBeatEdit={handleBeatEdit}
          />
          <ConfirmModal
            isOpen={showQaOverrideConfirm}
            title="覆盖 QA 审查"
            description="QA 审查发现了质量问题。覆盖后将跳过审查直接继续，可能影响最终视频质量。确定要强制继续吗？"
            confirmLabel="覆盖并继续"
            variant="warning"
            onConfirm={() => { setShowQaOverrideConfirm(false); qaOverride(current.id, '用户手动覆盖审查结果'); }}
            onCancel={() => setShowQaOverrideConfirm(false)}
          />
        </div>

        {/* Script audit panel — shown below the three-panel editor */}
        {scriptAudit && <ScriptAuditSection audit={scriptAudit} />}

        {/* Quality reports */}
        <ArtifactReportPanel
          projectId={current.id}
          reports={[
            { filename: 'fact-verification.json', label: '事实验证报告' },
          ]}
        />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
          脚本尚未生成，请先启动流水线
        </div>
      )}
      </StageReviewShell>

      <FloatingActionBar
        hint={
          isPausedAtScripting ? 'AI 已生成脚本，请审阅后保存并继续，或跳过直接采用'
          : isPausedAtQA ? 'QA 审核已完成，请确认脚本质量后继续'
          : editModeAfterDone ? '正在编辑脚本，保存后可继续到视觉阶段'
          : allScriptDone ? '脚本已完成，可以编辑微调或直接继续到视觉设计'
          : undefined
        }
        actions={[
        ...(isPausedAtScripting ? [
          { label: '保存并继续', icon: <Save size={14} />, onClick: async () => { await handleSaveScript(); await handleResume(); } },
          { label: '跳过', icon: <SkipForward size={14} />, onClick: handleResume, variant: 'secondary' as const },
        ] : []),
        ...(isPausedAtQA ? [
          { label: '确认脚本', onClick: handleResume },
        ] : []),
        ...(allScriptDone && !editModeAfterDone ? [
          { label: '重新生成脚本', icon: <RefreshCw size={14} />, onClick: () => setShowDirectiveDialog(true), variant: 'secondary' as const },
          { label: '编辑脚本', icon: <Pencil size={14} />, onClick: () => { setEditingScript(scriptText); setEditModeAfterDone(true); }, variant: 'secondary' as const },
          { label: '继续到视觉', icon: <ArrowRight size={14} />, onClick: () => navigate('../storyboard') },
        ] : []),
        ...(editModeAfterDone ? [
          { label: '保存脚本', icon: <Save size={14} />, onClick: async () => { await handleSaveScript(); setEditModeAfterDone(false); } },
          { label: '取消编辑', onClick: () => { setEditingScript(''); setEditModeAfterDone(false); }, variant: 'secondary' as const },
        ] : []),
      ]} />

      {/* Directive dialog for script regeneration */}
      {showDirectiveDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowDirectiveDialog(false)}>
          <div className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-full max-w-md shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-zinc-200 mb-3">重新生成脚本</h3>
            <p className="text-xs text-zinc-400 mb-3">可以输入修改指令，AI 将在重新生成时参考。留空则按原始设定重新生成。</p>
            <textarea
              className="w-full h-24 bg-zinc-800 border border-zinc-600 rounded-lg p-3 text-sm text-zinc-200 placeholder-zinc-500 resize-none focus:outline-none focus:border-indigo-500"
              placeholder="例如：语气更轻松一些、增加更多数据引用、缩短开头部分…"
              value={directive}
              onChange={(e) => setDirective(e.target.value)}
              autoFocus
            />
            <div className="flex justify-end gap-2 mt-3">
              <button
                className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                onClick={() => { setShowDirectiveDialog(false); setDirective(''); }}
              >
                取消
              </button>
              <button
                className="px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors disabled:opacity-50"
                onClick={handleRegenerateScript}
                disabled={retrying}
              >
                {retrying ? '重新生成中…' : '确认重新生成'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
