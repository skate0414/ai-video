import { useParams, useNavigate, Outlet } from 'react-router-dom';
import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, AlertTriangle, RefreshCw } from 'lucide-react';
import { usePipeline } from '../hooks/usePipeline';
import { logger } from '../lib/logger';
import { ProjectProvider } from '../context/ProjectContext';
import { ProgressBar } from './ProgressBar';
import { DebugDrawer } from './DebugDrawer';
import { StageBreadcrumb } from './StageBreadcrumb';
import { api } from '../api/client';

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const pipeline = usePipeline(projectId);
  const { current, logs } = pipeline;
  const [debugOpen, setDebugOpen] = useState(false);
  const toggleDebug = useCallback(() => setDebugOpen(v => !v), []);
  const [retrying, setRetrying] = useState(false);

  // ETA polling
  const isProcessing = current ? Object.values(current.stageStatus ?? {}).some(s => s === 'processing') : false;
  const [eta, setEta] = useState<{ etaMs: number | null } | null>(null);
  useEffect(() => {
    if (!projectId || !isProcessing) { setEta(null); return; }
    let cancelled = false;
    const poll = () => { api.getEta(projectId).then(d => { if (!cancelled) setEta(d); }).catch(() => {}); };
    poll();
    const iv = setInterval(poll, 15_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [projectId, isProcessing]);

  if (!current) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        <div className="animate-pulse">加载中...</div>
      </div>
    );
  }

  const isPaused = current.isPaused;
  const pausedAt = current.pausedAtStage;

  const failedStage = current.error
    ? (Object.entries(current.stageStatus ?? {}).find(([, s]) => s === 'error')?.[0] as string | undefined)
    : undefined;

  return (
    <ProjectProvider value={pipeline}>
      <div className="flex flex-col h-full bg-[#050505]">
        {/* Compact unified header — single 44px bar */}
        <div className="h-11 px-4 border-b border-white/5 bg-[#0a0a0f]/80 backdrop-blur-md shrink-0 flex items-center gap-3">
          {/* Back */}
          <button
            onClick={() => navigate('/')}
            className="text-zinc-500 hover:text-white transition-colors shrink-0"
          >
            <ArrowLeft size={16} />
          </button>

          {/* Title */}
          <span className="text-sm font-semibold text-zinc-200 truncate max-w-[140px] shrink-0" title={current.title}>
            {current.title}
          </span>

          <StageBreadcrumb />

          <div className="w-px h-4 bg-zinc-800 shrink-0" />

          {/* ProgressBar (centered, takes available space) */}
          <div className="flex-1 flex justify-center min-w-0 px-2">
            <ProgressBar
              stageStatus={current.stageStatus}
              etaMs={eta?.etaMs}
            />
          </div>

          {/* Error inline badge */}
          {current.error && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-md truncate max-w-[180px]" title={current.error}>
                <AlertTriangle size={10} className="shrink-0" />
                {current.error.length > 30 ? current.error.slice(0, 30) + '…' : current.error}
              </span>
              {failedStage && (
                <button
                  disabled={retrying}
                  onClick={async () => { setRetrying(true); logger.info('user', 'retry_failed_stage', { projectId: current.id, stage: failedStage }); try { await pipeline.retryStage(current.id, failedStage as any); } finally { setRetrying(false); } }}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium text-red-300 bg-red-500/15 border border-red-500/25 rounded-md hover:bg-red-500/25 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RefreshCw size={10} className={retrying ? 'animate-spin' : ''} /> {retrying ? '重试中…' : '重试'}
                </button>
              )}
            </div>
          )}

        </div>

        {/* Page content — maximised */}
        <div className="flex-1 overflow-auto px-8 py-5">
          <Outlet />
        </div>

        {/* Debug drawer — hidden by default, ⌘D to toggle */}
        <DebugDrawer logs={logs} open={debugOpen} onToggle={toggleDebug} />
      </div>
    </ProjectProvider>
  );
}
