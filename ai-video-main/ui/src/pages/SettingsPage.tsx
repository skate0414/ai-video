import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Monitor, Cpu, MessageSquare, Video, Volume2,
  CheckCircle2, AlertTriangle, ChevronDown, ChevronRight, Trash2,
} from 'lucide-react';
import { api } from '../api/client';
import { useWorkbench } from '../hooks/useWorkbench';
import { Card } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import type { QualityTier, EnvironmentStatus, TTSSettings, VideoProviderConfig, SelectorStrategy } from '../types';

type Tab = 'environment' | 'ai' | 'accounts' | 'video' | 'tts';

const TABS: { id: Tab; label: string; icon: typeof Monitor }[] = [
  { id: 'environment', label: '环境状态', icon: Monitor },
  { id: 'ai', label: 'AI 模型', icon: Cpu },
  { id: 'accounts', label: '聊天账户', icon: MessageSquare },
  { id: 'video', label: '视频生成', icon: Video },
  { id: 'tts', label: '语音与制作', icon: Volume2 },
];

export function SettingsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<Tab>('environment');

  return (
    <div className="max-w-5xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => navigate('/')}
          className="w-9 h-9 rounded-lg bg-zinc-900/50 hover:bg-zinc-800 border border-zinc-700/50 flex items-center justify-center transition-colors"
        >
          <ArrowLeft size={16} className="text-zinc-400" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-white">设置</h1>
          <p className="text-xs text-zinc-500 mt-0.5">管理 AI 资源配置，确保视频生成流水线顺利运行</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 mb-6 border-b border-zinc-800 overflow-x-auto">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                active
                  ? 'border-indigo-500 text-white'
                  : 'border-transparent text-zinc-500 hover:text-zinc-300'
              }`}
            >
              <Icon size={14} />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'environment' && <EnvironmentTab />}
      {activeTab === 'ai' && <AIModelTab />}
      {activeTab === 'accounts' && <AccountsTab />}
      {activeTab === 'video' && <VideoProviderTab />}
      {activeTab === 'tts' && <TTSTab />}
    </div>
  );
}

/* ================================================================== */
/*  Tab 1: Environment                                                 */
/* ================================================================== */

function EnvironmentTab() {
  const [env, setEnv] = useState<EnvironmentStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getEnvironment().then(setEnv).catch(console.error).finally(() => setLoading(false));
  }, []);

  if (loading) return <p className="text-zinc-500 text-sm">检测环境中...</p>;
  if (!env) return <p className="text-red-400 text-sm">无法连接后端</p>;

  const items = [
    { label: 'Node.js', value: env.nodeVersion, ok: true },
    { label: 'FFmpeg (视频合成)', value: env.ffmpegAvailable ? '已安装' : '未安装 — 视频合成不可用', ok: env.ffmpegAvailable },
    { label: 'Playwright (浏览器自动化)', value: env.playwrightAvailable ? '已安装' : '未安装 — 免费模式不可用', ok: env.playwrightAvailable },
    { label: 'edge-tts (语音合成)', value: env.edgeTtsAvailable ? '已安装' : '未安装 — TTS 不可用', ok: env.edgeTtsAvailable },
    { label: '数据目录', value: env.dataDir, ok: true },
    { label: '操作系统', value: env.platform, ok: true },
  ];

  return (
    <Card>
      <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">环境检测</h3>
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
            <span className="text-sm text-zinc-300">{item.label}</span>
            <div className="flex items-center gap-2">
              {item.ok ? (
                <CheckCircle2 size={14} className="text-emerald-500" />
              ) : (
                <AlertTriangle size={14} className="text-amber-500" />
              )}
              <span className={`text-xs font-mono ${item.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{item.value}</span>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ================================================================== */
/*  Tab 2: AI Model (Quality Tier + Gemini API Key)                    */
/* ================================================================== */

function AIModelTab() {
  const [qualityTier, setQualityTier] = useState<QualityTier>('free');
  const [hasApiKey, setHasApiKey] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [concurrency, setConcurrency] = useState(2);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    api.getConfig().then((cfg) => {
      setQualityTier(cfg.qualityTier);
      setHasApiKey(cfg.hasApiKey);
      setConcurrency(cfg.productionConcurrency);
    }).catch(console.error);
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus('');
    try {
      const data: { geminiApiKey?: string; qualityTier: QualityTier; productionConcurrency: number } = {
        qualityTier,
        productionConcurrency: concurrency,
      };
      if (apiKey.trim()) data.geminiApiKey = apiKey.trim();
      const result = await api.updateConfig(data);
      setHasApiKey(result.hasApiKey);
      setQualityTier(result.qualityTier);
      setApiKey('');
      setStatus('✅ 保存成功');
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '保存失败'}`);
    } finally {
      setSaving(false);
    }
  };

  const tiers: { value: QualityTier; label: string; desc: string; emoji: string }[] = [
    { value: 'free', label: '免费模式', desc: '全部通过浏览器聊天自动化完成，零成本', emoji: '🆓' },
    { value: 'balanced', label: '均衡模式', desc: '免费优先，关键步骤使用付费 API（推荐）', emoji: '⚖️' },
    { value: 'premium', label: '高级模式', desc: '全程付费 API，速度快质量高', emoji: '💎' },
  ];

  return (
    <div className="space-y-6">
      {/* Quality Tier */}
      <Card>
        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">质量级别</h3>
        <div className="space-y-2">
          {tiers.map((t) => (
            <label
              key={t.value}
              className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                qualityTier === t.value
                  ? 'border-indigo-500/50 bg-indigo-500/5'
                  : 'border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <input
                type="radio"
                name="qualityTier"
                value={t.value}
                checked={qualityTier === t.value}
                onChange={() => setQualityTier(t.value)}
                className="mt-1 accent-indigo-500"
              />
              <div>
                <span className="text-sm font-medium text-white">{t.emoji} {t.label}</span>
                <p className="text-xs text-zinc-500 mt-0.5">{t.desc}</p>
              </div>
              {t.value !== 'free' && !hasApiKey && (
                <Badge variant="warning" className="ml-auto shrink-0">需要 API Key</Badge>
              )}
            </label>
          ))}
        </div>
      </Card>

      {/* Gemini API Key */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">Gemini API Key</h3>
          {hasApiKey ? (
            <Badge variant="success">已配置</Badge>
          ) : (
            <Badge variant="warning">未配置</Badge>
          )}
        </div>
        <p className="text-xs text-zinc-500 mb-3">
          输入 Google Gemini API Key 可启用「均衡」和「高级」模式。
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline ml-1">
            获取 API Key →
          </a>
        </p>
        <input
          type="password"
          className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
          placeholder={hasApiKey ? '••••••（已保存，留空则不修改）' : 'AIza...'}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
        />
      </Card>

      {/* Production Concurrency */}
      <Card>
        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">并发设置</h3>
        <div className="flex items-center gap-4">
          <label className="text-xs text-zinc-400">场景生成并发数</label>
          <input
            type="number"
            min={1}
            max={5}
            value={concurrency}
            onChange={(e) => setConcurrency(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
            className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500"
          />
          <span className="text-xs text-zinc-600">（1-5，默认 2）</span>
        </div>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-4">
        <Button onClick={handleSave} isLoading={saving}>保存配置</Button>
        {status && <span className="text-xs text-zinc-400">{status}</span>}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Tab 3: Chat Accounts (migrated from SettingsModal)                 */
/* ================================================================== */

function AccountsTab() {
  const { state, refresh } = useWorkbench();
  const providers = state.providers;
  const loginOpenIds = state.loginOpenAccountIds ?? [];

  const [chatUrl, setChatUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advProviderId, setAdvProviderId] = useState('');
  const [advLabel, setAdvLabel] = useState('');
  const [advPromptInput, setAdvPromptInput] = useState('');
  const [advResponseBlock, setAdvResponseBlock] = useState('');
  const [advReadyIndicator, setAdvReadyIndicator] = useState('');
  const [advSendButton, setAdvSendButton] = useState('');

  const handleAddFromUrl = async () => {
    if (!chatUrl.trim()) return;
    setAdding(true);
    setAddStatus('');
    try {
      const result = await api.addProviderFromUrl(chatUrl.trim());
      setAddStatus(`✅ 已添加「${result.providerId}」— 浏览器已打开，请登录。`);
      setChatUrl('');
      refresh();
    } catch (err) {
      setAddStatus(`❌ ${err instanceof Error ? err.message : '添加失败'}`);
    } finally {
      setAdding(false);
    }
  };

  const handleAddAdvanced = async () => {
    if (!advProviderId.trim() || !advLabel.trim() || !chatUrl.trim()) return;
    try {
      await api.addProvider(advProviderId.trim(), advLabel.trim(), {
        chatUrl: chatUrl.trim(),
        promptInput: advPromptInput.trim() || 'textarea',
        responseBlock: advResponseBlock.trim() || '[class*="markdown"]',
        readyIndicator: advReadyIndicator.trim() || advPromptInput.trim() || 'textarea',
        sendButton: advSendButton.trim() || undefined,
      } as Record<string, string>);
      setChatUrl('');
      setAdvProviderId('');
      setAdvLabel('');
      setAdvPromptInput('');
      setAdvResponseBlock('');
      setAdvReadyIndicator('');
      setAdvSendButton('');
      setShowAdvanced(false);
      setAddStatus('✅ 自定义提供商添加成功');
      refresh();
    } catch (err) {
      setAddStatus(`❌ ${err instanceof Error ? err.message : '失败'}`);
    }
  };

  const handleRemoveAccount = async (accountId: string) => {
    await api.removeAccount(accountId);
    refresh();
  };

  const handleResetQuotas = async () => {
    await api.resetQuotas();
    refresh();
  };

  const handleLogin = async (accountId: string) => {
    try {
      await api.openLoginBrowser(accountId);
      refresh();
    } catch (err) {
      console.error('Failed to open login browser:', err);
    }
  };

  const handleCloseLogin = async (accountId: string) => {
    await api.closeLoginBrowser(accountId);
    refresh();
  };

  const handleRemoveProvider = async (id: string) => {
    await api.removeProvider(id);
    refresh();
  };

  return (
    <div className="space-y-6">
      {/* Add AI chat site */}
      <Card>
        <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wider">添加 AI 聊天站点</h3>
        <p className="text-xs text-zinc-500 mb-3">
          粘贴聊天网址 — 系统将自动检测提供商、创建账户、打开浏览器并自动探测页面选择器。
        </p>
        <div className="flex gap-3 items-end">
          <div className="flex-1">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">聊天网址</label>
            <input
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              value={chatUrl}
              onChange={(e) => setChatUrl(e.target.value)}
              placeholder="https://claude.ai/new"
              onKeyDown={(e) => { if (e.key === 'Enter' && !adding && chatUrl.trim()) handleAddFromUrl(); }}
            />
          </div>
          <Button onClick={handleAddFromUrl} disabled={!chatUrl.trim() || adding} isLoading={adding}>
            添加并登录
          </Button>
        </div>

        {addStatus && <p className="text-xs text-zinc-400 mt-2">{addStatus}</p>}

        <button
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 mt-3 transition-colors"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          高级设置 (手动配置选择器)
        </button>

        {showAdvanced && (
          <div className="mt-3 p-4 bg-zinc-900/70 rounded-lg border border-zinc-800">
            <p className="text-xs text-zinc-500 mb-3">仅在自动检测失败时才需要手动配置。</p>
            <div className="grid grid-cols-2 gap-3">
              <InputField label="提供商 ID" value={advProviderId} onChange={setAdvProviderId} placeholder="claude" />
              <InputField label="显示名称" value={advLabel} onChange={setAdvLabel} placeholder="Claude" />
              <InputField label="输入框选择器" value={advPromptInput} onChange={setAdvPromptInput} placeholder="textarea" />
              <InputField label="回复区域选择器" value={advResponseBlock} onChange={setAdvResponseBlock} placeholder='[class*="markdown"]' />
              <InputField label="就绪指示器" value={advReadyIndicator} onChange={setAdvReadyIndicator} placeholder="(auto)" />
              <InputField label="发送按钮" value={advSendButton} onChange={setAdvSendButton} placeholder="(auto)" />
            </div>
            <Button
              size="sm"
              className="mt-3"
              onClick={handleAddAdvanced}
              disabled={!advProviderId.trim() || !advLabel.trim() || !chatUrl.trim()}
            >
              使用手动选择器添加
            </Button>
          </div>
        )}
      </Card>

      {/* Accounts table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">
            已注册账户 ({state.accounts.length})
          </h3>
          <Button variant="ghost" size="sm" onClick={handleResetQuotas} disabled={state.accounts.length === 0}>
            🔄 重置配额
          </Button>
        </div>
        {state.accounts.length === 0 ? (
          <p className="text-xs text-zinc-500">暂无账户。在上方粘贴聊天网址即可添加。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wider">
                  <th className="py-2 pr-3">提供商</th>
                  <th className="py-2 pr-3">名称</th>
                  <th className="py-2 pr-3">配额</th>
                  <th className="py-2 pr-3">登录</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {state.accounts.map((acc) => (
                  <tr key={acc.id} className="border-b border-zinc-800/50 last:border-0">
                    <td className="py-2.5 pr-3">
                      <Badge variant="info">{acc.provider}</Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-zinc-300">{acc.label}</td>
                    <td className="py-2.5 pr-3">
                      {acc.quotaExhausted
                        ? <Badge variant="danger">已耗尽</Badge>
                        : <Badge variant="success">可用</Badge>
                      }
                    </td>
                    <td className="py-2.5 pr-3">
                      {loginOpenIds.includes(acc.id) ? (
                        <Button variant="ghost" size="sm" onClick={() => handleCloseLogin(acc.id)}>✅ 关闭</Button>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleLogin(acc.id)} disabled={state.isRunning}>🔑 登录</Button>
                      )}
                    </td>
                    <td className="py-2.5">
                      <Button variant="ghost" size="sm" onClick={() => handleRemoveAccount(acc.id)}>
                        <Trash2 size={12} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Custom providers */}
      {providers.filter((p) => !p.builtin).length > 0 && (
        <Card>
          <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">自定义提供商</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wider">
                  <th className="py-2 pr-3">ID</th>
                  <th className="py-2 pr-3">名称</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {providers.filter((p) => !p.builtin).map((p) => (
                  <tr key={p.id} className="border-b border-zinc-800/50 last:border-0">
                    <td className="py-2.5 pr-3"><Badge variant="neutral">{p.id}</Badge></td>
                    <td className="py-2.5 pr-3 text-zinc-300">{p.label}</td>
                    <td className="py-2.5">
                      <Button variant="danger" size="sm" onClick={() => handleRemoveProvider(p.id)}>删除</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Tab 4: Video Provider Config                                       */
/* ================================================================== */

function VideoProviderTab() {
  const [config, setConfig] = useState<VideoProviderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  // Preset state
  const [presets, setPresets] = useState<Array<{ id: string; label: string; type: string }>>([]);
  const [loadingPresets, setLoadingPresets] = useState(false);

  // Form state
  const [url, setUrl] = useState('');
  const [promptInput, setPromptInput] = useState('');
  const [generateButton, setGenerateButton] = useState('');
  const [videoResult, setVideoResult] = useState('');
  const [imageUploadTrigger, setImageUploadTrigger] = useState('');
  const [progressIndicator, setProgressIndicator] = useState('');
  const [downloadButton, setDownloadButton] = useState('');
  const [maxWaitMs, setMaxWaitMs] = useState(300000);
  const [profileDir, setProfileDir] = useState('');

  useEffect(() => {
    api.getVideoProviderConfig().then((cfg) => {
      setConfig(cfg);
      if (cfg) {
        setUrl(cfg.url);
        setPromptInput(cfg.promptInput);
        setGenerateButton(cfg.generateButton);
        setVideoResult(cfg.videoResult);
        setImageUploadTrigger(cfg.imageUploadTrigger ?? '');
        setProgressIndicator(cfg.progressIndicator ?? '');
        setDownloadButton(cfg.downloadButton ?? '');
        setMaxWaitMs(cfg.maxWaitMs ?? 300000);
        setProfileDir(cfg.profileDir);
      }
    }).catch(console.error).finally(() => setLoading(false));

    api.getDataDir().then(({ dataDir }) => {
      if (!profileDir) setProfileDir(`${dataDir}/profiles/video`);
    }).catch(console.error);

    // Load presets
    setLoadingPresets(true);
    api.listPresets()
      .then(setPresets)
      .catch(console.error)
      .finally(() => setLoadingPresets(false));
  }, []);

  /** Flatten a SelectorChain array to a CSS selector string for the form */
  const chainToStr = (chain?: SelectorStrategy[]): string => {
    if (!chain || chain.length === 0) return '';
    return chain
      .filter(s => s.method === 'css')
      .sort((a, b) => b.priority - a.priority)
      .map(s => s.selector)
      .join(', ') || chain[0].selector;
  };

  const handleImportPreset = async (presetId: string) => {
    try {
      const preset = await api.getPreset(presetId);
      setUrl(preset.siteUrl);
      setPromptInput(chainToStr(preset.selectors.promptInput));
      setGenerateButton(chainToStr(preset.selectors.generateButton));
      setVideoResult(chainToStr(preset.selectors.resultElement));
      setImageUploadTrigger(chainToStr(preset.selectors.imageUploadTrigger));
      setProgressIndicator(chainToStr(preset.selectors.progressIndicator));
      setDownloadButton(chainToStr(preset.selectors.downloadButton));
      setMaxWaitMs(preset.timing.maxWaitMs);
      if (preset.profileDir) setProfileDir(preset.profileDir);
      setStatus(`✅ 已导入「${preset.label}」预设，请检查后保存`);
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '导入失败'}`);
    }
  };

  const handleSave = async () => {
    if (!url.trim() || !promptInput.trim() || !generateButton.trim() || !videoResult.trim()) {
      setStatus('❌ 请填写必填字段');
      return;
    }
    setSaving(true);
    setStatus('');
    try {
      const data: VideoProviderConfig = {
        url: url.trim(),
        promptInput: promptInput.trim(),
        generateButton: generateButton.trim(),
        videoResult: videoResult.trim(),
        imageUploadTrigger: imageUploadTrigger.trim() || undefined,
        progressIndicator: progressIndicator.trim() || undefined,
        downloadButton: downloadButton.trim() || undefined,
        maxWaitMs,
        profileDir: profileDir.trim(),
      };
      await api.updateVideoProviderConfig(data);
      setConfig(data);
      setStatus('✅ 保存成功');
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '保存失败'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setSaving(true);
    try {
      await api.updateVideoProviderConfig(null);
      setConfig(null);
      setUrl('');
      setPromptInput('');
      setGenerateButton('');
      setVideoResult('');
      setImageUploadTrigger('');
      setProgressIndicator('');
      setDownloadButton('');
      setMaxWaitMs(300000);
      setStatus('✅ 已清除视频生成配置');
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '清除失败'}`);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <p className="text-zinc-500 text-sm">加载中...</p>;

  const videoPresets = presets.filter(p => p.type === 'video');

  return (
    <div className="space-y-6">
      {/* Preset import */}
      {videoPresets.length > 0 && (
        <Card>
          <h3 className="text-sm font-bold text-white mb-3 uppercase tracking-wider">📦 从预设导入</h3>
          <p className="text-xs text-zinc-500 mb-3">
            选择一个预设模板快速填充配置。预设包含经过验证的选择器，比手动配置更稳定可靠。
          </p>
          <div className="flex flex-wrap gap-2">
            {videoPresets.map(preset => (
              <Button
                key={preset.id}
                variant="outline"
                size="sm"
                onClick={() => handleImportPreset(preset.id)}
                disabled={loadingPresets}
              >
                📋 {preset.label}
              </Button>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">视频生成站点配置</h3>
          {config ? <Badge variant="success">已配置</Badge> : <Badge variant="neutral">未配置</Badge>}
        </div>
        <p className="text-xs text-zinc-500 mb-4">
          配置浏览器自动化视频生成站点（如即梦、Seedance）。系统将通过 Playwright 操控浏览器在该站点生成视频。
          支持多选择器（逗号分隔），系统会按优先级依次尝试。
        </p>

        <div className="space-y-3">
          <InputField label="站点 URL *" value={url} onChange={setUrl} placeholder="https://jimeng.jianying.com/ai-tool/home?type=video&workspace=0" />
          <div className="grid grid-cols-2 gap-3">
            <InputField label="提示输入选择器 *" value={promptInput} onChange={setPromptInput} placeholder='textarea, div[contenteditable="true"], [role="textbox"]' />
            <InputField label="生成按钮选择器 *" value={generateButton} onChange={setGenerateButton} placeholder='button:has-text("生成"), button:has-text("发送")' />
            <InputField label="视频结果选择器 *" value={videoResult} onChange={setVideoResult} placeholder="video, [class*='video'] video" />
            <InputField label="图片上传触发器" value={imageUploadTrigger} onChange={setImageUploadTrigger} placeholder='input[type="file"], [class*="upload"]' />
            <InputField label="进度指示器选择器" value={progressIndicator} onChange={setProgressIndicator} placeholder='[class*="loading"], [class*="progress"], .semi-spin' />
            <InputField label="下载按钮选择器" value={downloadButton} onChange={setDownloadButton} placeholder='button:has-text("下载"), a[download]' />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">最大等待时间 (ms)</label>
              <input
                type="number"
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
                value={maxWaitMs}
                onChange={(e) => setMaxWaitMs(Number(e.target.value) || 300000)}
              />
            </div>
            <InputField label="浏览器配置文件目录" value={profileDir} onChange={setProfileDir} placeholder="/path/to/profiles/video" />
          </div>
        </div>
      </Card>

      <div className="flex items-center gap-4">
        <Button onClick={handleSave} isLoading={saving}>保存配置</Button>
        {config && (
          <Button variant="danger" onClick={handleClear} disabled={saving}>清除配置</Button>
        )}
        {status && <span className="text-xs text-zinc-400">{status}</span>}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Tab 5: TTS & Production                                            */
/* ================================================================== */

function TTSTab() {
  const [ttsConfig, setTtsConfig] = useState<TTSSettings>({});
  const [voices, setVoices] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');

  useEffect(() => {
    Promise.all([
      api.getTtsConfig(),
      api.getTtsVoices('zh'),
    ]).then(([cfg, { voices: v }]) => {
      setTtsConfig(cfg);
      setVoices(v);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setStatus('');
    try {
      await api.updateTtsConfig(ttsConfig);
      setStatus('✅ 保存成功');
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '保存失败'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleLoadAllVoices = useCallback(async () => {
    try {
      const { voices: v } = await api.getTtsVoices();
      setVoices(v);
    } catch (err) {
      console.error('Failed to load voices', err);
    }
  }, []);

  if (loading) return <p className="text-zinc-500 text-sm">加载中...</p>;

  return (
    <div className="space-y-6">
      {/* TTS Voice */}
      <Card>
        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">语音合成 (TTS)</h3>
        <p className="text-xs text-zinc-500 mb-4">
          使用 edge-tts 进行免费语音合成。选择声音、调整语速和音调。
        </p>

        <div className="space-y-3">
          {/* Voice selector */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">声音</label>
              <button
                className="text-[10px] text-indigo-400 hover:underline"
                onClick={handleLoadAllVoices}
              >
                加载全部语言
              </button>
            </div>
            <select
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              value={ttsConfig.voice ?? 'zh-CN-XiaoxiaoNeural'}
              onChange={(e) => setTtsConfig({ ...ttsConfig, voice: e.target.value })}
            >
              {voices.length === 0 && (
                <option value="zh-CN-XiaoxiaoNeural">zh-CN-XiaoxiaoNeural (默认)</option>
              )}
              {voices.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>

          {/* Rate */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">语速调整</label>
              <input
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
                value={ttsConfig.rate ?? ''}
                onChange={(e) => setTtsConfig({ ...ttsConfig, rate: e.target.value || undefined })}
                placeholder="+0% (例如: +10%, -5%)"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">音调调整</label>
              <input
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
                value={ttsConfig.pitch ?? ''}
                onChange={(e) => setTtsConfig({ ...ttsConfig, pitch: e.target.value || undefined })}
                placeholder="+0Hz (例如: +5Hz, -2Hz)"
              />
            </div>
          </div>
        </div>
      </Card>

      {/* Save */}
      <div className="flex items-center gap-4">
        <Button onClick={handleSave} isLoading={saving}>保存配置</Button>
        {status && <span className="text-xs text-zinc-400">{status}</span>}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Shared: InputField component                                       */
/* ================================================================== */

function InputField({ label, value, onChange, placeholder }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">{label}</label>
      <input
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
      />
    </div>
  );
}
