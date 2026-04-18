import { useNavigate } from 'react-router-dom';
import type { StageDiff } from '../../types';
import { DollarSign, Clock, ExternalLink } from 'lucide-react';

function ms(v: number | undefined): string {
  if (v === undefined) return '-';
  if (v < 1000) return `${v}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function usd(v: number): string {
  if (v === 0) return '-';
  if (v < 0.001) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

const STAGE_LABELS: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '能力评估', STYLE_EXTRACTION: '风格分析', RESEARCH: '资料调研',
  NARRATIVE_MAP: '叙事编排', SCRIPT_GENERATION: '脚本生成', QA_REVIEW: '质量审核',
  STORYBOARD: '分镜设计', VIDEO_IR_COMPILE: '视频编译', REFERENCE_IMAGE: '参考图', KEYFRAME_GEN: '关键帧',
  VIDEO_GEN: '视频生成', TTS: '语音合成', ASSEMBLY: '视频组装', REFINEMENT: '精修',
};

const STATUS_STYLE: Record<string, { bg: string; text: string; label: string }> = {
  completed: { bg: 'bg-green-500/20', text: 'text-green-400', label: '完成' },
  error: { bg: 'bg-red-500/20', text: 'text-red-400', label: '失败' },
  skipped: { bg: 'bg-zinc-500/20', text: 'text-zinc-500', label: '跳过' },
  not_started: { bg: 'bg-zinc-800/30', text: 'text-zinc-600', label: '未开始' },
};

const STAGE_TO_PAGE: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '../style', STYLE_EXTRACTION: '../style',
  RESEARCH: '../script', NARRATIVE_MAP: '../script', SCRIPT_GENERATION: '../script', QA_REVIEW: '../script',
  STORYBOARD: '../storyboard', REFERENCE_IMAGE: '../storyboard', KEYFRAME_GEN: '../storyboard',
  VIDEO_GEN: '../production', TTS: '../production', ASSEMBLY: '../production', REFINEMENT: '../production',
};

export function CostLatencyView({ stages }: { stages: StageDiff[] }) {
  const navigate = useNavigate();
  const maxDuration = Math.max(...stages.map(s => s.durationMs ?? 0), 1);
  const maxCost = Math.max(...stages.map(s => s.costUsd), 0.001);
  const totalCost = stages.reduce((acc, s) => acc + s.costUsd, 0);
  const totalDuration = stages.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
  const activeStages = stages.filter(s => s.status !== 'not_started' && s.status !== 'skipped');
  const mostExpensive = activeStages.length > 0 ? activeStages.reduce((a, b) => a.costUsd > b.costUsd ? a : b) : null;
  const slowest = activeStages.length > 0 ? activeStages.reduce((a, b) => (a.durationMs ?? 0) > (b.durationMs ?? 0) ? a : b) : null;

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-4">
      <h3 className="text-sm font-semibold text-zinc-300">费用 & 延迟</h3>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <div className="rounded-lg bg-zinc-800/50 p-2.5 border border-zinc-700/30">
          <div className="text-xs text-zinc-500 flex items-center gap-1"><DollarSign size={12} />总费用</div>
          <div className="text-sm text-zinc-200 font-medium mt-0.5">{usd(totalCost)}</div>
        </div>
        <div className="rounded-lg bg-zinc-800/50 p-2.5 border border-zinc-700/30">
          <div className="text-xs text-zinc-500 flex items-center gap-1"><Clock size={12} />总耗时</div>
          <div className="text-sm text-zinc-200 font-medium mt-0.5">{ms(totalDuration)}</div>
        </div>
        {mostExpensive && mostExpensive.costUsd > 0 && (
          <div className="rounded-lg bg-zinc-800/50 p-2.5 border border-zinc-700/30">
            <div className="text-xs text-zinc-500">最贵阶段</div>
            <div className="text-sm text-zinc-200 font-medium mt-0.5">{STAGE_LABELS[mostExpensive.stage] ?? mostExpensive.stage}</div>
          </div>
        )}
        {slowest && (
          <div className="rounded-lg bg-zinc-800/50 p-2.5 border border-zinc-700/30">
            <div className="text-xs text-zinc-500">最慢阶段</div>
            <div className="text-sm text-zinc-200 font-medium mt-0.5">{STAGE_LABELS[slowest.stage] ?? slowest.stage}</div>
          </div>
        )}
      </div>

      {/* Bar chart */}
      <div className="space-y-1.5">
        {stages.map(stage => {
          const durPct = ((stage.durationMs ?? 0) / maxDuration) * 100;
          const costPct = (stage.costUsd / maxCost) * 100;
          const st = STATUS_STYLE[stage.status] ?? STATUS_STYLE.not_started;

          return (
            <div key={stage.stage} className="flex items-center gap-2">
              <span className="text-xs text-zinc-400 w-20 truncate text-right" title={stage.stage}>
                {STAGE_LABELS[stage.stage] ?? stage.stage}
              </span>

              <div className="flex-1 space-y-0.5">
                {/* Duration bar */}
                <div className="h-3 bg-zinc-800/30 rounded overflow-hidden relative">
                  <div
                    className={`h-full rounded ${stage.status === 'error' ? 'bg-red-500/40' : 'bg-blue-500/30'}`}
                    style={{ width: `${Math.max(durPct, 0.5)}%` }}
                  />
                </div>
                {/* Cost bar */}
                {stage.costUsd > 0 && (
                  <div className="h-2 bg-zinc-800/20 rounded overflow-hidden">
                    <div
                      className="h-full rounded bg-yellow-500/30"
                      style={{ width: `${Math.max(costPct, 0.5)}%` }}
                    />
                  </div>
                )}
              </div>

              <div className="text-right w-28 flex gap-2 justify-end items-center">
                <span className="text-xs text-zinc-500 font-mono">{ms(stage.durationMs)}</span>
                {stage.costUsd > 0 && <span className="text-xs text-yellow-500/70 font-mono">{usd(stage.costUsd)}</span>}
                <span className={`text-xs ${st.text}`}>{st.label}</span>
                {stage.status === 'error' && STAGE_TO_PAGE[stage.stage] && (
                  <button
                    onClick={() => navigate(STAGE_TO_PAGE[stage.stage])}
                    className="flex items-center gap-0.5 px-1 py-0.5 text-[10px] text-blue-400 hover:text-blue-300 hover:bg-blue-500/10 rounded transition-colors"
                    title="前往修复"
                  >
                    <ExternalLink size={10} />
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex gap-4 text-xs text-zinc-600">
        <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-blue-500/30" /> 耗时</span>
        <span className="flex items-center gap-1"><span className="w-3 h-1.5 rounded bg-yellow-500/30" /> 费用</span>
      </div>
    </div>
  );
}
