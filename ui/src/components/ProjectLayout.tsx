import { useParams, useNavigate, Outlet } from 'react-router-dom';
import { useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, AlertTriangle, Pause } from 'lucide-react';
import { usePipeline } from '../hooks/usePipeline';
import { ProjectProvider } from '../context/ProjectContext';
import { NavStepper } from './NavStepper';
import { LogPanel } from './LogPanel';
import { STAGE_LABELS } from './StageTimeline';
import { Badge } from './ui/Badge';

const TIER_CONFIG = {
  free: { label: '免费模式', variant: 'success' as const, desc: '全部使用免费 AI 聊天配额' },
  balanced: { label: '均衡模式', variant: 'info' as const, desc: '免费优先，关键步骤用 API' },
  premium: { label: '高级模式', variant: 'warning' as const, desc: '全程 Gemini API' },
};

export function ProjectLayout() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const pipeline = usePipeline(projectId);
  const { current, logs } = pipeline;
  const [logsOpen, setLogsOpen] = useState(false);

  if (!current) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500">
        <div className="animate-pulse">加载中...</div>
      </div>
    );
  }

  const isPaused = current.isPaused;
  const pausedAt = current.pausedAtStage;
  const tier = TIER_CONFIG[current.qualityTier];

  return (
    <ProjectProvider value={pipeline}>
      <div className="flex flex-col h-full bg-[#050505]">
        {/* Header */}
        <div className="px-6 pt-4 pb-2 border-b border-white/5 bg-[#0a0a0f]/60 backdrop-blur-sm shrink-0">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/')}
                className="flex items-center gap-1.5 text-zinc-400 hover:text-white transition-colors text-sm"
              >
                <ArrowLeft size={16} />
                <span>返回</span>
              </button>
              <div>
                <h2 className="text-lg font-bold text-white">{current.title}</h2>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {current.topic} · {new Date(current.createdAt).toLocaleDateString()}
                </p>
              </div>
            </div>
            <Badge variant={tier.variant}>{tier.label}</Badge>
          </div>

          {current.error && (
            <div className="flex items-center gap-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm mb-2">
              <AlertTriangle size={14} />
              {current.error}
            </div>
          )}

          {isPaused && (
            <div className="flex items-center gap-2 px-3 py-2 bg-amber-500/10 border border-amber-500/20 rounded-lg text-amber-400 text-sm mb-2">
              <Pause size={14} />
              流水线已暂停于 {STAGE_LABELS[pausedAt!]} 阶段 — 请审核并修改后继续
            </div>
          )}

          <NavStepper stageStatus={current.stageStatus} />
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-auto">
          <Outlet />
        </div>

        {/* Bottom log panel */}
        <div className={`border-t border-white/5 bg-[#0a0a0f] transition-all ${logsOpen ? 'h-80' : 'h-10'}`}>
          <button
            className="w-full h-10 px-4 flex items-center justify-between text-sm text-zinc-400 hover:text-white transition-colors"
            onClick={() => setLogsOpen(!logsOpen)}
          >
            <span className="flex items-center gap-2 font-mono text-xs">
              📋 日志 ({logs.length})
            </span>
            {logsOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          {logsOpen && (
            <div className="h-[calc(100%-2.5rem)] overflow-hidden">
              <LogPanel logs={logs} />
            </div>
          )}
        </div>
      </div>
    </ProjectProvider>
  );
}
