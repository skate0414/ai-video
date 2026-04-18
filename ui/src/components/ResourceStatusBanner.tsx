import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle, ChevronDown, ChevronRight, Settings } from 'lucide-react';
import { api } from '../api/client';
import { logger } from '../lib/logger';
import { useWorkbench } from '../hooks/useWorkbench';

interface SetupStatus {
  needsSetup: boolean;
  hasApiKey: boolean;
  accountCount: number;
  apiResourceCount?: number;
  ffmpegAvailable: boolean;
  edgeTtsAvailable: boolean;
  chromiumAvailable: boolean;
}

type BannerLevel = 'ready' | 'warning' | 'critical';

export function ResourceStatusBanner() {
  const navigate = useNavigate();
  const { state } = useWorkbench();
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    api.getSetupStatus()
      .then(setStatus)
      .catch((err) => {
        logger.warn('api', 'setup_status_fetch_failed', { error: err instanceof Error ? err.message : String(err) });
      });
  }, []);

  if (!status || dismissed) return null;

  // Use live workbench state for resource availability — resources may be
  // configured but never logged in, so we check quotaExhausted to see
  // how many are actually usable (non-exhausted).
  const liveResources = state.resources ?? state.accounts ?? [];
  const availableResources = liveResources.filter(r => !r.quotaExhausted).length;
  const apiResourceCount = liveResources.filter(r => r.type === 'api').length;
  const browserResourceCount = liveResources.filter(r => r.type !== 'api' && !r.quotaExhausted).length;
  const hasAiResource = status.hasApiKey || availableResources > 0;

  // For free-tier (browser-based) mode, user needs both resources AND browser
  const hasResourcesConfigured = liveResources.length > 0;
  const needsLogin = hasResourcesConfigured && !status.hasApiKey;

  const aiDesc = (() => {
    const parts: string[] = [];
    if (apiResourceCount > 0) parts.push(`${apiResourceCount} 个 API 密钥`);
    if (browserResourceCount > 0) parts.push(`${browserResourceCount} 个浏览器资源`);
    if (parts.length > 0) return parts.join(' + ') + (needsLogin ? '（请确保已登录）' : '');
    return '未添加资源且无 API Key';
  })();

  const checks = [
    {
      key: 'ai',
      label: 'AI 资源',
      ok: hasAiResource,
      desc: aiDesc,
    },
    { key: 'ffmpeg', label: 'FFmpeg', ok: status.ffmpegAvailable, desc: status.ffmpegAvailable ? '已安装' : '未安装 — 无法合成视频' },
    { key: 'tts', label: 'TTS 语音', ok: status.edgeTtsAvailable, desc: status.edgeTtsAvailable ? '已安装' : '未安装 — 无法生成语音' },
    { key: 'browser', label: '浏览器自动化', ok: status.chromiumAvailable, desc: status.chromiumAvailable ? '已就绪' : '未安装 — 免费模式不可用' },
  ];

  const failCount = checks.filter((c) => !c.ok).length;

  // If accounts exist but no API key, the user relies on free mode which
  // requires browser login — always show expanded so the reminder is visible.
  const loginReminder = needsLogin && status.chromiumAvailable;

  let level: BannerLevel;
  if (failCount === 0 && !loginReminder) level = 'ready';
  else if (!hasAiResource) level = 'critical';
  else level = 'warning';

  // All truly ready — compact green bar
  if (level === 'ready' && !expanded) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 text-emerald-400 text-xs">
        <CheckCircle2 size={14} />
        <span>所有资源就绪</span>
      </div>
    );
  }

  const borderColor = level === 'critical' ? 'border-red-500/30' : level === 'warning' ? 'border-amber-500/30' : 'border-emerald-500/20';
  const bgColor = level === 'critical' ? 'bg-red-500/5' : level === 'warning' ? 'bg-amber-500/5' : 'bg-emerald-500/5';
  const textColor = level === 'critical' ? 'text-red-400' : level === 'warning' ? 'text-amber-400' : 'text-emerald-400';
  const Icon = level === 'critical' ? XCircle : level === 'warning' ? AlertTriangle : CheckCircle2;

  const summaryText = level === 'critical'
    ? '缺少关键资源 — 无法生成视频'
    : loginReminder && failCount === 0
    ? '免费模式需确认账户已登录'
    : `${failCount} 项资源未就绪`;

  return (
    <div className={`rounded-xl border ${borderColor} ${bgColor} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left"
      >
        <Icon size={16} className={textColor} />
        <span className={`text-xs font-medium ${textColor} flex-1`}>{summaryText}</span>
        <span className="text-zinc-500">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </button>

      {expanded && (
        <div className="px-4 pb-3 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {checks.map((c) => (
              <div key={c.key} className="flex items-start gap-2 text-xs">
                {c.ok
                  ? <CheckCircle2 size={13} className="text-emerald-500 mt-0.5 shrink-0" />
                  : <AlertTriangle size={13} className="text-amber-500 mt-0.5 shrink-0" />}
                <div>
                  <span className={c.ok ? 'text-zinc-300' : 'text-zinc-200 font-medium'}>{c.label}</span>
                  <span className="text-zinc-500 ml-1.5">{c.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={() => navigate('/settings')}
              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 transition-colors"
            >
              <Settings size={12} /> 前往设置
            </button>
            {level !== 'critical' && (
              <button
                onClick={() => setDismissed(true)}
                className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
              >
                暂时忽略
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
