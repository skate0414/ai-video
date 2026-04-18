import { useState, useEffect } from 'react';
import { ChevronDown, ChevronUp, FileText } from 'lucide-react';
import { api } from '../api/client';

interface ReportConfig {
  filename: string;
  label: string;
}

interface Props {
  projectId: string;
  reports: ReportConfig[];
}

function ReportContent({ data }: { data: Record<string, unknown> }) {
  if (!data || typeof data !== 'object') return null;

  // Render summary/verdict at top if present
  const summary = (data.summary ?? data.verdict ?? data.result) as string | undefined;
  const issues = data.issues as string[] | undefined;
  const warnings = data.warnings as string[] | undefined;
  const score = data.score as number | undefined;
  const passed = data.passed as boolean | undefined;

  return (
    <div className="space-y-2">
      {passed !== undefined && (
        <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${passed ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
          {passed ? '通过' : '未通过'}
        </span>
      )}
      {score !== undefined && (
        <span className="inline-block ml-2 px-2 py-0.5 rounded text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
          评分 {typeof score === 'number' ? (score * 100).toFixed(0) : score}%
        </span>
      )}
      {summary && (
        <p className="text-xs text-zinc-400 leading-relaxed">{String(summary)}</p>
      )}
      {issues && issues.length > 0 && (
        <div className="space-y-1">
          <h5 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">问题</h5>
          {issues.map((issue, i) => (
            <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-amber-500/5 border border-amber-500/10">
              <span className="text-amber-400 shrink-0 text-[10px]">⚠️</span>
              <span className="text-[11px] text-amber-300/90 leading-relaxed">{issue}</span>
            </div>
          ))}
        </div>
      )}
      {warnings && warnings.length > 0 && (
        <div className="space-y-1">
          <h5 className="text-[10px] font-semibold text-zinc-500 uppercase tracking-wider">警告</h5>
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2 px-2 py-1.5 rounded bg-yellow-500/5 border border-yellow-500/10">
              <span className="text-yellow-400 shrink-0 text-[10px]">⚡</span>
              <span className="text-[11px] text-yellow-300/90 leading-relaxed">{w}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function ArtifactReportPanel({ projectId, reports }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loaded, setLoaded] = useState<Record<string, Record<string, unknown> | null>>({});

  useEffect(() => {
    for (const r of reports) {
      if (loaded[r.filename] !== undefined) continue;
      api.loadArtifact<Record<string, unknown>>(projectId, r.filename)
        .then((data) => setLoaded((prev) => ({ ...prev, [r.filename]: data ?? null })))
        .catch(() => setLoaded((prev) => ({ ...prev, [r.filename]: null })));
    }
  }, [projectId, reports, loaded]);

  const availableReports = reports.filter((r) => loaded[r.filename] && loaded[r.filename] !== null);
  if (availableReports.length === 0) return null;

  const toggleReport = (filename: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  };

  return (
    <div className="space-y-2 mt-4">
      <h4 className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 px-1">
        📋 质量检查报告 ({availableReports.length})
      </h4>
      {availableReports.map((r) => {
        const isOpen = expanded.has(r.filename);
        const data = loaded[r.filename]!;

        return (
          <div key={r.filename} className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <button
              onClick={() => toggleReport(r.filename)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-semibold text-zinc-400 hover:bg-zinc-800/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <FileText size={12} className="text-zinc-600" />
                {r.label}
              </span>
              {isOpen ? <ChevronUp size={12} className="text-zinc-600" /> : <ChevronDown size={12} className="text-zinc-600" />}
            </button>
            {isOpen && (
              <div className="px-4 pb-3">
                <ReportContent data={data} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
