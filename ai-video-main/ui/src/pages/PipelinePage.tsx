import { useState, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Upload, Download, Trash2, Play, Pause, CheckCircle, Loader2 } from 'lucide-react';
import { usePipeline } from '../hooks/usePipeline';
import type { PipelineProject, PipelineStage, ProcessStatus, QualityTier } from '../types';

const STAGE_LABELS: Record<PipelineStage, string> = {
  CAPABILITY_ASSESSMENT: '能力评估',
  STYLE_EXTRACTION: '风格提取',
  RESEARCH: '研究',
  NARRATIVE_MAP: '叙事地图',
  SCRIPT_GENERATION: '脚本生成',
  QA_REVIEW: '质量审查',
  STORYBOARD: '分镜',
  REFERENCE_IMAGE: '参考图',
  KEYFRAME_GEN: '关键帧',
  VIDEO_GEN: '视频生成',
  TTS: '语音合成',
  ASSEMBLY: '合成',
  REFINEMENT: '精修',
};

const ALL_STAGES: PipelineStage[] = [
  'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH', 'NARRATIVE_MAP',
  'SCRIPT_GENERATION', 'QA_REVIEW', 'STORYBOARD', 'REFERENCE_IMAGE',
  'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT',
];

const STATUS_CHIP: Record<ProcessStatus, string> = {
  pending:    'bg-zinc-800 text-zinc-500 border-zinc-700',
  processing: 'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  completed:  'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  error:      'bg-red-500/15 text-red-400 border-red-500/30',
};

