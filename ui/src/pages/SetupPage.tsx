import { useState } from 'react';

interface SetupStatus {
  needsSetup: boolean;
  dataDir: string;
  hasApiKey: boolean;
  accountCount: number;
  ffmpegAvailable: boolean;
  playwrightAvailable?: boolean;
  nodeVersion?: string;
  platform?: string;
}

interface Props {
  status: SetupStatus;
  onComplete: () => void;
}

export function SetupPage({ status, onComplete }: Props) {
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSave = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ geminiApiKey: apiKey || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="setup-page">
      <div className="setup-card">
        <h1>🎬 AI Video Pipeline</h1>
        <p className="setup-subtitle">首次启动配置向导</p>

        <div className="setup-section">
          <h3>📋 环境检测</h3>
          <table className="setup-env-table">
            <tbody>
              <tr>
                <td>Node.js</td>
                <td className="check-ok">✅ {status.nodeVersion ?? '已安装'}</td>
              </tr>
              <tr>
                <td>FFmpeg (视频合成)</td>
                <td className={status.ffmpegAvailable ? 'check-ok' : 'check-warn'}>
                  {status.ffmpegAvailable ? '✅ 已安装' : '⚠️ 未安装 — 视频合成功能不可用'}
                </td>
              </tr>
              <tr>
                <td>Playwright (浏览器自动化)</td>
                <td className={status.playwrightAvailable ? 'check-ok' : 'check-warn'}>
                  {status.playwrightAvailable ? '✅ 已安装' : '⚠️ 未安装 — 免费模式不可用'}
                </td>
              </tr>
              <tr>
                <td>数据目录</td>
                <td className="check-ok">{status.dataDir}</td>
              </tr>
              <tr>
                <td>操作系统</td>
                <td>{status.platform ?? navigator.platform}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="setup-section">
          <h3>🔑 Gemini API Key (可选)</h3>
          <p className="setup-hint">
            输入 Google Gemini API Key 可启用「均衡」和「高级」模式。
            没有 API Key 也可以使用「免费」模式（通过浏览器自动化）。
          </p>
          <input
            type="password"
            className="setup-input"
            placeholder="AIza..."
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="setup-hint-small">
            获取方式：
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">
              Google AI Studio → 创建 API Key
            </a>
          </p>
        </div>

        <div className="setup-section">
          <h3>🎯 使用模式说明</h3>
          <div className="setup-modes">
            <div className="setup-mode">
              <strong>🆓 免费模式</strong>
              <p>使用免费 AI 聊天站点配额（需要 Playwright），零成本但速度较慢</p>
            </div>
            <div className="setup-mode">
              <strong>⚖️ 均衡模式</strong>
              <p>免费优先，关键分析步骤使用 Gemini API（需要 API Key），推荐选择</p>
            </div>
            <div className="setup-mode">
              <strong>💎 高级模式</strong>
              <p>全程 Gemini API（需要 API Key），速度快质量高</p>
            </div>
          </div>
        </div>

        {error && <p className="setup-error">❌ {error}</p>}

        <p className="setup-hint-small" style={{ marginBottom: 12 }}>
          💡 更多高级配置（TTS 声音、视频生成站点、账户管理等）可在进入后点击右上角 ⚙️ 进入设置页面。
        </p>

        <div className="setup-actions">
          <button className="btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '✅ 完成配置，进入工作台'}
          </button>
          <button className="btn-secondary" onClick={onComplete}>
            跳过 →
          </button>
        </div>
      </div>
    </div>
  );
}
