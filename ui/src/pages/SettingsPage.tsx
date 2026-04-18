import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Bot, Volume2, Timer, Clapperboard, Film, Key } from 'lucide-react';
import { api } from '../api/client';
import { useWorkbench } from '../hooks/useWorkbench';
import { Card } from '../components/ui/Card';
import { AccountSettings } from './settings/AccountSettings';
import { TTSSection, QueueDetectionSection, AdvancedSection } from './settings/SystemSettings';
import type { AiResource, EnvironmentStatus, GlobalCostSummary } from '../types';

/* ================================================================== */
/*  StatusCard — dashboard overview card                                */
/* ================================================================== */

function StatusCard({ icon, label, value, sub, status }: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  status: 'ok' | 'warn' | 'mixed' | 'neutral';
}) {
  const colors = {
    ok: 'border-emerald-500/30 text-emerald-400',
    warn: 'border-amber-500/30 text-amber-400',
    mixed: 'border-amber-500/30 text-amber-400',
    neutral: 'border-zinc-700/50 text-zinc-400',
  };
  const iconColors = {
    ok: 'text-emerald-500',
    warn: 'text-amber-500',
    mixed: 'text-amber-500',
    neutral: 'text-zinc-500',
  };

  return (
    <div className={`rounded-xl border bg-zinc-900/50 p-3 ${colors[status]}`}>
      <div className="flex items-center gap-2 mb-1">
        <span className={iconColors[status]}>{icon}</span>
        <span className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={`text-sm font-bold ${colors[status].split(' ')[1]}`}>{value}</div>
      {sub && <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div>}
    </div>
  );
}

/* ================================================================== */
/*  CollapsibleSection                                                 */
/* ================================================================== */

function CollapsibleSection({ title, icon, summary, summaryStatus, children }: {
  title: string;
  icon: React.ReactNode;
  summary: string;
  summaryStatus: 'ok' | 'warn' | 'neutral';
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const statusColor = summaryStatus === 'ok' ? 'text-emerald-400' : summaryStatus === 'warn' ? 'text-amber-400' : 'text-zinc-500';

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 text-left"
      >
        <span className="text-zinc-400">{icon}</span>
        <span className="text-sm font-bold text-white uppercase tracking-wider flex-1">{title}</span>
        <span className={`text-xs ${statusColor}`}>{summary}</span>
      </button>
      {open && <div className="mt-6 border-t border-zinc-800 pt-6">{children}</div>}
    </Card>
  );
}

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

/* ================================================================== */
/*  Main: SettingsPage                                                 */
/* ================================================================== */

export function SettingsPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnProject = searchParams.get('from');
  const { state, refresh } = useWorkbench();

  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [costs, setCosts] = useState<GlobalCostSummary | null>(null);
  const [concurrency, setConcurrency] = useState(2);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.getEnvironment().catch(() => null),
      api.getGlobalCosts().catch(() => null),
      api.getConfig().catch(() => null),
    ]).then(([envData, costsData, cfg]) => {
      if (envData) setEnv(envData);
      if (costsData) setCosts(costsData);
      if (cfg) {
        setConcurrency(cfg.productionConcurrency);
      }
    }).finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-5">
        <p className="text-zinc-500 text-sm">加载设置中...</p>
      </div>
    );
  }

  const resources: AiResource[] = state.resources ?? [];
  const chatResources = resources.filter(r => r.type === 'chat');
  const videoResources = resources.filter(r => r.type === 'video');
  const apiResources = resources.filter(r => r.type === 'api');
  const accountsAvailable = chatResources.filter(r => !r.quotaExhausted).length;
  const accountsExhausted = chatResources.filter(r => r.quotaExhausted).length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-5 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => returnProject ? navigate(-1) : navigate('/')}
          className="w-8 h-8 rounded-lg bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-700/50 flex items-center justify-center transition-colors"
        >
          <ArrowLeft size={14} className="text-zinc-400" />
        </button>
        <h1 className="text-lg font-bold text-white">设置</h1>
        <span className="text-xs text-zinc-500">管理 AI 资源、视频生成工具与生产配置</span>
      </div>

      {/* Resource Overview Dashboard */}
      <div className="grid grid-cols-5 gap-2">
        <StatusCard
          icon={<Bot size={18} />}
          label="AI 聊天账户"
          value={chatResources.length === 0 ? '未添加' : `${accountsAvailable} 可用`}
          sub={accountsExhausted > 0 ? `${accountsExhausted} 已耗尽` : undefined}
          status={chatResources.length === 0 ? 'warn' : accountsExhausted > 0 ? 'mixed' : 'ok'}
        />
        <StatusCard
          icon={<Key size={18} />}
          label="付费 API"
          value={apiResources.length === 0 ? '未配置' : `${apiResources.length} 个密钥`}
          sub={costs && costs.totalCostUsd > 0 ? `$${costs.totalCostUsd.toFixed(2)} 已消费` : undefined}
          status={apiResources.length > 0 ? 'ok' : 'neutral'}
        />
        <StatusCard
          icon={<Film size={18} />}
          label="视频生成资源"
          value={videoResources.length === 0 ? '未添加' : `${videoResources.length} 个`}
          sub={videoResources.length > 0 ? safeHostname(videoResources[0].siteUrl) : undefined}
          status={videoResources.length > 0 ? 'ok' : 'neutral'}
        />
        <StatusCard
          icon={<Volume2 size={18} />}
          label="TTS 语音"
          value={env?.edgeTtsAvailable ? '已安装' : '未安装'}
          status={env?.edgeTtsAvailable ? 'ok' : 'warn'}
        />
        <StatusCard
          icon={<Clapperboard size={18} />}
          label="FFmpeg"
          value={env?.ffmpegAvailable ? '已安装' : '未安装'}
          status={env?.ffmpegAvailable ? 'ok' : 'warn'}
        />
      </div>

      {/* AI Resources */}
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

      {/* TTS */}
      <CollapsibleSection
        title="语音合成 (TTS)"
        icon={<Volume2 size={16} />}
        summary={env?.edgeTtsAvailable ? 'edge-tts 已安装' : '未安装 — 需要 pip install edge-tts'}
        summaryStatus={env?.edgeTtsAvailable ? 'ok' : 'warn'}
      >
        <TTSSection />
      </CollapsibleSection>

      {/* Queue Detection */}
      <CollapsibleSection
        title="排队检测规则"
        icon={<Timer size={16} />}
        summary="配置视频站点排队检测关键词和 ETA 正则"
        summaryStatus="neutral"
      >
        <QueueDetectionSection />
      </CollapsibleSection>

      {/* Advanced */}
      <CollapsibleSection
        title="高级设置"
        icon={<Clapperboard size={16} />}
        summary={`并发 ${concurrency} · Node ${env?.nodeVersion ?? '?'} · ${env?.platform ?? '?'}`}
        summaryStatus="neutral"
      >
        <AdvancedSection env={env} />
      </CollapsibleSection>
    </div>
  );
}