const TIER_STYLES: Record<QualityTier, { label: string; cls: string }> = {
  free:     { label: '🆓 Free',     cls: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30' },
  balanced: { label: '⚖️ Balanced', cls: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/30' },
  premium:  { label: '💎 Premium',  cls: 'bg-amber-500/15 text-amber-400 border-amber-500/30' },
};

type SortKey = 'date' | 'title' | 'status';

function StageBar({ stageStatus }: { stageStatus: Record<PipelineStage, ProcessStatus> }) {
  return (
    <div className="flex flex-wrap gap-1 mt-2">
      {ALL_STAGES.map((s) => (
        <span
          key={s}
          className={`px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border ${STATUS_CHIP[stageStatus[s]]}`}
          title={STAGE_LABELS[s]}
        >
          {STAGE_LABELS[s]}
        </span>
      ))}
    </div>
  );
}

export function PipelinePage() {
  const navigate = useNavigate();
  const { projects, createProject, deleteProject, exportProject, importProject } = usePipeline();
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [qualityTier, setQualityTier] = useState<QualityTier>('balanced');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const importRef = useRef<HTMLInputElement>(null);

  const filteredProjects = useMemo(() => {
    let list = projects;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => p.title.toLowerCase().includes(q) || p.topic.toLowerCase().includes(q));
    }
    if (sortKey === 'title') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortKey === 'status') {
      const statusRank = (p: PipelineProject) => {
        if (Object.values(p.stageStatus).some((s) => s === 'processing')) return 0;
        if (p.isPaused) return 1;
        if (ALL_STAGES.every((s) => p.stageStatus[s] === 'completed')) return 3;
        return 2;
      };
      list = [...list].sort((a, b) => statusRank(a) - statusRank(b));
    }
    return list;
  }, [projects, search, sortKey]);

  const handleCreate = async () => {
    if (!topic.trim()) return;
    setCreating(true);
    setCreateError('');
    try {
      const p = await createProject(topic.trim(), title.trim() || undefined, qualityTier);
      navigate(`/${p.id}/style`);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setCreating(false);
    }
  };

  const handleExport = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    try {
      const bundle = await exportProject(projectId);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectId}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('导出失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const p = await importProject(bundle);
      navigate(`/${p.id}/style`);
    } catch (err) {
      alert('导入失败: ' + (err instanceof Error ? err.message : String(err)));
    }
    if (importRef.current) importRef.current.value = '';
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <h2 className="text-xl font-bold text-zinc-100">🎬 视频流水线</h2>

      {/* Create project card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
        <h3 className="text-sm font-semibold text-zinc-200">创建新项目</h3>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="视频主题 (必填)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
          <input
            type="text"
            placeholder="项目标题 (可选)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <select
            value={qualityTier}
            onChange={(e) => setQualityTier(e.target.value as QualityTier)}
            className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          >
            <option value="free">🆓 免费 — 使用免费 AI 聊天配额</option>
            <option value="balanced">⚖️ 均衡 — 免费优先，关键步骤用 API</option>
            <option value="premium">💎 高级 — 全程使用付费 API</option>
          </select>
          <button
            onClick={handleCreate}
            disabled={creating || !topic.trim()}
            className="inline-flex items-center justify-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
          >
            {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {creating ? '创建中...' : '创建项目'}
          </button>
        </div>
        <p className="text-xs text-zinc-500">
          {qualityTier === 'free' && '💡 全部使用免费 AI 聊天站点配额，零成本但速度较慢'}
          {qualityTier === 'balanced' && '💡 优先使用免费配额，分析和脚本等关键步骤使用 Gemini API，推荐选择'}
          {qualityTier === 'premium' && '💡 全程使用 Gemini API，速度快质量高，需要 API Key'}
        </p>
        {createError && <p className="text-sm text-red-400">❌ {createError}</p>}
      </div>

      {/* Project list card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-200">项目列表 ({projects.length})</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="relative">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="搜索项目..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50 w-40"
              />
            </div>
            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="px-2 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-400 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
            >
              <option value="date">按时间</option>
              <option value="title">按标题</option>
              <option value="status">按状态</option>
            </select>
            <input
              ref={importRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={handleImport}
            />
            <button
              onClick={() => importRef.current?.click()}
              title="导入项目"
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-400 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors"
            >
              <Upload size={12} /> 导入
            </button>
          </div>
        </div>

        {filteredProjects.length === 0 && (
          <div className="text-center py-10 text-zinc-500">
            {projects.length === 0 ? (
              <>
                <p className="text-lg">🎬 还没有项目</p>
                <p className="text-xs mt-1">在上方输入视频主题，选择质量等级后创建你的第一个项目</p>
              </>
            ) : (
              <p>🔍 没有匹配的项目</p>
            )}
          </div>
        )}

        <div className="space-y-2">
          {filteredProjects.map((p: PipelineProject) => {
            const isRunning = Object.values(p.stageStatus).some((s) => s === 'processing');
            const isComplete = ALL_STAGES.every((s) => p.stageStatus[s] === 'completed');
            const tier = TIER_STYLES[p.qualityTier];
            return (
              <div
                key={p.id}
                onClick={() => navigate(`/${p.id}/style`)}
                className="group rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-800/50 p-4 cursor-pointer transition-all hover:border-zinc-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-zinc-200 truncate">{p.title}</span>
                      <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${tier.cls}`}>{tier.label}</span>
                      {p.isPaused && (
                        <span className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold text-amber-400 bg-amber-500/15 border border-amber-500/30 rounded">
                          <Pause size={9} /> 已暂停
                        </span>
                      )}
                      {isRunning && (
                        <span className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold text-indigo-400 bg-indigo-500/15 border border-indigo-500/30 rounded">
                          <Play size={9} /> 运行中
                        </span>
                      )}
                      {isComplete && (
                        <span className="flex items-center gap-0.5 px-2 py-0.5 text-[10px] font-bold text-emerald-400 bg-emerald-500/15 border border-emerald-500/30 rounded">
                          <CheckCircle size={9} /> 已完成
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 truncate">{p.topic}</p>
                    <p className="text-[10px] text-zinc-600 mt-0.5">
                      {new Date(p.createdAt).toLocaleDateString()}
                      {p.updatedAt && ` · 更新于 ${new Date(p.updatedAt).toLocaleTimeString()}`}
                    </p>
                    <StageBar stageStatus={p.stageStatus} />
                    {p.error && <p className="text-xs text-red-400 mt-1">⚠️ {p.error}</p>}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      title="导出项目"
                      onClick={(e) => handleExport(e, p.id)}
                      className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded-lg transition-colors"
                    >
                      <Download size={14} />
                    </button>
                    <button
                      title="删除项目"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm(`确认删除项目「${p.title}」？此操作不可恢复。`)) {
                          deleteProject(p.id);
                        }
                      }}
                      className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
