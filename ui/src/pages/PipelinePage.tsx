import { useState, useMemo, useRef, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Plus, Search, Upload, Download, Trash2, Loader2, Film, FolderOpen, Settings } from 'lucide-react';
import { usePipeline } from '../hooks/usePipeline';
import { useWorkbench } from '../hooks/useWorkbench';
import { api } from '../api/client';
import { logger } from '../lib/logger';
import { ResourceStatusBanner } from '../components/ResourceStatusBanner';
import { ConfirmModal } from '../components/ConfirmModal';
import { DashboardSettingsPanel } from '../components/DashboardSettingsPanel';
import { getDashboardStatus, getCardAction, DASHBOARD_STATUS_META } from '../../../shared/dashboardStatus';
import type { DashboardStatus } from '../../../shared/dashboardStatus';
import type { PipelineProject, PipelineStage, StageProviderOverrides } from '../types';

const PROJECT_TEMPLATES = [
  { label: '自定义', topic: '', title: '' },
  { label: '3分钟科普视频', topic: '制作一个3分钟左右的科普解说视频，内容深入浅出、节奏紧凑、配图丰富', title: '' },
  { label: '1分钟产品介绍', topic: '制作一个1分钟精炼的产品介绍视频，突出核心卖点、画面精美', title: '' },
  { label: '5分钟深度解析', topic: '制作一个5分钟左右的深度解析视频，逻辑清晰、引用翔实、观点鲜明', title: '' },
  { label: '2分钟新闻速递', topic: '制作一个2分钟左右的新闻速递视频，客观简洁、时效性强、可视化数据', title: '' },
];

interface StyleTemplateInfo { id: string; name: string; topic: string; createdAt: string; }

const ALL_STAGES: PipelineStage[] = [
  'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH', 'NARRATIVE_MAP',
  'SCRIPT_GENERATION', 'QA_REVIEW', 'TEMPORAL_PLANNING', 'STORYBOARD', 'VIDEO_IR_COMPILE',
  'REFERENCE_IMAGE', 'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT',
];

type SortKey = 'date' | 'title' | 'status';

