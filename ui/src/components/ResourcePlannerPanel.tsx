import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, RefreshCw, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import { api } from '../api/client';

interface StageResourcePlan {
  stage: string;
  taskType: string;
  provider: string;
  adapter: 'chat' | 'api';
  sessionGroup: string;
  reusesChatContext: boolean;
  feasible: boolean;
  reason: string;
  costCategory: 'free' | 'low' | 'medium' | 'high';
}

interface ResourcePlan {
  qualityTier: string;
  stages: StageResourcePlan[];
  feasibleCount: number;
  totalCount: number;
  allFeasible: boolean;
  blockers: string[];
  sessionSummary: Record<string, { provider: string; stageCount: number; reuseChat: boolean }>;
  overallCost: string;
  summary: string;
}

const STAGE_LABELS: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '能力评估',
  STYLE_EXTRACTION: '风格提取',
  RESEARCH: '内容调研',
  NARRATIVE_MAP: '叙事规划',
  SCRIPT_GENERATION: '脚本生成',
  QA_REVIEW: '质量审查',
  STORYBOARD: '分镜设计',
  REFERENCE_IMAGE: '参考图生成',
  KEYFRAME_GEN: '关键帧生成',
  VIDEO_GEN: '视频生成',
  TTS: '语音合成',
  ASSEMBLY: '视频组装',
  REFINEMENT: '精修优化',
};

const SESSION_LABELS: Record<string, string> = {
  analysis: '🔍 分析组',
  creation: '✍️ 创作组',
  visual: '🎨 视觉组',
  production: '🎬 制作组',
};

const COST_STYLES: Record<string, { label: string; cls: string }> = {
  free:   { label: '免费', cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  low:    { label: '低',   cls: 'bg-sky-500/15 text-sky-400 border-sky-500/30' },
  medium: { label: '中',   cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
  high:   { label: '高',   cls: 'bg-red-500/15 text-red-400 border-red-500/30' },
};

interface Props {
  projectId: string;
}

export function ResourcePlannerPanel({ projectId }: Props) {
  const [plan, setPlan] = useState<ResourcePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState(false);

  const fetchPlan = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getResourcePlan(projectId);
      setPlan(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取资源规划失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPlan();
  }, [projectId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 flex items-center gap-2 text-zinc-400">
        <Loader2 size={16} className="animate-spin" /> 正在生成资源规划...
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-4">
        <p className="text-sm text-red-400 mb-2">❌ {error}</p>
        <button
          onClick={fetchPlan}
          className="px-3 py-1.5 text-xs font-medium text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 rounded-lg hover:bg-indigo-500/20 transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  if (!plan) return null;

  const costBadge = COST_STYLES[plan.overallCost] ?? COST_STYLES.free;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-4 py-3 hover:bg-zinc-800/40 transition-colors"
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown size={14} className="text-zinc-500" /> : <ChevronRight size={14} className="text-zinc-500" />}
          <span className="text-sm font-semibold text-zinc-200">📊 资源规划</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${costBadge.cls}`}>
            总成本: {costBadge.label}
          </span>
          <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${plan.allFeasible ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-red-500/15 text-red-400 border-red-500/30'}`}>
            {plan.allFeasible ? '✅ 全部就绪' : `⚠️ ${plan.blockers.length} 个阻塞`}
          </span>
        </div>
      </button>

      <p className="px-4 pb-2 text-xs text-zinc-500">{plan.summary}</p>

      {expanded && (
        <div className="px-4 pb-4 space-y-4">
          {/* Session group summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(plan.sessionSummary).map(([group, info]) => (
              <div key={group} className="px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900/40">
                <div className="text-xs font-semibold text-zinc-300">{SESSION_LABELS[group] ?? group}</div>
                <div className="text-[11px] text-zinc-500 mt-0.5">
                  {info.provider} · {info.stageCount} 步
                  {info.reuseChat && <span title="复用聊天上下文"> 🔗</span>}
                </div>
              </div>
            ))}
          </div>

          {/* Stage-by-stage table */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-zinc-700 text-left text-zinc-500">
                  <th className="px-2 py-2 font-medium">步骤</th>
                  <th className="px-2 py-2 font-medium">服务商</th>
                  <th className="px-2 py-2 font-medium">模式</th>
                  <th className="px-2 py-2 font-medium">会话组</th>
                  <th className="px-2 py-2 font-medium">成本</th>
                  <th className="px-2 py-2 font-medium">状态</th>
                </tr>
              </thead>
              <tbody>
                {plan.stages.map((s) => {
                  const badge = COST_STYLES[s.costCategory] ?? COST_STYLES.free;
                  return (
                    <tr key={s.stage} className="border-b border-zinc-800/50 text-zinc-400">
                      <td className="px-2 py-2">{STAGE_LABELS[s.stage] ?? s.stage}</td>
                      <td className="px-2 py-2">{s.provider}</td>
                      <td className="px-2 py-2">
                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${s.adapter === 'chat' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' : 'bg-sky-500/15 text-sky-400 border-sky-500/30'}`}>
                          {s.adapter === 'chat' ? '聊天' : 'API'}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        {SESSION_LABELS[s.sessionGroup] ?? s.sessionGroup}
                        {s.reusesChatContext && <span title="复用上下文"> 🔗</span>}
                      </td>
                      <td className="px-2 py-2">
                        <span className={`px-1.5 py-0.5 text-[10px] font-bold rounded border ${badge.cls}`}>{badge.label}</span>
                      </td>
                      <td className="px-2 py-2">
                        {s.feasible
                          ? <CheckCircle size={12} className="text-emerald-400" />
                          : <span title={s.reason}><AlertTriangle size={12} className="text-red-400" /></span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {plan.blockers.length > 0 && (
            <div className="rounded-lg border border-red-500/20 bg-red-500/5 p-3">
              <p className="text-xs font-bold text-red-400 mb-1">⚠️ 阻塞项:</p>
              <ul className="list-disc list-inside text-xs text-red-400/80 space-y-0.5">
                {plan.blockers.map((b) => (
                  <li key={b}>{STAGE_LABELS[b] ?? b} — 没有可用的服务商</li>
                ))}
              </ul>
            </div>
          )}

          <button
            onClick={fetchPlan}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors"
          >
            <RefreshCw size={12} /> 刷新规划
          </button>
        </div>
      )}
    </div>
  );
}
