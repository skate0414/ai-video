import type { ProviderDecision } from '../../types';
import { ArrowRightLeft } from 'lucide-react';

function ms(v: number | undefined): string {
  if (v === undefined) return '-';
  if (v < 1000) return `${v}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

function usd(v: number | undefined): string {
  if (v === undefined || v === 0) return '-';
  if (v < 0.001) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

const STAGE_LABELS: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '能力评估', STYLE_EXTRACTION: '风格分析', RESEARCH: '资料调研',
  NARRATIVE_MAP: '叙事编排', SCRIPT_GENERATION: '脚本生成', QA_REVIEW: '质量审核',
  STORYBOARD: '分镜设计', VIDEO_IR_COMPILE: '视频编译', REFERENCE_IMAGE: '参考图', KEYFRAME_GEN: '关键帧',
  VIDEO_GEN: '视频生成', TTS: '语音合成', ASSEMBLY: '视频组装', REFINEMENT: '精修',
};

export function ProviderSwitchView({ decisions }: { decisions: ProviderDecision[] }) {
  if (decisions.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4">
        <h3 className="text-sm font-semibold text-zinc-300">提供商决策路径</h3>
        <p className="text-xs text-zinc-600 mt-2">无 AI 调用记录</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <ArrowRightLeft size={16} className="text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-300">提供商决策路径</h3>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="text-left py-1.5 pr-2 font-medium">阶段</th>
              <th className="text-left py-1.5 pr-2 font-medium">提供商</th>
              <th className="text-left py-1.5 pr-2 font-medium">模型</th>
              <th className="text-left py-1.5 pr-2 font-medium">方法</th>
              <th className="text-left py-1.5 pr-2 font-medium">适配器</th>
              <th className="text-right py-1.5 pr-2 font-medium">耗时</th>
              <th className="text-right py-1.5 pr-2 font-medium">费用</th>
              <th className="text-center py-1.5 font-medium">状态</th>
            </tr>
          </thead>
          <tbody>
            {decisions.map((d, i) => (
              <tr
                key={i}
                className={`border-b border-zinc-800/50 ${
                  d.failed ? 'bg-red-500/5' :
                  d.isFallback ? 'bg-yellow-500/5' : ''
                }`}
              >
                <td className="py-1.5 pr-2 text-zinc-300">{STAGE_LABELS[d.stage] ?? d.stage}</td>
                <td className="py-1.5 pr-2 text-zinc-200 font-mono">{d.provider}</td>
                <td className="py-1.5 pr-2 text-zinc-400 font-mono">{d.model ?? '-'}</td>
                <td className="py-1.5 pr-2 text-zinc-500">{d.method}</td>
                <td className="py-1.5 pr-2">
                  {d.adapter && (
                    <span className={`px-1.5 py-0.5 rounded text-xs ${
                      d.adapter === 'api' ? 'bg-purple-500/15 text-purple-400' : 'bg-blue-500/15 text-blue-400'
                    }`}>
                      {d.adapter}
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-2 text-right text-zinc-400 font-mono">{ms(d.durationMs)}</td>
                <td className="py-1.5 pr-2 text-right text-zinc-500 font-mono">{usd(d.costUsd)}</td>
                <td className="py-1.5 text-center">
                  <span className="inline-flex items-center gap-1">
                    {d.failed ? (
                      <span className="text-red-400">✗</span>
                    ) : (
                      <span className="text-green-400">✓</span>
                    )}
                    {d.isFallback && (
                      <span className="px-1 py-0.5 rounded text-xs bg-yellow-500/15 text-yellow-400 border border-yellow-500/20">
                        fallback
                      </span>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
