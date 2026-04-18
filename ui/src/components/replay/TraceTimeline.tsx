import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import type { TimelineEntry } from '../../types';
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';

function ms(v: number | undefined): string {
  if (v === undefined) return '';
  if (v < 1000) return `${v}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

const STATUS_STYLE: Record<string, { dot: string; text: string }> = {
  ok: { dot: 'bg-green-400', text: 'text-green-400' },
  error: { dot: 'bg-red-400', text: 'text-red-400' },
  retry: { dot: 'bg-yellow-400', text: 'text-yellow-400' },
  skip: { dot: 'bg-zinc-500', text: 'text-zinc-500' },
  info: { dot: 'bg-blue-400', text: 'text-blue-400' },
};

const STAGE_LABELS: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '能力评估', STYLE_EXTRACTION: '风格分析', RESEARCH: '资料调研',
  NARRATIVE_MAP: '叙事编排', SCRIPT_GENERATION: '脚本生成', QA_REVIEW: '质量审核',
  STORYBOARD: '分镜设计', VIDEO_IR_COMPILE: '视频编译', REFERENCE_IMAGE: '参考图', KEYFRAME_GEN: '关键帧',
  VIDEO_GEN: '视频生成', TTS: '语音合成', ASSEMBLY: '视频组装', REFINEMENT: '精修',
};

const STAGE_TO_PAGE: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '../style', STYLE_EXTRACTION: '../style',
  RESEARCH: '../script', NARRATIVE_MAP: '../script', SCRIPT_GENERATION: '../script', QA_REVIEW: '../script',
  STORYBOARD: '../storyboard', REFERENCE_IMAGE: '../storyboard', KEYFRAME_GEN: '../storyboard',
  VIDEO_GEN: '../production', TTS: '../production', ASSEMBLY: '../production', REFINEMENT: '../production',
};

interface Props {
  entries: TimelineEntry[];
  maxDurationMs?: number;
  highlightStage?: string | null;
}

export function TraceTimeline({ entries, maxDurationMs, highlightStage }: Props) {
  const navigate = useNavigate();
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (highlightStage) {
      setExpandedStages(prev => {
        if (prev.has(highlightStage)) return prev;
        return new Set([...prev, highlightStage]);
      });
    }
  }, [highlightStage]);
  const totalDuration = maxDurationMs ?? (entries.length > 0 ? Math.max(...entries.map(e => e.offsetMs + (e.durationMs ?? 0))) : 1);

  // Group entries by stage
  const stageGroups: Array<{ stage: string; entries: TimelineEntry[]; startMs: number; endMs: number; status: string }> = [];
  const stageMap = new Map<string, TimelineEntry[]>();

  for (const entry of entries) {
    const stage = entry.stage ?? '_pipeline';
    if (!stageMap.has(stage)) stageMap.set(stage, []);
    stageMap.get(stage)!.push(entry);
  }

  for (const [stage, stageEntries] of stageMap) {
    if (stage === '_pipeline') continue;
    const startMs = Math.min(...stageEntries.map(e => e.offsetMs));
    const endMs = Math.max(...stageEntries.map(e => e.offsetMs + (e.durationMs ?? 0)));
    const hasError = stageEntries.some(e => e.status === 'error');
    const hasRetry = stageEntries.some(e => e.status === 'retry');
    stageGroups.push({
      stage,
      entries: stageEntries,
      startMs,
      endMs,
      status: hasError ? 'error' : hasRetry ? 'retry' : 'ok',
    });
  }

  const toggleStage = (stage: string) => {
    setExpandedStages(prev => {
      const next = new Set(prev);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4">
      <h3 className="text-sm font-semibold text-zinc-300 mb-3">流水线时间线</h3>

      <div className="space-y-1">
        {stageGroups.map(group => {
          const barStart = (group.startMs / totalDuration) * 100;
          const barWidth = Math.max(((group.endMs - group.startMs) / totalDuration) * 100, 1);
          const statusStyle = STATUS_STYLE[group.status] ?? STATUS_STYLE.info;
          const isExpanded = expandedStages.has(group.stage);

          return (
            <div key={group.stage} id={`timeline-stage-${group.stage}`}>
              {/* Stage bar */}
              <div
                className={`flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-zinc-800/50 cursor-pointer transition-colors ${highlightStage === group.stage ? 'ring-1 ring-blue-400/50 bg-zinc-800/40' : ''}`}
                onClick={() => toggleStage(group.stage)}
              >
                <span className="text-zinc-500">
                  {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
                <span className={`w-2 h-2 rounded-full ${statusStyle.dot}`} />
                <span className="text-xs text-zinc-400 w-20 truncate" title={group.stage}>
                  {STAGE_LABELS[group.stage] ?? group.stage}
                </span>

                {/* Waterfall bar */}
                <div className="flex-1 h-5 relative bg-zinc-800/30 rounded overflow-hidden">
                  <div
                    className={`absolute h-full rounded ${
                      group.status === 'error' ? 'bg-red-500/30 border border-red-500/40' :
                      group.status === 'retry' ? 'bg-yellow-500/20 border border-yellow-500/30' :
                      'bg-green-500/20 border border-green-500/30'
                    }`}
                    style={{ left: `${barStart}%`, width: `${barWidth}%` }}
                  />
                </div>

                <span className="text-xs text-zinc-500 w-16 text-right font-mono">
                  {ms(group.endMs - group.startMs)}
                </span>
                {group.status !== 'ok' && STAGE_TO_PAGE[group.stage] && (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(STAGE_TO_PAGE[group.stage]); }}
                    className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                    title="前往修复"
                  >
                    <ExternalLink size={10} />
                    前往
                  </button>
                )}
              </div>

              {/* Expanded: show individual events */}
              {isExpanded && (
                <div className="ml-10 space-y-0.5 mb-1">
                  {group.entries.map((entry, i) => {
                    const st = STATUS_STYLE[entry.status] ?? STATUS_STYLE.info;
                    return (
                      <div key={i} className="flex items-center gap-2 text-xs py-0.5 px-2 rounded hover:bg-zinc-800/30">
                        <span className={`w-1.5 h-1.5 rounded-full ${st.dot}`} />
                        <span className="text-zinc-500 w-14 text-right font-mono">{ms(entry.offsetMs)}</span>
                        <span className={`${st.text} w-36 truncate`}>{entry.kind}</span>
                        {entry.provider && <span className="text-zinc-500">{entry.provider}/{entry.model ?? '?'}</span>}
                        {entry.durationMs !== undefined && <span className="text-zinc-600 font-mono">{ms(entry.durationMs)}</span>}
                        {entry.failure && <span className="text-red-400 truncate">{entry.failure.code}</span>}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
