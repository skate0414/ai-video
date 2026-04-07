import { useState } from 'react';
import { ChevronRight, ChevronDown, Settings2 } from 'lucide-react';
import type { ModelOverrides } from '../types';

const OVERRIDE_TASKS = [
  { key: 'image_generation', label: '🖼️ 图片生成', hint: '免费额度有限，建议 balanced 模式自动降级' },
  { key: 'video_generation', label: '🎬 视频生成', hint: '⚠️ 最稀缺资源 — balanced 模式下默认使用付费 API' },
  { key: 'tts', label: '🔊 语音合成', hint: 'edge-tts 免费无限量，一般不需要覆盖' },
  { key: 'script_generation', label: '✍️ 文本生成', hint: '免费聊天额度充足，一般不需要覆盖' },
];

export function ModelOverridePanel({
  overrides,
  onChange,
  disabled,
}: {
  overrides: ModelOverrides;
  onChange: (overrides: ModelOverrides) => void;
  disabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-3 rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full px-4 py-2.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Settings2 size={14} />
        <span className="font-medium">高级：模型选择 (按步骤覆盖)</span>
      </button>
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {OVERRIDE_TASKS.map(({ key, label, hint }) => {
            const current = overrides[key];
            return (
              <div key={key} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <div className="mb-2">
                  <span className="text-sm font-semibold text-zinc-200">{label}</span>
                  <p className="text-[11px] text-zinc-500 mt-0.5">{hint}</p>
                </div>
                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    value={current?.adapter ?? 'default'}
                    disabled={disabled}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === 'default') {
                        const next = { ...overrides };
                        delete next[key];
                        onChange(next);
                      } else {
                        onChange({
                          ...overrides,
                          [key]: { adapter: val as 'chat' | 'api', model: current?.model },
                        });
                      }
                    }}
                    className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:opacity-50"
                  >
                    <option value="default">🤖 默认 (根据 Tier 自动)</option>
                    <option value="chat">💬 免费聊天</option>
                    <option value="api">💳 付费 API</option>
                  </select>
                  {current?.adapter === 'api' && (
                    <input
                      type="text"
                      placeholder="模型名 (可选，如 imagen-3-pro)"
                      value={current?.model ?? ''}
                      disabled={disabled}
                      onChange={(e) => {
                        onChange({
                          ...overrides,
                          [key]: { ...current!, model: e.target.value || undefined },
                        });
                      }}
                      className="flex-1 px-3 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 disabled:opacity-50"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
