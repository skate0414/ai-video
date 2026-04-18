import { useState, useEffect, useCallback } from 'react';
import { Plus, X, Trash2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { api } from '../../api/client';
import { logger } from '../../lib/logger';
import { Button } from '../../components/ui/Button';
import { ConfirmModal } from '../../components/ConfirmModal';
import type { EnvironmentStatus, TTSSettings, QueueDetectionConfig, QueueEtaPattern } from '../../types';

/* ================================================================== */
/*  TTS Configuration                                                  */
/* ================================================================== */

export function TTSSection() {
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
      setTtsConfig(cfg); setVoices(v);
    }).catch(err => logger.error('api', 'load_tts_config_failed', { error: err instanceof Error ? err.message : String(err) })).finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setStatus('');
    logger.info('user', 'save_tts_config', { voice: ttsConfig.voice });
    try {
      await api.updateTtsConfig(ttsConfig);
      setStatus('✅ 保存成功');
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '保存失败'}`);
    } finally { setSaving(false); }
  };

  const handleLoadAllVoices = useCallback(async () => {
    logger.info('user', 'load_all_tts_voices');
    try { const { voices: v } = await api.getTtsVoices(); setVoices(v); }
    catch (err) { logger.error('api', 'load_voices_failed', { error: err instanceof Error ? err.message : String(err) }); }
  }, []);

  if (loading) return <p className="text-zinc-500 text-sm">加载中...</p>;

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">使用 edge-tts 进行免费语音合成。选择声音、调整语速和音调。</p>

      <div className="space-y-3">
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider">声音</label>
            <button className="text-[10px] text-indigo-400 hover:underline" onClick={handleLoadAllVoices}>
              加载全部语言
            </button>
          </div>
          <select
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
            value={ttsConfig.voice ?? 'zh-CN-XiaoxiaoNeural'}
            onChange={(e) => setTtsConfig({ ...ttsConfig, voice: e.target.value })}
          >
            {voices.length === 0 && <option value="zh-CN-XiaoxiaoNeural">zh-CN-XiaoxiaoNeural (默认)</option>}
            {voices.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">语速调整</label>
            <input
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              value={ttsConfig.rate ?? ''} onChange={(e) => setTtsConfig({ ...ttsConfig, rate: e.target.value || undefined })}
              placeholder="+0% (例如: +10%, -5%)" />
          </div>
          <div>
            <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1 block">音调调整</label>
            <input
              className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
              value={ttsConfig.pitch ?? ''} onChange={(e) => setTtsConfig({ ...ttsConfig, pitch: e.target.value || undefined })}
              placeholder="+0Hz (例如: +5Hz, -2Hz)" />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Button onClick={handleSave} isLoading={saving}>保存配置</Button>
        {status && <span className="text-xs text-zinc-400">{status}</span>}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Queue Detection Rules                                              */
/* ================================================================== */

export function QueueDetectionSection() {
  const [presets, setPresets] = useState<Record<string, QueueDetectionConfig>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newProviderId, setNewProviderId] = useState('');
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    api.getQueueDetectionPresets()
      .then(data => setPresets(data))
      .catch(err => logger.error('api', 'load_queue_presets_failed', { error: err instanceof Error ? err.message : String(err) }))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true); setStatus('');
    try {
      const result = await api.updateQueueDetectionPresets(presets);
      setPresets(result.queueDetection);
      setStatus('✅ 保存成功');
    } catch (err) {
      setStatus(`❌ ${err instanceof Error ? err.message : '保存失败'}`);
    } finally { setSaving(false); }
  };

  const handleAddProvider = () => {
    const id = newProviderId.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id || presets[id]) return;
    setPresets({ ...presets, [id]: { queueKeywords: [], etaPatterns: [] } });
    setNewProviderId('');
    setEditingId(id);
  };

  const handleDeleteProvider = async (id: string) => {
    const next = { ...presets };
    delete next[id];
    setPresets(next);
    if (editingId === id) setEditingId(null);
    try {
      await api.deleteQueueDetectionPreset(id);
    } catch { /* ignore — may not exist on server yet */ }
  };

  const updateConfig = (id: string, config: QueueDetectionConfig) => {
    setPresets({ ...presets, [id]: config });
  };

  if (loading) return <p className="text-zinc-500 text-sm">加载中...</p>;

  const providerIds = Object.keys(presets);

  return (
    <div className="space-y-4">
      <p className="text-xs text-zinc-500">
        为每个视频站点配置排队检测关键词和 ETA 正则表达式。新增站点只需添加规则，无需修改代码。
      </p>

      {providerIds.length > 0 && (
        <div className="space-y-2">
          {providerIds.map(id => (
            <div key={id} className="rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
              <button
                className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-zinc-800/50 transition-colors"
                onClick={() => setEditingId(editingId === id ? null : id)}
              >
                <span className="text-sm font-medium text-white flex-1">{id}</span>
                <span className="text-[10px] text-zinc-500">
                  {presets[id].queueKeywords?.length ?? 0} 关键词 · {presets[id].etaPatterns?.length ?? 0} 模式
                </span>
              </button>

              {editingId === id && (
                <div className="px-4 pb-4 border-t border-zinc-800 pt-4 space-y-4">
                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 block">
                      排队关键词（页面文本中出现任一即视为排队状态）
                    </label>
                    <KeywordEditor
                      keywords={presets[id].queueKeywords ?? []}
                      onChange={kw => updateConfig(id, { ...presets[id], queueKeywords: kw })}
                    />
                  </div>

                  <div>
                    <label className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2 block">
                      ETA 正则模式（从页面文本中提取等待时间）
                    </label>
                    <EtaPatternEditor
                      patterns={presets[id].etaPatterns ?? []}
                      onChange={pats => updateConfig(id, { ...presets[id], etaPatterns: pats })}
                    />
                  </div>

                  <div className="pt-2 border-t border-zinc-800">
                    <Button variant="danger" size="sm" onClick={() => setPendingDeleteId(id)}>
                      <Trash2 size={12} className="mr-1" /> 删除「{id}」规则
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <ConfirmModal
        isOpen={pendingDeleteId !== null}
        title="删除规则"
        description={`确认删除「${pendingDeleteId}」的排队检测规则？`}
        confirmLabel="确认删除"
        variant="danger"
        onConfirm={() => {
          if (pendingDeleteId) handleDeleteProvider(pendingDeleteId);
          setPendingDeleteId(null);
        }}
        onCancel={() => setPendingDeleteId(null)}
      />

      {providerIds.length === 0 && (
        <p className="text-xs text-zinc-600 italic">暂无规则。点击下方按钮添加新站点。</p>
      )}

      <div className="flex gap-2 items-end">
        <div className="flex-1">
          <input
            className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
            value={newProviderId}
            onChange={e => setNewProviderId(e.target.value)}
            placeholder="新站点 ID（如 jimeng、seedance）"
            onKeyDown={e => { if (e.key === 'Enter') handleAddProvider(); }}
          />
        </div>
        <Button variant="outline" size="sm" onClick={handleAddProvider} disabled={!newProviderId.trim()}>
          <Plus size={14} className="mr-1" /> 添加站点
        </Button>
      </div>

      <div className="flex items-center gap-4 pt-2">
        <Button onClick={handleSave} isLoading={saving}>保存规则</Button>
        {status && <span className="text-xs text-zinc-400">{status}</span>}
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Advanced Settings                                                  */
/* ================================================================== */

export function AdvancedSection({ env }: { env: EnvironmentStatus | null }) {
  const [installing, setInstalling] = useState(false);
  const [installingTts, setInstallingTts] = useState(false);
  const [chromiumReady, setChromiumReady] = useState(env?.chromiumAvailable ?? false);
  const [edgeTtsReady, setEdgeTtsReady] = useState(env?.edgeTtsAvailable ?? false);
  const [installLog, setInstallLog] = useState<string[]>([]);
  const [installError, setInstallError] = useState('');

  if (!env) return <p className="text-zinc-500 text-sm">无法加载环境信息</p>;

  const handleInstallBrowser = async () => {
    setInstalling(true);
    setInstallLog([]);
    setInstallError('');
    logger.info('user', 'install_browser');
    try {
      const res = await fetch('/api/setup/install-browser', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取安装进度流');
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.message) setInstallLog((prev) => [...prev, evt.message]);
            if (evt.status === 'done') setChromiumReady(true);
            if (evt.status === 'error') setInstallError(evt.message);
          } catch { /* ignore parse error */ }
        }
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setInstalling(false);
    }
  };

  const handleInstallEdgeTts = async () => {
    setInstallingTts(true);
    setInstallError('');
    logger.info('user', 'install_edge_tts');
    try {
      const res = await fetch('/api/setup/install-edge-tts', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body?.getReader();
      if (!reader) throw new Error('无法读取安装进度流');
      const decoder = new TextDecoder();
      let buf = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const evt = JSON.parse(line.slice(6));
            if (evt.message) setInstallLog((prev) => [...prev, evt.message]);
            if (evt.status === 'done') setEdgeTtsReady(true);
            if (evt.status === 'error') setInstallError(evt.message);
          } catch { /* ignore parse error */ }
        }
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : '安装失败');
    } finally {
      setInstallingTts(false);
    }
  };

  const items = [
    { label: 'Node.js', value: env.nodeVersion, ok: true },
    { label: 'FFmpeg (视频合成)', value: env.ffmpegAvailable ? '已安装' : '未安装', ok: env.ffmpegAvailable },
    { label: 'Playwright (浏览器自动化)', value: env.playwrightAvailable ? '已安装' : '未安装', ok: env.playwrightAvailable },
    {
      label: 'Chromium 浏览器',
      value: chromiumReady ? '已就绪' : '未安装',
      ok: chromiumReady,
      action: !chromiumReady ? (
        <Button variant="outline" size="sm" onClick={handleInstallBrowser} disabled={installing} isLoading={installing}>
          {installing ? '安装中...' : '一键安装'}
        </Button>
      ) : undefined,
    },
    {
      label: 'edge-tts (语音合成)',
      value: edgeTtsReady ? '已安装' : '未安装',
      ok: edgeTtsReady,
      action: !edgeTtsReady ? (
        <Button variant="outline" size="sm" onClick={handleInstallEdgeTts} disabled={installingTts} isLoading={installingTts}>
          {installingTts ? '安装中...' : '一键安装'}
        </Button>
      ) : undefined,
    },
    { label: '数据目录', value: env.dataDir, ok: true },
    { label: '操作系统', value: env.platform, ok: true },
  ];

  return (
    <div className="space-y-3">
      <h4 className="text-xs font-bold text-zinc-400 uppercase tracking-wider">环境检测</h4>
      {items.map(item => (
        <div key={item.label} className="flex items-center justify-between py-2 border-b border-zinc-800/50 last:border-0">
          <span className="text-sm text-zinc-300">{item.label}</span>
          <div className="flex items-center gap-2">
            {item.ok ? <CheckCircle2 size={14} className="text-emerald-500" /> : <AlertTriangle size={14} className="text-amber-500" />}
            <span className={`text-xs font-mono ${item.ok ? 'text-emerald-400' : 'text-amber-400'}`}>{item.value}</span>
            {'action' in item && item.action}
          </div>
        </div>
      ))}
      {installLog.length > 0 && (
        <div className="mt-3 max-h-40 overflow-y-auto rounded-lg bg-zinc-950 border border-zinc-800 p-3 text-xs font-mono text-zinc-400 space-y-0.5">
          {installLog.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {installError && <p className="text-xs text-red-400 mt-2">❌ {installError}</p>}
    </div>
  );
}

/* ================================================================== */
/*  Keyword Editor sub-component                                       */
/* ================================================================== */

function KeywordEditor({ keywords, onChange }: { keywords: string[]; onChange: (kw: string[]) => void }) {
  const [input, setInput] = useState('');

  const handleAdd = () => {
    const kw = input.trim();
    if (!kw || keywords.includes(kw)) return;
    onChange([...keywords, kw]);
    setInput('');
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {keywords.map((kw, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-1 bg-zinc-800 rounded-md text-xs text-zinc-300">
            {kw}
            <button className="text-zinc-500 hover:text-red-400 transition-colors" onClick={() => onChange(keywords.filter((_, j) => j !== i))}>
              <X size={10} />
            </button>
          </span>
        ))}
        {keywords.length === 0 && <span className="text-[10px] text-zinc-600 italic">无关键词</span>}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-white placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="输入关键词后回车"
          onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        />
        <Button variant="ghost" size="sm" onClick={handleAdd} disabled={!input.trim()}>添加</Button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  ETA Pattern Editor sub-component                                   */
/* ================================================================== */

function EtaPatternEditor({ patterns, onChange }: { patterns: QueueEtaPattern[]; onChange: (p: QueueEtaPattern[]) => void }) {
  const handleAdd = () => {
    onChange([...patterns, { regex: '', minutesGroup: 1 }]);
  };

  const handleUpdate = (index: number, patch: Partial<QueueEtaPattern>) => {
    const next = patterns.map((p, i) => i === index ? { ...p, ...patch } : p);
    onChange(next);
  };

  const handleRemove = (index: number) => {
    onChange(patterns.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-2">
      {patterns.map((pat, i) => (
        <div key={i} className="flex items-start gap-2 p-2 bg-zinc-950 rounded-lg border border-zinc-800">
          <div className="flex-1 space-y-2">
            <input
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-white font-mono placeholder:text-zinc-600 focus:outline-none focus:border-indigo-500"
              value={pat.regex}
              onChange={e => handleUpdate(i, { regex: e.target.value })}
              placeholder="正则表达式，如: (\\d+)\\s*分钟"
            />
            <div className="flex gap-3">
              <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                分钟捕获组
                <input
                  type="number" min={0} max={9}
                  className="w-12 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  value={pat.minutesGroup ?? ''}
                  onChange={e => handleUpdate(i, { minutesGroup: e.target.value ? Number(e.target.value) : undefined })}
                />
              </label>
              <label className="flex items-center gap-1 text-[10px] text-zinc-500">
                秒数捕获组
                <input
                  type="number" min={0} max={9}
                  className="w-12 bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-white focus:outline-none focus:border-indigo-500"
                  value={pat.secondsGroup ?? ''}
                  onChange={e => handleUpdate(i, { secondsGroup: e.target.value ? Number(e.target.value) : undefined })}
                />
              </label>
            </div>
          </div>
          <button className="text-zinc-500 hover:text-red-400 mt-1 transition-colors" onClick={() => handleRemove(i)}>
            <X size={14} />
          </button>
        </div>
      ))}
      {patterns.length === 0 && <p className="text-[10px] text-zinc-600 italic">无 ETA 模式</p>}
      <Button variant="ghost" size="sm" onClick={handleAdd}>
        <Plus size={12} className="mr-1" /> 添加模式
      </Button>
    </div>
  );
}
