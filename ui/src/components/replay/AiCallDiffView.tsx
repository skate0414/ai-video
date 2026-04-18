import { useState, useEffect } from 'react';
import type { AiCallDiff } from '../../types';
import { MessageSquare, ChevronDown, ChevronRight, AlertTriangle, CheckCircle2 } from 'lucide-react';

const STAGE_LABELS: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '能力评估', STYLE_EXTRACTION: '风格分析', RESEARCH: '资料调研',
  NARRATIVE_MAP: '叙事编排', SCRIPT_GENERATION: '脚本生成', QA_REVIEW: '质量审核',
  STORYBOARD: '分镜设计', VIDEO_IR_COMPILE: '视频编译', REFERENCE_IMAGE: '参考图', KEYFRAME_GEN: '关键帧',
  VIDEO_GEN: '视频生成', TTS: '语音合成', ASSEMBLY: '视频组装', REFINEMENT: '精修',
};

function ms(v: number): string {
  if (v < 1000) return `${v}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function pct(v: number): string {
  return `${(v * 100).toFixed(1)}%`;
}

function CallRow({ entry, highlighted, id }: { entry: AiCallDiff; highlighted?: boolean; id?: string }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (highlighted) setExpanded(true);
  }, [highlighted]);
  const hasError = entry.status === 'error';
  const stageLabel = STAGE_LABELS[entry.stage] ?? entry.stage;

  return (
    <div id={id} className={`border rounded-lg overflow-hidden transition-colors ${highlighted ? 'border-blue-400/50 ring-1 ring-blue-400/30' : 'border-zinc-700/40'}`}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/50 transition-colors"
      >
        {expanded ? <ChevronDown size={14} className="text-zinc-500 shrink-0" /> : <ChevronRight size={14} className="text-zinc-500 shrink-0" />}

        <span className="text-xs font-mono text-zinc-500 w-8 shrink-0">#{entry.seq}</span>

        {hasError
          ? <AlertTriangle size={13} className="text-red-400 shrink-0" />
          : <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />}

        <span className="text-xs text-zinc-300 font-medium truncate">{stageLabel}</span>
        <span className="text-xs text-zinc-500">·</span>
        <span className="text-xs text-zinc-400">{entry.method}</span>
        <span className="text-xs text-zinc-500">·</span>
        <span className="text-xs text-blue-400">{entry.provider}</span>
        {entry.model && (
          <>
            <span className="text-xs text-zinc-500">·</span>
            <span className="text-xs text-violet-400">{entry.model}</span>
          </>
        )}

        <span className="ml-auto text-xs text-zinc-500 shrink-0">{ms(entry.durationMs)}</span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-zinc-700/40 px-3 py-3 space-y-3 bg-zinc-950/30">
          {/* Diff summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="bg-zinc-900/50 rounded px-2 py-1">
              <div className="text-[10px] text-zinc-500">变化率</div>
              <div className="text-xs text-zinc-200 font-mono">{pct(entry.diffSummary.changeRatio)}</div>
            </div>
            <div className="bg-zinc-900/50 rounded px-2 py-1">
              <div className="text-[10px] text-zinc-500">共同前缀</div>
              <div className="text-xs text-zinc-200 font-mono">{entry.diffSummary.prefixMatchChars}</div>
            </div>
            <div className="bg-zinc-900/50 rounded px-2 py-1">
              <div className="text-[10px] text-zinc-500">输入变更</div>
              <div className="text-xs text-zinc-200 font-mono">{entry.diffSummary.changedBeforeChars}</div>
            </div>
            <div className="bg-zinc-900/50 rounded px-2 py-1">
              <div className="text-[10px] text-zinc-500">输出变更</div>
              <div className="text-xs text-zinc-200 font-mono">{entry.diffSummary.changedAfterChars}</div>
            </div>
          </div>

          {/* Input */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 font-semibold">输入 (Prompt)</div>
            <pre className="text-xs text-zinc-300 bg-zinc-900/60 rounded-md p-2 overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
              {entry.inputText}
            </pre>
          </div>

          {/* Output / Error */}
          <div>
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 font-semibold">
              {hasError ? '错误' : '输出 (Response)'}
            </div>
            {hasError ? (
              <pre className="text-xs text-red-300 bg-red-950/30 border border-red-900/30 rounded-md p-2 overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
                {entry.errorText}
              </pre>
            ) : (
              <pre className="text-xs text-emerald-300 bg-zinc-900/60 rounded-md p-2 overflow-x-auto max-h-60 whitespace-pre-wrap break-words">
                {entry.outputText}
              </pre>
            )}
          </div>

          {/* Focused diff preview */}
          <div className="grid sm:grid-cols-2 gap-2">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 font-semibold">差异片段 (输入侧)</div>
              <pre className="text-xs text-zinc-400 bg-zinc-900/50 rounded-md p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-words">
                {entry.preview.before || '(无)'}
              </pre>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1 font-semibold">差异片段 (输出侧)</div>
              <pre className="text-xs text-zinc-200 bg-zinc-900/50 rounded-md p-2 overflow-x-auto max-h-40 whitespace-pre-wrap break-words">
                {entry.preview.after || '(无)'}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AiCallDiffView({ diffs, highlightIndex }: { diffs: AiCallDiff[]; highlightIndex?: number | null }) {
  if (diffs.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4">
        <h3 className="text-sm font-semibold text-zinc-300">AI 调用详情</h3>
        <p className="text-xs text-zinc-600 mt-2">无 AI 调用差异数据</p>
      </div>
    );
  }

  const errorCount = diffs.filter(l => l.status === 'error').length;

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <MessageSquare size={16} className="text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-300">AI 调用详情</h3>
        <span className="text-xs text-zinc-500">{diffs.length} 次调用</span>
        {errorCount > 0 && (
          <span className="text-xs text-red-400">{errorCount} 失败</span>
        )}
      </div>

      <div className="space-y-1.5">
        {diffs.map((entry, i) => (
          <CallRow key={`${entry.seq}-${i}`} entry={entry} id={`ai-diff-${i}`} highlighted={highlightIndex === i} />
        ))}
      </div>
    </div>
  );
}
