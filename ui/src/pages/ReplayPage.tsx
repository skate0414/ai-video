import { useEffect, useState, useCallback } from 'react';
import { useProject } from '../context/ProjectContext';
import { usePageGuard } from '../hooks/usePageGuard';
import { api } from '../api/client';
import { TraceHeader } from '../components/replay/TraceHeader';
import { TraceTimeline } from '../components/replay/TraceTimeline';
import { FailureDetail } from '../components/replay/FailureDetail';
import { CostLatencyView } from '../components/replay/CostLatencyView';
import { ProviderSwitchView } from '../components/replay/ProviderSwitchView';
import { AiCallDiffView } from '../components/replay/AiCallDiffView';
import { SpanGraphView } from '../components/replay/SpanGraphView';
import { Loader2, History, ChevronDown } from 'lucide-react';
import type { TraceReplayBundle, TraceAnalysis, SpanNode } from '../types';

export function ReplayPage() {
  const guardReady = usePageGuard(['ASSEMBLY']);
  const { current } = useProject();
  const [bundle, setBundle] = useState<TraceReplayBundle | null>(null);
  const [analysis, setAnalysis] = useState<TraceAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [traceList, setTraceList] = useState<Array<{ traceId: string; startedAt: string; outcome: string; durationMs?: number }>>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [highlightStage, setHighlightStage] = useState<string | null>(null);
  const [highlightDiffIndex, setHighlightDiffIndex] = useState<number | null>(null);

  const projectId = current?.id;

  // Load trace list
  // Load trace list
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    api.listTraces(projectId).then(d => { if (!cancelled) setTraceList(d); }).catch(() => {});
    return () => { cancelled = true; };
  }, [projectId]);

  // Load trace data
  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetcher = selectedTraceId
      ? api.getTrace(projectId, selectedTraceId)
      : api.getLatestTrace(projectId);

    fetcher
      .then(data => {
        if (cancelled) return;
        setBundle(data.bundle);
        setAnalysis(data.analysis);
      })
      .catch(err => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : '加载追踪数据失败');
        setBundle(null);
        setAnalysis(null);
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, selectedTraceId]);

  const handleSelectSpan = useCallback((node: SpanNode) => {
    setHighlightStage(null);
    setHighlightDiffIndex(null);

    if (node.stage && node.kind.startsWith('stage.')) {
      setHighlightStage(node.stage);
      setTimeout(() => {
        document.getElementById(`timeline-stage-${node.stage}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 50);
    }

    if (node.kind.startsWith('ai_call') && analysis) {
      const idx = analysis.aiDiffs.findIndex(d =>
        d.stage === node.stage && d.provider === node.provider &&
        (!node.method || d.method === node.method)
      );
      if (idx >= 0) {
        setHighlightDiffIndex(idx);
        setTimeout(() => {
          document.getElementById(`ai-diff-${idx}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 50);
      }
    }
  }, [analysis]);

  if (!current || !guardReady) return null;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin text-zinc-500" />
        <span className="ml-2 text-zinc-500">加载追踪数据…</span>
      </div>
    );
  }

  if (error || !bundle || !analysis) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-500">
        <History size={40} className="mb-3 text-zinc-600" />
        <p className="text-sm">{error ?? '暂无追踪数据'}</p>
        <p className="text-xs mt-1 text-zinc-600">运行流水线后将在此显示执行追踪</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Trace selector (if multiple traces) */}
      {traceList.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">追踪记录:</span>
          <div className="relative">
            <select
              value={selectedTraceId ?? ''}
              onChange={e => setSelectedTraceId(e.target.value || null)}
              className="appearance-none bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-300 pr-7 cursor-pointer hover:border-zinc-600 transition-colors"
            >
              <option value="">最新</option>
              {traceList.map(t => (
                <option key={t.traceId} value={t.traceId}>
                  {t.traceId.slice(0, 12)}… — {t.outcome} — {new Date(t.startedAt).toLocaleString()}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none" />
          </div>
        </div>
      )}

      {/* Header */}
      <TraceHeader bundle={bundle} />

      {/* Failure detail (if applicable) */}
      {analysis.failureSpan && <FailureDetail span={analysis.failureSpan} />}

      {/* Timeline */}
      <TraceTimeline entries={analysis.timeline} maxDurationMs={bundle.durationMs} highlightStage={highlightStage} />

      {/* Cost & Latency */}
      <CostLatencyView stages={analysis.stageDiff} />

      {/* AI call input/output diff */}
      <AiCallDiffView diffs={analysis.aiDiffs} highlightIndex={highlightDiffIndex} />

      {/* Span tree graph */}
      <SpanGraphView key={bundle.traceId} tree={analysis.spanTree} onSelectSpan={handleSelectSpan} />

      {/* Provider decisions */}
      <ProviderSwitchView decisions={analysis.providerPath} />
    </div>
  );
}
