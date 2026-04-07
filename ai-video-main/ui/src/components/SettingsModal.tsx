import { useState, useEffect } from 'react';
import { useWorkbench } from '../hooks/useWorkbench';
import { api } from '../api/client';

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const { state, refresh } = useWorkbench();

  // ESC key closes modal
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

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

  const providers = state.providers;
  const loginOpenIds = state.loginOpenAccountIds ?? [];

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
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="settings-modal">
        <div className="settings-modal-header">
          <h2>⚙️ 设置</h2>
          <button className="btn-close" onClick={onClose}>✕</button>
        </div>

        <div className="settings-modal-body">
          {/* ── Add AI Chat Site ── */}
          <div className="settings-section">
            <h3>➕ 添加 AI 聊天站点</h3>
            <p className="hint">
              粘贴聊天网址 — 系统将自动检测提供商、创建账户、打开浏览器并自动探测页面选择器。
            </p>
            <div style={{ display: 'flex', gap: 12, alignItems: 'end' }}>
              <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
                <label>聊天网址</label>
                <input
                  className="form-input"
                  value={chatUrl}
                  onChange={(e) => setChatUrl(e.target.value)}
                  placeholder="https://claude.ai/new"
                  onKeyDown={(e) => { if (e.key === 'Enter' && !adding && chatUrl.trim()) handleAddFromUrl(); }}
                />
              </div>
              <button
                className="btn btn-primary"
                onClick={handleAddFromUrl}
                disabled={!chatUrl.trim() || adding}
              >
                {adding ? '⏳ 添加中…' : '🚀 添加并登录'}
              </button>
            </div>

            {addStatus && (
              <div style={{ marginTop: 8, fontSize: 13, color: 'var(--text-secondary)' }}>
                {addStatus}
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 12 }}
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                {showAdvanced ? '▼ 收起高级设置' : '▶ 高级设置 (手动配置选择器)'}
              </button>
            </div>

            {showAdvanced && (
              <div style={{ marginTop: 12, padding: 12, background: 'var(--surface-2, var(--bg-primary))', borderRadius: 8 }}>
                <p style={{ color: 'var(--text-secondary)', fontSize: 12, margin: '0 0 8px' }}>
                  仅在自动检测失败时才需要手动配置。
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label>提供商 ID</label>
                    <input className="form-input" value={advProviderId} onChange={(e) => setAdvProviderId(e.target.value)} placeholder="claude" />
                  </div>
                  <div className="form-group">
                    <label>显示名称</label>
                    <input className="form-input" value={advLabel} onChange={(e) => setAdvLabel(e.target.value)} placeholder="Claude" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <div className="form-group">
                    <label>输入框选择器</label>
                    <input className="form-input" value={advPromptInput} onChange={(e) => setAdvPromptInput(e.target.value)} placeholder="textarea" />
                  </div>
                  <div className="form-group">
                    <label>回复区域选择器</label>
                    <input className="form-input" value={advResponseBlock} onChange={(e) => setAdvResponseBlock(e.target.value)} placeholder='[class*="markdown"]' />
                  </div>
                  <div className="form-group">
                    <label>就绪指示器</label>
                    <input className="form-input" value={advReadyIndicator} onChange={(e) => setAdvReadyIndicator(e.target.value)} placeholder="(auto)" />
                  </div>
                  <div className="form-group">
                    <label>发送按钮</label>
                    <input className="form-input" value={advSendButton} onChange={(e) => setAdvSendButton(e.target.value)} placeholder="(auto)" />
                  </div>
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleAddAdvanced}
                  disabled={!advProviderId.trim() || !advLabel.trim() || !chatUrl.trim()}
                >
                  ➕ 使用手动选择器添加
                </button>
              </div>
            )}
          </div>

          {/* ── Accounts Table ── */}
          <div className="settings-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>已注册账户 ({state.accounts.length})</h3>
              <button className="btn btn-ghost btn-sm" onClick={handleResetQuotas} disabled={state.accounts.length === 0}>
                🔄 重置配额
              </button>
            </div>
            {state.accounts.length === 0 ? (
              <p className="hint">暂无账户。在上方粘贴聊天网址即可添加。</p>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>提供商</th>
                      <th>名称</th>
                      <th>配额</th>
                      <th>登录</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.accounts.map((acc) => (
                      <tr key={acc.id}>
                        <td><span className={`provider-tag provider-${acc.provider}`}>{acc.provider}</span></td>
                        <td>{acc.label}</td>
                        <td>
                          {acc.quotaExhausted
                            ? <span className="badge badge-quota">已耗尽</span>
                            : <span className="badge badge-done">可用</span>
                          }
                        </td>
                        <td>
                          {loginOpenIds.includes(acc.id) ? (
                            <button className="btn btn-ghost btn-sm" onClick={() => handleCloseLogin(acc.id)}>✅ 关闭</button>
                          ) : (
                            <button className="btn btn-primary btn-sm" onClick={() => handleLogin(acc.id)} disabled={state.isRunning}>🔑 登录</button>
                          )}
                        </td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => handleRemoveAccount(acc.id)}>✕</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* ── Custom Providers ── */}
          {providers.filter((p) => !p.builtin).length > 0 && (
            <div className="settings-section">
              <h3>自定义提供商</h3>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>ID</th><th>名称</th><th>操作</th></tr>
                  </thead>
                  <tbody>
                    {providers.filter((p) => !p.builtin).map((p) => (
                      <tr key={p.id}>
                        <td><span className="provider-tag provider-custom">{p.id}</span></td>
                        <td>{p.label}</td>
                        <td><button className="btn btn-ghost btn-sm" onClick={() => handleRemoveProvider(p.id)}>✕ 删除</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
