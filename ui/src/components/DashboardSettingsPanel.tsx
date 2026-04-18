import { useEffect, useState } from 'react';
import { Bot, ChevronDown, Clapperboard, Key, Timer, Volume2 } from 'lucide-react';
import { api } from '../api/client';
import { useWorkbench } from '../hooks/useWorkbench';
import { AccountSettings } from '../pages/settings/AccountSettings';
import { ProviderSettings } from '../pages/settings/ProviderSettings';
import { TTSSection, QueueDetectionSection, AdvancedSection } from '../pages/settings/SystemSettings';
import type { AiResource, EnvironmentStatus, GlobalCostSummary, StageProviderOverrides } from '../types';

function StatusPill({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className={`rounded-lg border px-3 py-2 ${ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-zinc-700 bg-zinc-900/50'}`}>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`text-xs font-semibold ${ok ? 'text-emerald-300' : 'text-zinc-300'}`}>{value}</div>
    </div>
  );
}

function FoldSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-zinc-800/40 transition-colors"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-zinc-200">
          {icon}
          {title}
        </span>
        <ChevronDown size={14} className={`text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="px-4 pb-4 border-t border-zinc-800">{children}</div>}
    </div>
  );
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

export function DashboardSettingsPanel({
  stageOverrides,
  onStageOverridesChange,
}: {
  stageOverrides: StageProviderOverrides;
  onStageOverridesChange: (overrides: StageProviderOverrides) => void;
}) {
  const { state, refresh } = useWorkbench();
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [costs, setCosts] = useState<GlobalCostSummary | null>(null);
  const [concurrency, setConcurrency] = useState(2);

  useEffect(() => {
    Promise.all([
      api.getEnvironment().catch(() => null),
      api.getGlobalCosts().catch(() => null),
      api.getConfig().catch(() => null),
    ]).then(([envData, costsData, cfg]) => {
      if (envData) setEnv(envData);
      if (costsData) setCosts(costsData);
      if (cfg) setConcurrency(cfg.productionConcurrency);
    });
  }, []);

  const resources: AiResource[] = state.resources ?? [];
  const chatResources = resources.filter((r) => r.type === 'chat');
  const videoResources = resources.filter((r) => r.type === 'video');
  const apiResources = resources.filter((r) => r.type === 'api');
  const availableChats = chatResources.filter((r) => !r.quotaExhausted).length;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        <StatusPill label="AI 聊天" value={chatResources.length === 0 ? '未配置' : `${availableChats}/${chatResources.length} 可用`} ok={chatResources.length > 0 && availableChats > 0} />
        <StatusPill label="API 密钥" value={apiResources.length === 0 ? '未配置' : `${apiResources.length} 个`} ok={apiResources.length > 0} />
        <StatusPill label="视频资源" value={videoResources.length === 0 ? '未配置' : safeHostname(videoResources[0].siteUrl)} ok={videoResources.length > 0} />
        <StatusPill label="TTS" value={env?.edgeTtsAvailable ? '已安装' : '未安装'} ok={!!env?.edgeTtsAvailable} />
        <StatusPill label="FFmpeg" value={env?.ffmpegAvailable ? '已安装' : '未安装'} ok={!!env?.ffmpegAvailable} />
      </div>

      <FoldSection title="AI 账号与资源" icon={<Bot size={15} className="text-zinc-400" />}>
        <div className="pt-4">
          <AccountSettings
            resources={resources}
            loginOpenIds={state.loginOpenAccountIds ?? []}
            providers={state.providers}
            isRunning={state.isRunning}
            concurrency={concurrency}
            setConcurrency={setConcurrency}
            costs={costs}
            refresh={refresh}
          />
        </div>
      </FoldSection>

      <FoldSection title="默认模型路由" icon={<Key size={15} className="text-zinc-400" />}>
        <div className="pt-4">
          <ProviderSettings overrides={stageOverrides} onChange={onStageOverridesChange} />
        </div>
      </FoldSection>

      <FoldSection title="语音合成 (TTS)" icon={<Volume2 size={15} className="text-zinc-400" />}>
        <div className="pt-4">
          <TTSSection />
        </div>
      </FoldSection>

      <FoldSection title="排队检测规则" icon={<Timer size={15} className="text-zinc-400" />}>
        <div className="pt-4">
          <QueueDetectionSection />
        </div>
      </FoldSection>

      <FoldSection title="工具与高级配置" icon={<Clapperboard size={15} className="text-zinc-400" />}>
        <div className="pt-4">
          <AdvancedSection env={env} />
        </div>
      </FoldSection>

      {costs && costs.totalCalls > 0 && (
        <div className="text-[11px] text-zinc-500 px-1">
          成本统计: ${costs.totalCostUsd.toFixed(3)} / {costs.totalCalls} 次调用
        </div>
      )}
    </div>
  );
}
