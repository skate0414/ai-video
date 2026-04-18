import { useState, useEffect, useCallback } from 'react';
import type { StageProviderMap, StageProviderOption, StageProviderOverrides, StageProviderConfig, PipelineStage } from '../types';
import { api } from '../api/client';

const STAGE_LABELS: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '能力评估',
  STYLE_EXTRACTION: '风格分析',
  RESEARCH: '研究调查',
  NARRATIVE_MAP: '叙事结构',
  SCRIPT_GENERATION: '脚本撰写',
  QA_REVIEW: '质量审核',
  STORYBOARD: '分镜设计',
  VIDEO_IR_COMPILE: '视频编译',
  REFERENCE_IMAGE: '参考图生成',
  KEYFRAME_GEN: '关键帧生成',
  VIDEO_GEN: '视频制作',
  TTS: '语音合成',
  REFINEMENT: '精修优化',
};

const STAGE_ICONS: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '🔍',
  STYLE_EXTRACTION: '🎨',
  RESEARCH: '📚',
  NARRATIVE_MAP: '🗺️',
  SCRIPT_GENERATION: '✍️',
  QA_REVIEW: '✅',
  STORYBOARD: '🎬',
  VIDEO_IR_COMPILE: '🔧',
  REFERENCE_IMAGE: '🖼️',
  KEYFRAME_GEN: '🎞️',
  VIDEO_GEN: '📹',
  TTS: '🔊',
  REFINEMENT: '💎',
};

function QuotaBadge({ option }: { option: StageProviderOption }) {
  if (option.hasQuotaIssues) {
    return <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-red-500/20 text-red-400 border border-red-500/30">配额耗尽</span>;
  }
  if (option.availableCount < option.resourceCount) {
    return <span className="ml-1.5 px-1.5 py-0.5 text-[10px] font-bold rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">{option.availableCount}/{option.resourceCount} 可用</span>;
  }
  return null;
}

export function StageProviderSelector({
  projectId,
  overrides,
  onChange,
  disabled,
  stages,
}: {
  projectId?: string;
  overrides: StageProviderOverrides;
  onChange: (overrides: StageProviderOverrides) => void;
  disabled?: boolean;
  /** Only show these stages (for per-page integration). Omit to show all. */
  stages?: PipelineStage[];
}) {
  const [stageProviders, setStageProviders] = useState<StageProviderMap | null>(null);
  const [loading, setLoading] = useState(false);

  const loadProviders = useCallback(() => {
    setLoading(true);
    api.getStageProviders()
      .then(setStageProviders)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const handleChange = (stage: PipelineStage, value: string) => {
    const newOverrides = { ...overrides };
    if (value === 'default') {
      delete newOverrides[stage];
    } else {
      // Parse "adapter:provider" format
      const [adapter, provider] = value.split(':') as ['chat' | 'api', string];
      const config: StageProviderConfig = { adapter };
      if (provider) config.provider = provider;
      newOverrides[stage] = config;
    }
    onChange(newOverrides);

    // Auto-save to project if projectId is provided
    if (projectId) {
      api.updateStageProviderOverrides(projectId, newOverrides).catch(() => {});
    }
  };

  if (loading && !stageProviders) {
    return (
      <div className="flex items-center gap-2 text-xs text-zinc-500 py-2">
        <div className="w-3 h-3 border border-zinc-600 border-t-zinc-400 rounded-full animate-spin" />
        加载 AI 提供商...
      </div>
    );
  }

  if (!stageProviders) return null;

  const visibleStages = stages
    ? Object.entries(stageProviders).filter(([s]) => stages.includes(s as PipelineStage))
    : Object.entries(stageProviders);

  if (visibleStages.length === 0) return null;

  return (
    <div className="space-y-2">
      {visibleStages.map(([stage, info]) => {
        const override = overrides[stage as PipelineStage];
        const currentValue = override
          ? `${override.adapter}:${override.provider ?? ''}`
          : 'default';

        return (
          <div key={stage} className="flex items-center gap-3 py-1.5">
            <div className="flex items-center gap-1.5 min-w-[140px]">
              <span className="text-sm">{STAGE_ICONS[stage] ?? '⚙️'}</span>
              <span className="text-xs font-medium text-zinc-300">
                {STAGE_LABELS[stage] ?? stage}
              </span>
            </div>

            <select
              value={currentValue}
              onChange={(e) => handleChange(stage as PipelineStage, e.target.value)}
              disabled={disabled}
              className="flex-1 px-2.5 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 outline-none focus:border-indigo-500/50 hover:border-zinc-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="default">
                默认 — {info.current.label}
                {info.current.recommended ? ' ★' : ''}
              </option>
              {info.available.map((opt) => (
                <option
                  key={`${opt.adapter}:${opt.provider}`}
                  value={`${opt.adapter}:${opt.provider}`}
                  disabled={opt.hasQuotaIssues && opt.availableCount === 0}
                >
                  {opt.label}
                  {opt.recommended ? ' ★' : ''}
                  {opt.hasQuotaIssues ? ' ⚠️ 配额耗尽' : ''}
                  {opt.resourceCount > 1 ? ` (${opt.availableCount}/${opt.resourceCount})` : ''}
                </option>
              ))}
            </select>

            {override && (
              <button
                onClick={() => handleChange(stage as PipelineStage, 'default')}
                className="px-1.5 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors"
                title="恢复默认"
              >
                ↺
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Compact version for embedding in stage-specific pages.
 * Shows a single dropdown for one or a few stages.
 */
export function StageProviderDropdown({
  stage,
  projectId,
  overrides,
  onChange,
  disabled,
}: {
  stage: PipelineStage;
  projectId?: string;
  overrides: StageProviderOverrides;
  onChange: (overrides: StageProviderOverrides) => void;
  disabled?: boolean;
}) {
  return (
    <StageProviderSelector
      projectId={projectId}
      overrides={overrides}
      onChange={onChange}
      disabled={disabled}
      stages={[stage]}
    />
  );
}
