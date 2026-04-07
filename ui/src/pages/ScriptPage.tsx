import { useState, useEffect } from 'react';
import { Save, SkipForward, CheckCircle, ShieldCheck, Unlock } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { SubStageProgress } from '../components/SubStageProgress';

const SCRIPT_STAGES = ['RESEARCH', 'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW'] as const;

export function ScriptPage() {
  const { current, resumePipeline, updateScript, qaOverride } = useProject();
  const [editingScript, setEditingScript] = useState('');

  const scriptText = current?.scriptOutput?.scriptText ?? '';
  const isPausedAtScripting = current?.isPaused && current?.pausedAtStage === 'SCRIPT_GENERATION';
  const isPausedAtQA = current?.isPaused && current?.pausedAtStage === 'QA_REVIEW';

  useEffect(() => {
    if (isPausedAtScripting && scriptText && !editingScript) {
      setEditingScript(scriptText);
    }
  }, [isPausedAtScripting, scriptText, editingScript]);

  if (!current) return null;

  const handleSaveScript = async () => {
    await updateScript(current.id, editingScript);
  };

  const handleResume = async () => {
    await resumePipeline(current.id);
  };

  const allDone = SCRIPT_STAGES.every((s) => current.stageStatus[s] === 'completed');

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-bold text-zinc-100">✍️ 脚本创作</h3>
      <SubStageProgress stages={[...SCRIPT_STAGES]} stageStatus={current.stageStatus} />

      {/* Script editor */}
      {isPausedAtScripting && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
          <h4 className="text-sm font-semibold text-zinc-200">✍️ 脚本编辑器</h4>
          <p className="text-xs text-zinc-500">审核并修改脚本内容，满意后点击"保存并继续"</p>
          <textarea
            rows={16}
            value={editingScript}
            onChange={(e) => setEditingScript(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500/50 font-mono leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={async () => { await handleSaveScript(); await handleResume(); }}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
            >
              <Save size={14} /> 保存并继续
            </button>
            <button
              onClick={handleResume}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors"
            >
              <SkipForward size={14} /> 跳过编辑，继续
            </button>
          </div>
        </div>
      )}

      {/* QA Review */}
      {isPausedAtQA && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
          <h4 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
            <ShieldCheck size={14} /> 质量审查报告
          </h4>
          <p className="text-xs text-zinc-500">以下是 AI 质量审查的结果，请确认后继续</p>
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-2">
            {current.qaReviewResult && (
              <>
                <div className="text-sm text-zinc-300">
                  状态:{' '}
                  <span className={`font-bold ${current.qaReviewResult.approved ? 'text-emerald-400' : 'text-red-400'}`}>
                    {current.qaReviewResult.approved ? '✅ 已通过' : '❌ 未通过'}
                  </span>
                  {current.qaReviewResult.scores && (
                    <span className="ml-2 text-zinc-500">评分: {current.qaReviewResult.scores.overall}/10</span>
                  )}
                </div>
                {current.qaReviewResult.feedback && (
                  <p className="text-xs text-zinc-400">{current.qaReviewResult.feedback}</p>
                )}
                {current.qaReviewResult.issues && current.qaReviewResult.issues.length > 0 && (
                  <ul className="space-y-1">
                    {current.qaReviewResult.issues.map((issue: string, i: number) => (
                      <li key={i} className="text-xs text-amber-400">⚠️ {issue}</li>
                    ))}
                  </ul>
                )}
              </>
            )}
            {!current.qaReviewResult && <p className="text-xs text-zinc-500">审查结果尚未生成</p>}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleResume}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-colors"
            >
              <CheckCircle size={14} /> 确认并继续
            </button>
            {current.qaReviewResult && !current.qaReviewResult.approved && (
              <button
                onClick={() => qaOverride(current.id, '用户手动覆盖审查结果')}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg hover:bg-amber-500/20 transition-colors"
              >
                <Unlock size={14} /> 覆盖审查并继续
              </button>
            )}
          </div>
        </div>
      )}

      {/* Read-only script view */}
      {!isPausedAtScripting && !isPausedAtQA && scriptText && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-2">
          <h4 className="text-sm font-semibold text-zinc-200">📄 脚本内容</h4>
          <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-mono bg-zinc-900/60 rounded-lg p-3 border border-zinc-800 max-h-96 overflow-y-auto">{scriptText}</pre>
        </div>
      )}

      {allDone && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 text-emerald-400 text-sm font-medium">
          <CheckCircle size={16} /> 脚本创作已完成 — 可进入下一步
        </div>
      )}
    </div>
  );
}
