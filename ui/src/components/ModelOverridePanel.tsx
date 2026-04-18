import { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, Settings2 } from 'lucide-react';
import type { ModelOverrides } from '../types';
import { api } from '../api/client';

const OVERRIDE_TASKS = [
  { key: 'image_generation', label: '🖼️ 图片生成', hint: '免费额度有限，建议 balanced 模式自动降级' },
  { key: 'video_generation', label: '🎬 视频生成', hint: '⚠️ 最稀缺资源 — balanced 模式下默认使用付费 API' },
  { key: 'tts', label: '🔊 语音合成', hint: 'edge-tts 免费无限量，一般不需要覆盖' },
  { key: 'script_generation', label: '✍️ 文本生成', hint: '免费聊天额度充足，一般不需要覆盖' },
];

const STAGE_LABELS: Record<string, string> = {
  CAPABILITY_ASSESSMENT: '能力评估',
  STYLE_EXTRACTION: '风格提取',
  RESEARCH: '研究调查',
  NARRATIVE_MAP: '叙事地图',
  SCRIPT_GENERATION: '脚本生成',
  QA_REVIEW: '质量审核',
  STORYBOARD: '分镜设计',
  VIDEO_IR_COMPILE: '视频编译',
  REFERENCE_IMAGE: '参考图',
  KEYFRAME_GEN: '关键帧',
  VIDEO_GEN: '视频生成',
  TTS: '语音合成',
  ASSEMBLY: '视频合成',
  REFINEMENT: '精修',
};

interface RouteEntry {
  stage: string;
  taskType: string;
  adapter: string;
  provider?: string;
  model?: string;
  reason: string;
}

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
  const [viewMode, setViewMode] = useState<'task' | 'stage'>('task');
  const [routeTable, setRouteTable] = useState<RouteEntry[]>([]);

  useEffect(() => {
    if (expanded && viewMode === 'stage' && routeTable.length === 0) {
      api.getRouteTable().then(setRouteTable).catch(() => {});
    }
  }, [expanded, viewMode, routeTable.length]);

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
          <div className="flex items-center gap-2 mb-2">
            <button
              onClick={() => setViewMode('task')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded border transition-colors ${viewMode === 'task' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:bg-zinc-700'}`}
            >
              按任务类型
            </button>
            <button
              onClick={() => setViewMode('stage')}
              className={`px-2.5 py-1 text-[11px] font-bold rounded border transition-colors ${viewMode === 'stage' ? 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30' : 'bg-zinc-800 text-zinc-500 border-zinc-700 hover:bg-zinc-700'}`}
            >
              按阶段查看
            </button>
          </div>

          {viewMode === 'task' && OVERRIDE_TASKS.map(({ key, label, hint }) => {
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

          {viewMode === 'stage' && (
            <div className="space-y-1.5">
              <p className="text-[11px] text-zinc-500 mb-2">下表显示当前质量等级下，每个阶段实际使用的 AI 提供模式和模型</p>
              {routeTable.map((entry) => (
                <div key={entry.stage} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-zinc-800 bg-zinc-900/40 text-xs">
                  <span className="w-20 font-semibold text-zinc-200 shrink-0">{STAGE_LABELS[entry.stage] ?? entry.stage}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${entry.adapter === 'api' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30' : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'}`}>
                    {entry.adapter === 'api' ? '💳 API' : '💬 免费'}
                  </span>
                  {entry.provider && <span className="text-zinc-500">{entry.provider}</span>}
                  {entry.model && <span className="text-zinc-400 font-mono text-[10px]">{entry.model}</span>}
                  <span className="ml-auto text-zinc-600 text-[10px] max-w-[200px] truncate" title={entry.reason}>{entry.reason}</span>
                </div>
              ))}
              {routeTable.length === 0 && <p className="text-xs text-zinc-600">加载中...</p>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