export function PipelinePage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { projects, createProject, deleteProject, exportProject, importProject } = usePipeline();
  const { state: wbState } = useWorkbench();
  const [topic, setTopic] = useState('');
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('date');
  const [stageOverrides, setStageOverrides] = useState<StageProviderOverrides>({});
  const importRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [styleTemplates, setStyleTemplates] = useState<StyleTemplateInfo[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [uploadedVideoFile, setUploadedVideoFile] = useState<File | null>(null);
  const [pendingDeleteProject, setPendingDeleteProject] = useState<{ id: string; title: string } | null>(null);
  const [showSettingsPanel, setShowSettingsPanel] = useState(false);

  // Derived: are AI resources available? (at least one configured account)
  const liveResources = wbState.resources ?? wbState.accounts ?? [];
  const hasAiResource = liveResources.length > 0;
  // Derived: is a video source selected?
  const hasVideo = !!(selectedTemplateId || uploadedVideoFile);
  // Create button is enabled only when topic + video + resources are ready
  const canCreate = !creating && !!topic.trim() && hasVideo && hasAiResource;

  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission();
    }
    api.listStyleTemplates().then(setStyleTemplates).catch(() => {});
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('panel') === 'settings') {
      setShowSettingsPanel(true);
    }
  }, [location.search]);

  const filteredProjects = useMemo(() => {
    let list = projects;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      list = list.filter((p) => (p.title ?? '').toLowerCase().includes(q) || (p.topic ?? '').toLowerCase().includes(q));
    }
    if (sortKey === 'title') {
      list = [...list].sort((a, b) => a.title.localeCompare(b.title));
    } else if (sortKey === 'status') {
      const statusRank = (p: PipelineProject) => {
        if (Object.values(p.stageStatus ?? {}).some((s) => s === 'processing')) return 0;
        if (p.isPaused) return 1;
        if (ALL_STAGES.every((s) => (p.stageStatus ?? {} as any)[s] === 'completed')) return 3;
        return 2;
      };
      list = [...list].sort((a, b) => statusRank(a) - statusRank(b));
    }
    return list;
  }, [projects, search, sortKey]);

  const handleCreate = async () => {
    if (!canCreate) return;
    setCreating(true);
    setCreateError('');
    logger.info('user', 'create_project_start', { topic: topic.trim(), hasTemplate: !!selectedTemplateId, hasVideo: !!uploadedVideoFile });
    try {
      const p = await createProject(topic.trim(), title.trim() || undefined);

      // Save stage provider overrides if any were configured
      if (Object.keys(stageOverrides).length > 0) {
        await api.updateStageProviderOverrides(p.id, stageOverrides);
      }

      if (selectedTemplateId) {
        // Quick mode: apply template → start pipeline → jump to script
        const tpl = await api.getStyleTemplate(selectedTemplateId);
        if (tpl?.styleProfile) {
          await api.setStyleProfile(p.id, { styleProfile: tpl.styleProfile, topic: p.topic, formatSignature: tpl.formatSignature });
        }
        await api.startPipeline(p.id);
        navigate(`/${p.id}/script`);
      } else if (uploadedVideoFile) {
        // Upload mode: upload video → start pipeline → jump to style page
        const reader = new FileReader();
        const base64 = await new Promise<string>((resolve, reject) => {
          reader.onload = () => resolve((reader.result as string).split(',')[1]);
          reader.onerror = () => reject(new Error('视频文件读取失败'));
          reader.readAsDataURL(uploadedVideoFile);
        });
        const result = await api.uploadFiles([{ name: uploadedVideoFile.name, data: base64 }]);
        await api.startPipeline(p.id, result.paths?.[0]);
        navigate(`/${p.id}/style`);
      } else {
        // No template, no video: go to style page for manual setup
        navigate(`/${p.id}/style`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : '创建失败';
      logger.error('user', 'create_project_failed', { error: msg });
      setCreateError(msg);
    } finally {
      setCreating(false);
    }
  };

  const handleExport = async (e: React.MouseEvent, projectId: string) => {
    e.stopPropagation();
    logger.info('user', 'export_project', { projectId });
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
      logger.error('user', 'export_project_failed', { projectId, error: err instanceof Error ? err.message : String(err) });
      alert('导出失败: ' + (err instanceof Error ? err.message : String(err)));
    }
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    logger.info('user', 'import_project', { fileName: file.name });
    try {
      const text = await file.text();
      const bundle = JSON.parse(text);
      const p = await importProject(bundle);
      navigate(`/${p.id}/${getSmartTarget(p)}`);
    } catch (err) {
      logger.error('user', 'import_project_failed', { error: err instanceof Error ? err.message : String(err) });
      alert('导入失败: ' + (err instanceof Error ? err.message : String(err)));
    }
    if (importRef.current) importRef.current.value = '';
  };

  function getSmartTarget(p: PipelineProject): string {
    const ss = p.stageStatus ?? {} as Record<string, string>;
    if (ss.STYLE_EXTRACTION !== 'completed') return 'style';
    if (ss.QA_REVIEW !== 'completed') return 'script';
    if (ss.KEYFRAME_GEN !== 'completed') return 'storyboard';
    return 'production';
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-4 space-y-4">
      {/* Environment resource status — compact inline */}
      <ResourceStatusBanner />

      {/* Create project card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
        <h3 className="text-sm font-semibold text-zinc-200">创建新项目</h3>
        <div className="flex flex-wrap gap-2 mb-1">
          {PROJECT_TEMPLATES.map((tpl) => (
            <button
              key={tpl.label}
              onClick={() => { if (tpl.topic) { setTopic(tpl.topic); if (tpl.title) setTitle(tpl.title); } }}
              className={`px-3.5 py-1.5 text-xs rounded-full border transition-all ${
                tpl.topic === '' ? 'border-zinc-800 text-zinc-600 cursor-default'
                  : topic === tpl.topic ? 'border-indigo-500 text-indigo-300 bg-indigo-500/15 ring-1 ring-indigo-500/30'
                  : 'border-zinc-700 text-zinc-400 bg-zinc-800/80 hover:bg-zinc-700 hover:text-zinc-200'
              }`}
              disabled={tpl.topic === ''}
            >
              {tpl.label}
            </button>
          ))}
        </div>
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            type="text"
            placeholder="视频主题 (必填)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
          <input
            type="text"
            placeholder="项目标题 (可选)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="flex-1 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
          />
        </div>
        {/* AI provider config link */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-2.5 flex items-center justify-between">
          <span className="text-sm text-zinc-400">🤖 AI 提供商配置</span>
          <button
            onClick={() => setShowSettingsPanel((v) => !v)}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 border border-zinc-700 rounded-lg transition-colors"
          >
            <Settings size={12} /> {showSettingsPanel ? '收起设置' : '展开设置'}
          </button>
        </div>

        {/* Style selection: template or upload video */}
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4 space-y-3">
          <h4 className="text-sm font-semibold text-zinc-200 flex items-center gap-1.5">
            <Film size={14} /> 视频风格
          </h4>

          {styleTemplates.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                <FolderOpen size={12} /> 使用已有风格模板（跳过分析，直接进入脚本）
              </div>
              <div className="flex flex-wrap gap-2">
                {styleTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    onClick={() => {
                      setSelectedTemplateId(selectedTemplateId === tpl.id ? null : tpl.id);
                      if (selectedTemplateId !== tpl.id) setUploadedVideoFile(null);
                    }}
                    className={`group/tpl relative px-3 py-1.5 text-xs rounded-lg border transition-all ${
                      selectedTemplateId === tpl.id
                        ? 'border-indigo-500 text-indigo-300 bg-indigo-500/15 ring-1 ring-indigo-500/30'
                        : 'border-zinc-700 text-zinc-400 bg-zinc-800/80 hover:bg-zinc-700 hover:text-zinc-200'
                    }`}
                  >
                    📋 {tpl.name}
                    <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover/tpl:block w-48 px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 shadow-xl text-left z-10">
                      <span className="block text-[11px] font-semibold text-zinc-200">{tpl.name}</span>
                      <span className="block text-[10px] text-zinc-500 mt-0.5 truncate">主题: {tpl.topic}</span>
                      <span className="block text-[10px] text-zinc-600 mt-0.5">{new Date(tpl.createdAt).toLocaleDateString()}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs text-zinc-400">
              <Upload size={12} /> 上传参考视频（将自动分析风格）
            </div>
            <div className="flex items-center gap-3">
              <input
                ref={videoInputRef}
                type="file"
                accept="video/*"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0] ?? null;
                  setUploadedVideoFile(f);
                  if (f) setSelectedTemplateId(null);
                }}
              />
              <button
                onClick={() => videoInputRef.current?.click()}
                className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs rounded-lg border transition-all ${
                  uploadedVideoFile
                    ? 'border-indigo-500 text-indigo-300 bg-indigo-500/15'
                    : 'border-zinc-700 text-zinc-400 bg-zinc-800/80 hover:bg-zinc-700 hover:text-zinc-200'
                }`}
              >
                <Upload size={12} />
                {uploadedVideoFile ? uploadedVideoFile.name : '选择视频文件'}
              </button>
              {uploadedVideoFile && (
                <button
                  onClick={() => { setUploadedVideoFile(null); if (videoInputRef.current) videoInputRef.current.value = ''; }}
                  className="text-xs text-zinc-500 hover:text-zinc-300"
                >
                  清除
                </button>
              )}
            </div>
          </div>
        </div>

        <button
          onClick={handleCreate}
          disabled={!canCreate}
          className="w-full inline-flex items-center justify-center gap-1.5 px-5 py-2.5 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
        >
          {creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          {creating ? '创建中...' : selectedTemplateId ? '🎬 创建视频' : uploadedVideoFile ? '🎬 创建并分析风格' : '创建项目'}
        </button>
        {!canCreate && !creating && (
          <p className="text-[11px] text-zinc-500">
            {!topic.trim() ? '请输入视频主题' : !hasVideo ? '请选择模板视频或上传参考视频' : !hasAiResource ? '请先在设置页添加 AI 资源' : ''}
          </p>
        )}
        {createError && <p className="text-sm text-red-400">❌ {createError}</p>}
      </div>

      {/* Embedded settings panel */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
        <button
          onClick={() => setShowSettingsPanel((v) => !v)}
          className="w-full flex items-center justify-between text-left"
        >
          <h3 className="text-sm font-semibold text-zinc-200">设置与默认路由</h3>
          <span className="text-xs text-zinc-500">{showSettingsPanel ? '点击收起' : '点击展开'}</span>
        </button>
        {showSettingsPanel && (
          <DashboardSettingsPanel
            stageOverrides={stageOverrides}
            onStageOverridesChange={setStageOverrides}
          />
        )}
      </div>

      {/* Project list card */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-3">
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
            const dashboardStatus = getDashboardStatus(p);
            const statusMeta = DASHBOARD_STATUS_META[dashboardStatus];
            const cardAction = getCardAction(p, dashboardStatus);
            return (
              <div
                key={p.id}
                onClick={() => navigate(`/${p.id}/${getSmartTarget(p)}`)}
                className="group rounded-xl border border-zinc-800 bg-zinc-900/30 hover:bg-zinc-800/50 p-3 cursor-pointer transition-all hover:border-zinc-700"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-base font-semibold text-zinc-100 truncate">{p.title}</span>
                      <span className={`px-2 py-0.5 text-[11px] font-semibold rounded border ${statusMeta.badgeClass}`}>
                        {statusMeta.label}
                      </span>
                    </div>
                    <p className="text-xs text-zinc-500 mt-1 truncate">{p.topic}</p>
                    <p className="text-[11px] text-zinc-500 mt-0.5">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </p>
                    {p.error && (
                      <div className="mt-2 border-l-2 border-red-500 pl-3 py-1">
                        <p className="text-xs text-red-400">⚠️ {p.error}</p>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate(`/${p.id}/${cardAction.target}`);
                      }}
                      className="px-2.5 py-1.5 text-[11px] font-semibold text-zinc-200 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors"
                    >
                      {cardAction.label}
                    </button>
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
                        setPendingDeleteProject({ id: p.id, title: p.title });
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

      <ConfirmModal
        isOpen={pendingDeleteProject !== null}
        title="删除项目"
        description={`确认删除项目「${pendingDeleteProject?.title}」？此操作不可恢复。`}
        confirmLabel="确认删除"
        variant="danger"
        onConfirm={() => {
          if (pendingDeleteProject) deleteProject(pendingDeleteProject.id);
          setPendingDeleteProject(null);
        }}
        onCancel={() => setPendingDeleteProject(null)}
      />
    </div>
  );
}
