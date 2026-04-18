import { useState } from 'react';
import { Trash2, ChevronDown, ChevronRight, DollarSign } from 'lucide-react';
import { api } from '../../api/client';
import { logger } from '../../lib/logger';
import { Card } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { AiResource, AiResourceType, GlobalCostSummary } from '../../types';

const TYPE_LABELS: Record<string, string> = {
  chat: '聊天',
  video: '视频',
  image: '图像',
  multi: '多功能',
  api: 'API',
};

const TYPE_OPTIONS: { value: AiResourceType; label: string }[] = [
  { value: 'chat', label: '聊天 (文本生成)' },
  { value: 'video', label: '视频 (视频生成)' },
  { value: 'image', label: '图像 (图片生成)' },
  { value: 'multi', label: '多功能' },
  { value: 'api', label: 'API (付费密钥)' },
];

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function InputField({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <div>
      <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">{label}</label>
      <input
        className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
        value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

export function AccountSettings({ resources, loginOpenIds, providers, isRunning, concurrency, setConcurrency, costs, refresh }: {
  resources: AiResource[];
  loginOpenIds: string[];
  providers: Array<{ id: string; label: string; builtin: boolean }>;
  isRunning: boolean;
  concurrency: number;
  setConcurrency: (v: number) => void;
  costs: GlobalCostSummary | null;
  refresh: () => void;
}) {
  const [aivideomakerKey, setAivideomakerKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [chatUrl, setChatUrl] = useState('');
  const [resourceType, setResourceType] = useState<AiResourceType>('chat');
  const [adding, setAdding] = useState(false);
  const [addStatus, setAddStatus] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [advProviderId, setAdvProviderId] = useState('');
  const [advLabel, setAdvLabel] = useState('');
  const [advPromptInput, setAdvPromptInput] = useState('');
  const [advResponseBlock, setAdvResponseBlock] = useState('');
  const [advReadyIndicator, setAdvReadyIndicator] = useState('');
  const [advSendButton, setAdvSendButton] = useState('');
  const [pendingRemoveResource, setPendingRemoveResource] = useState<{ id: string; label: string } | null>(null);
  const [showResetQuotasConfirm, setShowResetQuotasConfirm] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setStatus('');
    logger.info('user', 'save_settings', { concurrency });
    try {
      const data: { aivideomakerApiKey?: string; productionConcurrency: number } = {
        productionConcurrency: concurrency,
      };
      if (aivideomakerKey.trim()) data.aivideomakerApiKey = aivideomakerKey.trim();
      await api.updateConfig(data);
      setAivideomakerKey('');
      setStatus('✅ 保存成功');
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '保存失败'}`);
    } finally {
      setSaving(false);
    }
  };

  const handleAddFromUrl = async () => {
    if (!chatUrl.trim()) return;
    setAdding(true);
    setAddStatus('');
    logger.info('user', 'add_provider_from_url', { url: chatUrl.trim(), type: resourceType || 'auto' });
    try {
      const result = await api.addProviderFromUrl(chatUrl.trim(), resourceType || undefined);
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
    logger.info('user', 'add_provider_advanced', { providerId: advProviderId.trim(), label: advLabel.trim() });
    try {
      await api.addProvider(advProviderId.trim(), advLabel.trim(), {
        chatUrl: chatUrl.trim(),
        promptInput: advPromptInput.trim() || 'textarea',
        responseBlock: advResponseBlock.trim() || '[class*="markdown"]',
        readyIndicator: advReadyIndicator.trim() || advPromptInput.trim() || 'textarea',
        sendButton: advSendButton.trim() || undefined,
      } as Record<string, string>);
      setChatUrl(''); setAdvProviderId(''); setAdvLabel('');
      setAdvPromptInput(''); setAdvResponseBlock(''); setAdvReadyIndicator(''); setAdvSendButton('');
      setShowAdvanced(false);
      setAddStatus('✅ 自定义提供商添加成功');
      refresh();
    } catch (err) {
      setAddStatus(`❌ ${err instanceof Error ? err.message : '失败'}`);
    }
  };

  const handleRemoveAccount = async (resourceId: string) => { logger.info('user', 'remove_resource', { resourceId }); await api.removeResource(resourceId); refresh(); };
  const handleResetQuotas = async () => { logger.info('user', 'reset_quotas'); await api.resetResourceQuotas(); refresh(); };
  const handleLogin = async (resourceId: string) => { logger.info('user', 'open_login', { resourceId }); try { await api.loginResource(resourceId); refresh(); } catch (err) { logger.error('user', 'open_login_failed', { resourceId, error: err instanceof Error ? err.message : String(err) }); } };
  const handleCloseLogin = async (resourceId: string) => { logger.info('user', 'close_login', { resourceId }); await api.closeResourceLogin(resourceId); refresh(); };

  return (
    <div className="space-y-6">
      {/* ---- AI Resources ---- */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">
            AI 资源 ({resources.length})
          </h3>
          <Button variant="ghost" size="sm" onClick={() => setShowResetQuotasConfirm(true)} disabled={resources.length === 0}>
            🔄 重置配额
          </Button>
        </div>

        {resources.length > 0 && (
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-zinc-500 uppercase tracking-wider">
                  <th className="py-2 pr-3">类型</th>
                  <th className="py-2 pr-3">名称</th>
                  <th className="py-2 pr-3">能力</th>
                  <th className="py-2 pr-3">配额</th>
                  <th className="py-2 pr-3">登录</th>
                  <th className="py-2">操作</th>
                </tr>
              </thead>
              <tbody>
                {resources.map(res => {
                  const caps = res.capabilities ?? {};
                  const capLabels: string[] = [];
                  if (caps.text) capLabels.push('文本');
                  if (caps.image) capLabels.push('图像');
                  if (caps.video) capLabels.push('视频');
                  if (caps.fileUpload) capLabels.push('上传');
                  if (caps.webSearch) capLabels.push('搜索');
                  const isCustom = !providers.some(p => p.builtin && p.id === res.provider);
                  return (
                    <tr key={res.id} className="border-b border-zinc-800/50 last:border-0">
                      <td className="py-2.5 pr-3">
                        <Badge variant={res.type === 'chat' ? 'info' : res.type === 'video' ? 'warning' : res.type === 'image' ? 'success' : res.type === 'api' ? 'neutral' : 'neutral'}>
                          {TYPE_LABELS[res.type] ?? res.type}
                        </Badge>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white">{res.label}</span>
                          {isCustom && <Badge variant="neutral">自定义</Badge>}
                        </div>
                        <div className="text-[10px] text-zinc-600 mt-0.5">
                          {res.type === 'api' ? (res.apiKeyMasked ?? 'API Key') : safeHostname(res.siteUrl)}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-wrap gap-1">
                          {capLabels.length > 0 ? capLabels.map(c => (
                            <span key={c} className="px-1.5 py-0.5 bg-zinc-800 rounded text-[10px] text-zinc-400">{c}</span>
                          )) : <span className="text-[10px] text-zinc-600">—</span>}
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        {res.quotaExhausted ? (
                          <div>
                            <Badge variant="danger">已耗尽</Badge>
                            {res.quotaResetAt && (
                              <span className="text-[10px] text-zinc-600 ml-2">
                                重置于 {new Date(res.quotaResetAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                              </span>
                            )}
                          </div>
                        ) : (
                          <Badge variant="success">可用</Badge>
                        )}
                      </td>
                      <td className="py-2.5 pr-3">
                        {res.type === 'api' ? (
                          <span className="text-[10px] text-zinc-600">—</span>
                        ) : loginOpenIds.includes(res.id) ? (
                          <Button variant="ghost" size="sm" onClick={() => handleCloseLogin(res.id)}>✅ 关闭</Button>
                        ) : (
                          <Button variant="outline" size="sm" onClick={() => handleLogin(res.id)} disabled={isRunning}>🔑 登录</Button>
                        )}
                      </td>
                      <td className="py-2.5">
                        <Button variant="ghost" size="sm" onClick={() => setPendingRemoveResource({ id: res.id, label: res.label })}>
                          <Trash2 size={12} />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Add account */}
        <div className="border-t border-zinc-800 pt-4">
          <p className="text-xs text-zinc-500 mb-3">
            粘贴任何 AI 网站 URL — 自动检测类型、创建资源并打开浏览器登录。也可手动选择类型。
          </p>
          <div className="flex gap-3 items-end">
            <div className="flex-1">
              <input
                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
                value={chatUrl}
                onChange={(e) => setChatUrl(e.target.value)}
                placeholder="https://klingai.com 或任何 AI 网站 URL"
                onKeyDown={(e) => { if (e.key === 'Enter' && !adding && chatUrl.trim()) handleAddFromUrl(); }}
              />
            </div>
            <select
              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
              value={resourceType}
              onChange={(e) => setResourceType(e.target.value as AiResourceType)}
            >
              <option value="">自动检测</option>
              {TYPE_OPTIONS.map(opt => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
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
              <Button size="sm" className="mt-3" onClick={handleAddAdvanced}
                disabled={!advProviderId.trim() || !advLabel.trim() || !chatUrl.trim()}>
                使用手动选择器添加
              </Button>
            </div>
          )}
        </div>
      </Card>

      {/* ---- API 与生产配置 ---- */}
      <Card>
        <h3 className="text-xs font-bold text-zinc-400 mb-4 uppercase tracking-wider">API 与生产配置</h3>

        {/* Cost summary */}
        {costs && costs.totalCalls > 0 && (
          <div className="flex gap-6 mb-5 p-3 rounded-lg bg-zinc-800/50">
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">累计消费</div>
              <div className="text-lg font-bold text-white flex items-center gap-1">
                <DollarSign size={14} className="text-emerald-500" />
                {costs.totalCostUsd.toFixed(3)}
              </div>
            </div>
            <div>
              <div className="text-[10px] text-zinc-500 uppercase">API 调用</div>
              <div className="text-lg font-bold text-white">{costs.totalCalls}</div>
            </div>
          </div>
        )}

        {/* AIVideoMaker API Key */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <label className="text-[10px] text-zinc-500 uppercase tracking-wider">AIVideoMaker API Key</label>
            </div>
            <input
              type="password"
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              placeholder="视频生成 API Key（可选）"
              value={aivideomakerKey}
              onChange={(e) => setAivideomakerKey(e.target.value)}
            />
          </div>
          <a href="https://aivideomaker.ai" target="_blank" rel="noopener noreferrer"
            className="text-xs text-indigo-400 hover:underline whitespace-nowrap self-end pb-2">
            获取 Key →
          </a>
        </div>

        {/* Concurrency */}
        <div className="flex items-center gap-4 mb-4 pt-3 border-t border-zinc-800">
          <label className="text-xs text-zinc-400">场景并发数</label>
          <input type="number" min={1} max={5} value={concurrency}
            onChange={(e) => setConcurrency(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
            className="w-20 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500" />
          <span className="text-xs text-zinc-600">（1-5，默认 2）</span>
        </div>

        {/* Save */}
        <div className="flex items-center gap-4">
          <Button onClick={handleSave} isLoading={saving}>保存配置</Button>
          {status && <span className="text-xs text-zinc-400">{status}</span>}
        </div>
      </Card>

      <ConfirmModal
        isOpen={pendingRemoveResource !== null}
        title="删除资源"
        description={`确认删除资源「${pendingRemoveResource?.label}」？删除后需要重新添加。`}
        confirmLabel="确认删除"
        variant="danger"
        onConfirm={() => {
          if (pendingRemoveResource) handleRemoveAccount(pendingRemoveResource.id);
          setPendingRemoveResource(null);
        }}
        onCancel={() => setPendingRemoveResource(null)}
      />

      <ConfirmModal
        isOpen={showResetQuotasConfirm}
        title="重置配额"
        description="确认重置所有资源的配额状态？"
        confirmLabel="确认重置"
        variant="warning"
        onConfirm={() => {
          handleResetQuotas();
          setShowResetQuotasConfirm(false);
        }}
        onCancel={() => setShowResetQuotasConfirm(false)}
      />
    </div>
  );
}
