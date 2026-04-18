import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Music, Type, Play, Pause, Volume2, Settings2, Upload, Trash2, LayoutDashboard, History, ChevronDown, ChevronUp, Sliders, Sparkles, Library, X, Globe } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { logger } from '../lib/logger';
import { VideoPlayer } from '../components/VideoPlayer';
import { StageReviewShell } from '../components/StageReviewShell';
import { usePageGuard } from '../hooks/usePageGuard';
import { FloatingActionBar } from '../components/FloatingActionBar';
import type { ActionButton } from '../components/FloatingActionBar';
import { ConfirmModal } from '../components/ConfirmModal';
import { DownloadConfirmToast } from '../components/DownloadConfirmToast';
import type { RefineOptions, SubtitlePreset, SubtitleStyle, TitleCardStyle, QualityPreset, SpeedPreset } from '../types';
import { SUBTITLE_PRESETS, DEFAULT_REFINE_OPTIONS, WB_EVENT } from '../types';
import { api } from '../api/client';
import { connectSSE } from '../api/sse';

/** Synonym map: reference mood → library mood tag it should match. */
const MOOD_SYNONYMS: Record<string, string> = {
  uplifting: 'inspiring',
  tense: 'dramatic',
  gentle: 'calm',
  peaceful: 'calm',
  melancholy: 'sad',
  energetic: 'happy',
  cheerful: 'happy',
  somber: 'sad',
  suspenseful: 'dramatic',
  whimsical: 'playful',
  soothing: 'calm',
  aggressive: 'intense',
  hopeful: 'inspiring',
  nostalgic: 'melancholy',
  triumphant: 'epic',
};

/** Resolve a reference bgmMood to the best matching library mood tag. */
function resolveLibraryMood(refMood: string, availableMoods: string[]): string | null {
  const lower = refMood.toLowerCase().trim();
  if (!lower) return null;
  // Exact match
  if (availableMoods.includes(lower)) return lower;
  // Synonym lookup
  const mapped = MOOD_SYNONYMS[lower];
  if (mapped && availableMoods.includes(mapped)) return mapped;
  // Reverse synonym: if a library mood maps to the reference mood
  for (const [syn, target] of Object.entries(MOOD_SYNONYMS)) {
    if (target === lower && availableMoods.includes(syn)) return syn;
  }
  return null;
}

const QUALITY_LABELS: Record<QualityPreset, string> = {
  high: '高画质 (CRF 18)',
  medium: '中等画质 (CRF 20)',
  low: '低画质 (CRF 23)',
};

const SPEED_LABELS: Record<SpeedPreset, string> = {
  fast: '快速编码',
  balanced: '平衡',
  quality: '高质量编码',
};

const SUBTITLE_PRESET_LABELS: Record<SubtitlePreset, string> = {
  classic_white: '经典白字',
  backdrop_black: '黑底白字',
  cinematic: '电影风格',
  top_hint: '顶部提示',
  custom: '自定义',
};

/** Small badge showing a field was inferred from the reference video. */
function ProvenanceBadge({ field, provenance }: { field: keyof RefineOptions; provenance: Set<string> }) {
  if (!provenance.has(field)) return null;
  return (
    <span className="inline-flex items-center gap-0.5 ml-1.5 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 bg-amber-900/40 rounded-full" title="从参考视频推断">
      <Sparkles size={10} /> 参考
    </span>
  );
}

/** Top-level banner when packaging style was extracted from the reference video. */
function PackagingBanner({ provenance, isCustomized, onApplyReference }: {
  provenance: Set<string>;
  isCustomized: boolean;
  onApplyReference: () => void;
}) {
  if (provenance.size === 0) return null;

  return (
    <div className="flex items-center justify-between px-4 py-2.5 rounded-xl border border-amber-700/30 bg-amber-950/30 mb-4">
      <div className="flex items-center gap-2 text-sm text-amber-300">
        <Sparkles size={14} />
        {isCustomized
          ? <span>已自定义 <span className="text-zinc-400 text-xs">— 参考视频包装风格可用</span></span>
          : <span>已从参考视频推断包装风格 <span className="text-zinc-400 text-xs">({provenance.size} 项)</span></span>
        }
      </div>
      {isCustomized && (
        <button
          onClick={onApplyReference}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-amber-300 bg-amber-900/40 border border-amber-700/40 rounded-lg hover:bg-amber-900/60 transition-colors"
        >
          <Sparkles size={12} /> 复刻值
        </button>
      )}
    </div>
  );
}

function formatTime(sec: number): string {
  if (!sec || !isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function RefinePage() {
  const guardReady = usePageGuard(['ASSEMBLY'] as const);
  const { current, uploadBgm, deleteBgm, getBgmInfo, getBgmStreamUrl, getRefineOptions, getRefineProvenance, getRefineReferenceDefaults, updateRefineOptions, reAssemble, listBgmLibrary, getBgmLibraryStreamUrl, uploadToBgmLibrary, importBgmFromLibrary, openPixabayBrowser } = useProject();
  const navigate = useNavigate();
  const [referenceBgmMood, setReferenceBgmMood] = useState<string | null>(null);
  const [options, setOptionsRaw] = useState<RefineOptions>(DEFAULT_REFINE_OPTIONS);

  /** Wraps setOptions to mark as customized when provenance fields exist. */
  const setOptions: typeof setOptionsRaw = (value) => {
    if (provenance.size > 0) setIsCustomized(true);
    setOptionsRaw(value);
  };
  const [bgmFilename, setBgmFilename] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [assembling, setAssembling] = useState(false);
  const [uploadingBgm, setUploadingBgm] = useState(false);
  const [deletingBgm, setDeletingBgm] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [subtitleExpanded, setSubtitleExpanded] = useState(true);
  const [bgmExpanded, setBgmExpanded] = useState(true);
  const [fadeExpanded, setFadeExpanded] = useState(true);
  const [titleExpanded, setTitleExpanded] = useState(true);
  const [provenance, setProvenance] = useState<Set<string>>(new Set());
  const [referenceDefaults, setReferenceDefaults] = useState<Partial<RefineOptions> | null>(null);
  const [isCustomized, setIsCustomized] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const libraryFileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const libraryAudioRef = useRef<HTMLAudioElement>(null);
  const [bgmPlaying, setBgmPlaying] = useState(false);
  const [bgmCurrentTime, setBgmCurrentTime] = useState(0);
  const [bgmDuration, setBgmDuration] = useState(0);
  // BGM Library panel
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [libraryItems, setLibraryItems] = useState<Array<{ filename: string; mood: string; title: string; duration: number | null; size: number }>>([]);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryMoodFilter, setLibraryMoodFilter] = useState<string | null>(null);
  const [libraryPreviewFile, setLibraryPreviewFile] = useState<string | null>(null);
  const [libraryUploading, setLibraryUploading] = useState(false);
  const [libraryImporting, setLibraryImporting] = useState<string | null>(null);
  const [downloadConfirm, setDownloadConfirm] = useState<{ filename: string; originalName: string } | null>(null);
  const showReplayTools = import.meta.env.DEV;

  // Listen for BGM download completion events from Electron
  useEffect(() => {
    return connectSSE((event) => {
      if (event.type === WB_EVENT.BGM_DOWNLOAD_READY) {
        const p = event.payload as { filename: string; originalName: string };
        setDownloadConfirm({ filename: p.filename, originalName: p.originalName });
      }
    });
  }, []);

  useEffect(() => {
    if (!current?.id) return;
    const loadOptions = async () => {
      try {
        const [opts, bgmInfo, prov, refDefaults] = await Promise.all([
          getRefineOptions(current.id),
          getBgmInfo(current.id),
          getRefineProvenance(current.id).catch(() => ({ fields: [] })),
          getRefineReferenceDefaults(current.id).catch(() => null),
        ]);
        setOptionsRaw(opts);
        setBgmFilename(bgmInfo.filename ?? null);
        // Load bgmMood from style analysis CIR
        api.loadArtifact<{ audioTrack?: { bgmMood?: string } }>(current.id, 'style-analysis.cir.json')
          .then(cir => { if (cir?.audioTrack?.bgmMood) setReferenceBgmMood(cir.audioTrack.bgmMood); })
          .catch(() => {});
        const provSet = new Set(prov.fields);
        setProvenance(provSet);
        if (refDefaults && provSet.size > 0) {
          setReferenceDefaults(refDefaults);
          // Detect if user has customized away from reference defaults
          const hasCustomized = prov.fields.some(field => {
            const refVal = JSON.stringify((refDefaults as any)[field]);
            const curVal = JSON.stringify((opts as any)[field]);
            return refVal !== curVal;
          });
          setIsCustomized(hasCustomized);
        }
      } catch (e) {
        console.error('Failed to load refine options:', e);
      } finally {
        setLoading(false);
      }
    };
    loadOptions();
  }, [current?.id, getRefineOptions, getBgmInfo, getRefineProvenance, getRefineReferenceDefaults]);

  if (!current || !guardReady || loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-zinc-500" />
      </div>
    );
  }

  logger.debug('navigation', 'view_refine', { projectId: current.id });

  const isRunning = current.stageStatus['ASSEMBLY'] === 'processing';

  const handleBgmUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingBgm(true);
    try {
      await uploadBgm(current.id, file);
      // Refresh actual filename from server
      const info = await getBgmInfo(current.id);
      setBgmFilename(info.filename ?? file.name);
      logger.info('user', 'upload_bgm_success', { projectId: current.id, filename: file.name });
    } catch (err) {
      console.error('Failed to upload BGM:', err);
      logger.error('user', 'upload_bgm_failed', { projectId: current.id, error: String(err) });
    } finally {
      setUploadingBgm(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleBgmDelete = async () => {
    setDeletingBgm(true);
    try {
      await deleteBgm(current.id);
      setBgmFilename(null);
      // Stop audio playback on delete
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        setBgmPlaying(false);
        setBgmCurrentTime(0);
        setBgmDuration(0);
      }
      logger.info('user', 'delete_bgm_success', { projectId: current.id });
    } catch (err) {
      console.error('Failed to delete BGM:', err);
    } finally {
      setDeletingBgm(false);
    }
  };

  const toggleBgmPlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !current?.id || !bgmFilename) return;
    if (bgmPlaying) {
      audio.pause();
    } else {
      if (!audio.src || audio.src === '') {
        audio.src = getBgmStreamUrl(current.id);
      }
      audio.volume = options.bgmVolume;
      audio.play().catch(() => {});
    }
  }, [bgmPlaying, bgmFilename, current?.id, getBgmStreamUrl, options.bgmVolume]);

  // Sync audio volume with slider
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = options.bgmVolume;
  }, [options.bgmVolume]);

  // ---- BGM Library handlers ----
  const openLibrary = useCallback(async () => {
    setLibraryOpen(true);
    setLibraryLoading(true);
    try {
      const items = await listBgmLibrary();
      setLibraryItems(items);
      // Auto-set mood filter from reference bgmMood
      if (referenceBgmMood) {
        const availableMoods = [...new Set(items.map(i => i.mood))];
        const matched = resolveLibraryMood(referenceBgmMood, availableMoods);
        if (matched) setLibraryMoodFilter(matched);
      }
    } catch (err) {
      console.error('Failed to load BGM library:', err);
    } finally {
      setLibraryLoading(false);
    }
  }, [listBgmLibrary, referenceBgmMood]);

  const handleLibraryPreview = useCallback((filename: string) => {
    const audio = libraryAudioRef.current;
    if (!audio) return;
    if (libraryPreviewFile === filename) {
      // Toggle pause/play on same track
      if (audio.paused) { audio.play().catch(() => {}); } else { audio.pause(); }
      return;
    }
    audio.src = getBgmLibraryStreamUrl(filename);
    audio.play().catch(() => {});
    setLibraryPreviewFile(filename);
  }, [libraryPreviewFile, getBgmLibraryStreamUrl]);

  const handleLibraryImport = useCallback(async (filename: string) => {
    if (!current?.id) return;
    setLibraryImporting(filename);
    try {
      const result = await importBgmFromLibrary(current.id, filename);
      setBgmFilename(result.filename);
      // Stop project audio if playing
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = '';
        setBgmPlaying(false);
        setBgmCurrentTime(0);
        setBgmDuration(0);
      }
      setLibraryOpen(false);
      // Stop library preview
      if (libraryAudioRef.current) { libraryAudioRef.current.pause(); libraryAudioRef.current.src = ''; }
      setLibraryPreviewFile(null);
      logger.info('user', 'import_bgm_from_library', { projectId: current.id, filename });
    } catch (err) {
      console.error('Failed to import BGM from library:', err);
    } finally {
      setLibraryImporting(null);
    }
  }, [current?.id, importBgmFromLibrary, getBgmInfo]);

  const handleLibraryUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setLibraryUploading(true);
    try {
      const result = await uploadToBgmLibrary(file);
      if (result.ok) {
        setLibraryItems(prev => [...prev, { filename: result.filename, mood: result.mood, title: result.title, duration: result.duration, size: result.size }]);
      }
    } catch (err) {
      console.error('Failed to upload to BGM library:', err);
    } finally {
      setLibraryUploading(false);
      if (libraryFileInputRef.current) libraryFileInputRef.current.value = '';
    }
  }, [uploadToBgmLibrary]);

  const handleReAssemble = async () => {
    setAssembling(true);
    try {
      // Save options first, then trigger re-assembly
      await updateRefineOptions(current.id, options);
      await reAssemble(current.id);
      logger.info('user', 're_assemble_started', { projectId: current.id });
    } finally {
      setAssembling(false);
    }
  };

  const handleReset = () => {
    setOptionsRaw(DEFAULT_REFINE_OPTIONS);
    setIsCustomized(provenance.size > 0);
    setConfirmReset(false);
  };

  const handleApplyReference = () => {
    if (!referenceDefaults) return;
    setOptionsRaw(referenceDefaults as RefineOptions);
    setIsCustomized(false);
    logger.info('user', 'apply_reference_defaults', { projectId: current.id });
  };

  const updateSubtitleStyle = (updates: Partial<SubtitleStyle>) => {
    setOptions(prev => ({
      ...prev,
      subtitleStyle: { ...prev.subtitleStyle, ...updates },
    }));
  };

  const updateTitleCard = (updates: Partial<TitleCardStyle> | null) => {
    if (updates === null) {
      setOptions(prev => ({ ...prev, titleCard: null }));
    } else {
      setOptions(prev => ({
        ...prev,
        titleCard: { ...(prev.titleCard ?? { text: current.title ?? '', duration: 3, fontSize: 64, fontColor: '#ffffff' }), ...updates },
      }));
    }
  };

  const applyPreset = (preset: SubtitlePreset) => {
    if (preset === 'custom') {
      setOptions(prev => ({
        ...prev,
        subtitlePreset: 'custom',
      }));
    } else {
      const presetStyle = SUBTITLE_PRESETS[preset];
      setOptions(prev => ({
        ...prev,
        subtitlePreset: preset,
        subtitleStyle: { ...presetStyle },
      }));
    }
  };

  /** Any manual tweak auto-switches to custom preset */
  const updateSubtitleStyleCustom = (updates: Partial<SubtitleStyle>) => {
    setOptions(prev => ({
      ...prev,
      subtitlePreset: 'custom' as SubtitlePreset,
      subtitleStyle: { ...prev.subtitleStyle, ...updates },
    }));
  };

  const fabActions: ActionButton[] = [];
  if (!isRunning) {
    fabActions.push({
      label: '应用更改',
      icon: <Play size={14} />,
      onClick: handleReAssemble,
      loading: assembling,
    });
  }
  if (showReplayTools) {
    fabActions.push({ label: '查看回放', icon: <History size={14} />, onClick: () => navigate('../replay'), variant: 'secondary' });
  }
  fabActions.push({ label: '回到仪表盘', icon: <LayoutDashboard size={14} />, onClick: () => navigate('/'), variant: 'secondary' });

  return (
    <div className="flex flex-col h-full">
      <StageReviewShell stageName="精修" stageLabel="视频精修" stageStatus={isRunning ? 'processing' : 'completed'}>
        <div className="flex gap-6 h-full min-h-0">

          {/* Left: sticky video preview */}
          <div className="w-1/2 shrink-0 sticky top-0 self-start space-y-3">
            {/* Assembling status */}
            {isRunning && (
              <div className="flex items-center gap-2 px-4 py-3 rounded-xl border border-zinc-700/50 bg-zinc-800/50 text-zinc-300 text-sm">
                <Loader2 size={16} className="animate-spin" /> 正在重新组装视频，请稍候...
              </div>
            )}

            {/* Video Preview with subtitle style overlay */}
            <div className="relative">
              <VideoPlayer project={current} />
              {/* Subtitle CSS preview — simulates font size, color, outline, position */}
              {current.finalVideoPath && current.stageStatus.ASSEMBLY === 'completed' && (
                <div
                  className="absolute left-0 right-0 flex justify-center pointer-events-none"
                  style={{ bottom: `${Math.max(8, options.subtitleStyle.marginV * 0.4)}px` }}
                >
                  <span
                    style={{
                      fontSize: `${Math.max(12, options.subtitleStyle.fontSize * 0.45)}px`,
                      color: options.subtitleStyle.primaryColor,
                      WebkitTextStroke: options.subtitleStyle.outlineWidth > 0
                        ? `${Math.max(0.5, options.subtitleStyle.outlineWidth * 0.4)}px ${options.subtitleStyle.outlineColor ?? '#000000'}`
                        : undefined,
                      textShadow: options.subtitleStyle.shadowEnabled ? '2px 2px 4px rgba(0,0,0,0.8)' : undefined,
                      backgroundColor: options.subtitleStyle.backdropEnabled
                        ? `rgba(0,0,0,${options.subtitleStyle.backdropOpacity ?? 0.5})`
                        : undefined,
                      padding: options.subtitleStyle.backdropEnabled ? '2px 8px' : undefined,
                      borderRadius: options.subtitleStyle.backdropEnabled ? '4px' : undefined,
                      fontWeight: 600,
                      letterSpacing: '0.02em',
                    }}
                  >
                    字幕样式预览 Subtitle Preview
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Right: scrollable controls */}
          <div className="w-1/2 overflow-y-auto space-y-4 custom-scrollbar pb-8">

          <PackagingBanner provenance={provenance} isCustomized={isCustomized} onApplyReference={handleApplyReference} />

          {/* BGM Section */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <button
              onClick={() => setBgmExpanded(!bgmExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Music size={14} className="text-zinc-500" />
                🎵 背景音乐
              </span>
              {bgmExpanded ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
            </button>
            {bgmExpanded && (
              <div className="px-4 pb-4 space-y-3">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.wav,.aac,.m4a,.ogg"
                  onChange={handleBgmUpload}
                  className="hidden"
                />
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadingBgm}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 hover:text-white transition-colors disabled:opacity-50"
                  >
                    {uploadingBgm ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
                    上传BGM
                  </button>
                  <button
                    onClick={openLibrary}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 hover:text-white transition-colors"
                  >
                    <Library size={14} />
                    从库中选择
                  </button>
                  <button
                    onClick={() => openPixabayBrowser(referenceBgmMood ?? undefined)}
                    className="inline-flex items-center gap-2 px-3 py-2 text-sm font-medium text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 hover:text-white transition-colors"
                  >
                    <Globe size={14} />
                    浏览 Pixabay
                  </button>
                  {bgmFilename && (
                    <>
                      <span className="text-sm text-zinc-400">当前: {bgmFilename}</span>
                      <button
                        onClick={handleBgmDelete}
                        disabled={deletingBgm}
                        className="inline-flex items-center gap-1 px-2 py-1 text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      >
                        {deletingBgm ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                        删除
                      </button>
                    </>
                  )}
                </div>
                {/* BGM Audio Player */}
                {bgmFilename && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-zinc-800/60 border border-zinc-700/50">
                    <audio
                      ref={audioRef}
                      preload="none"
                      onPlay={() => setBgmPlaying(true)}
                      onPause={() => setBgmPlaying(false)}
                      onEnded={() => { setBgmPlaying(false); setBgmCurrentTime(0); }}
                      onTimeUpdate={() => setBgmCurrentTime(audioRef.current?.currentTime ?? 0)}
                      onLoadedMetadata={() => setBgmDuration(audioRef.current?.duration ?? 0)}
                    />
                    <button
                      onClick={toggleBgmPlay}
                      className="shrink-0 p-1.5 rounded-md text-zinc-300 hover:bg-zinc-700 transition-colors"
                      title={bgmPlaying ? '暂停' : '试听'}
                    >
                      {bgmPlaying ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <input
                      type="range"
                      min="0"
                      max={bgmDuration || 1}
                      step="0.1"
                      value={bgmCurrentTime}
                      onChange={(e) => {
                        const t = parseFloat(e.target.value);
                        if (audioRef.current) audioRef.current.currentTime = t;
                        setBgmCurrentTime(t);
                      }}
                      className="flex-1 accent-indigo-500 h-1"
                    />
                    <span className="text-[10px] font-mono text-zinc-500 shrink-0 w-16 text-right">
                      {formatTime(bgmCurrentTime)}/{formatTime(bgmDuration)}
                    </span>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-xs text-zinc-500">
                    <span>音量</span>
                    <span className="font-mono">{Math.round(options.bgmVolume * 100)}%</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={options.bgmVolume}
                    onChange={(e) => setOptions(prev => ({ ...prev, bgmVolume: parseFloat(e.target.value) }))}
                    className="w-full accent-indigo-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="flex items-center justify-between text-xs text-zinc-500">
                      <span>淡入</span>
                      <span className="font-mono">{options.bgmFadeIn.toFixed(1)}s</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="5"
                      step="0.5"
                      value={options.bgmFadeIn}
                      onChange={(e) => setOptions(prev => ({ ...prev, bgmFadeIn: parseFloat(e.target.value) }))}
                      className="w-full accent-indigo-500"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="flex items-center justify-between text-xs text-zinc-500">
                      <span>淡出</span>
                      <span className="font-mono">{options.bgmFadeOut.toFixed(1)}s</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="5"
                      step="0.5"
                      value={options.bgmFadeOut}
                      onChange={(e) => setOptions(prev => ({ ...prev, bgmFadeOut: parseFloat(e.target.value) }))}
                      className="w-full accent-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Subtitle Style Section */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <button
              onClick={() => setSubtitleExpanded(!subtitleExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Type size={14} className="text-zinc-500" />
                🔤 字幕样式
              </span>
              {subtitleExpanded ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
            </button>
            {subtitleExpanded && (
              <div className="px-4 pb-4 space-y-4">
                {/* Preset buttons */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                  {(Object.keys(SUBTITLE_PRESET_LABELS) as SubtitlePreset[]).map(preset => (
                    <button
                      key={preset}
                      onClick={() => applyPreset(preset)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border transition-colors ${
                        options.subtitlePreset === preset
                          ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-300'
                      }`}
                    >
                      {SUBTITLE_PRESET_LABELS[preset]}
                    </button>
                  ))}
                </div>

                {/* Custom style controls (always editable — editing auto-switches to custom preset) */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500">字体大小</label>
                    <input
                      type="number"
                      min="12"
                      max="72"
                      value={options.subtitleStyle.fontSize}
                      onChange={(e) => updateSubtitleStyleCustom({ fontSize: parseInt(e.target.value) || 24 })}
                      className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500">字体颜色</label>
                    <input
                      type="color"
                      value={options.subtitleStyle.primaryColor}
                      onChange={(e) => updateSubtitleStyleCustom({ primaryColor: e.target.value })}
                      className="w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg cursor-pointer"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500">边框宽度</label>
                    <input
                      type="number"
                      min="0"
                      max="10"
                      value={options.subtitleStyle.outlineWidth}
                      onChange={(e) => updateSubtitleStyleCustom({ outlineWidth: parseInt(e.target.value) || 0 })}
                      className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-zinc-500">边框颜色</label>
                    <input
                      type="color"
                      value={options.subtitleStyle.outlineColor ?? '#000000'}
                      onChange={(e) => updateSubtitleStyleCustom({ outlineColor: e.target.value })}
                      className="w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg cursor-pointer"
                    />
                  </div>
                </div>

                {/* Backdrop toggle */}
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={options.subtitleStyle.backdropEnabled}
                      onChange={(e) => updateSubtitleStyleCustom({ backdropEnabled: e.target.checked })}
                      className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
                    />
                    启用背景框
                  </label>
                  {options.subtitleStyle.backdropEnabled && (
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-zinc-500">透明度</label>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.1"
                        value={options.subtitleStyle.backdropOpacity ?? 0.5}
                        onChange={(e) => updateSubtitleStyleCustom({ backdropOpacity: parseFloat(e.target.value) })}
                        className="w-24 accent-indigo-500"
                      />
                      <span className="text-xs text-zinc-400 font-mono">{Math.round((options.subtitleStyle.backdropOpacity ?? 0.5) * 100)}%</span>
                    </div>
                  )}
                </div>

                {/* Shadow toggle */}
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={options.subtitleStyle.shadowEnabled}
                    onChange={(e) => updateSubtitleStyleCustom({ shadowEnabled: e.target.checked })}
                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
                  />
                  启用阴影
                </label>

                {/* Margin (vertical offset from bottom) */}
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-xs text-zinc-500">
                    <span>底部边距</span>
                    <span className="font-mono">{options.subtitleStyle.marginV}px</span>
                  </label>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="5"
                    value={options.subtitleStyle.marginV}
                    onChange={(e) => updateSubtitleStyleCustom({ marginV: parseInt(e.target.value) })}
                    className="w-full accent-indigo-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Fade In/Out Section */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <button
              onClick={() => setFadeExpanded(!fadeExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Sliders size={14} className="text-zinc-500" />
                🎬 淡入/淡出
              </span>
              {fadeExpanded ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
            </button>
            {fadeExpanded && (
              <div className="px-4 pb-4 space-y-3">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="flex items-center justify-between text-xs text-zinc-500">
                      <span>淡入时长</span>
                      <span className="font-mono">{options.fadeInDuration.toFixed(1)}s</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="0.1"
                      value={options.fadeInDuration}
                      onChange={(e) => setOptions(prev => ({ ...prev, fadeInDuration: parseFloat(e.target.value) }))}
                      className="w-full accent-indigo-500"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="flex items-center justify-between text-xs text-zinc-500">
                      <span>淡出时长</span>
                      <span className="font-mono">{options.fadeOutDuration.toFixed(1)}s</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="3"
                      step="0.1"
                      value={options.fadeOutDuration}
                      onChange={(e) => setOptions(prev => ({ ...prev, fadeOutDuration: parseFloat(e.target.value) }))}
                      className="w-full accent-indigo-500"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Title Card Section */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <button
              onClick={() => setTitleExpanded(!titleExpanded)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Type size={14} className="text-zinc-500" />
                📺 标题卡片
              </span>
              {titleExpanded ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
            </button>
            {titleExpanded && (
              <div className="px-4 pb-4 space-y-3">
                <label className="flex items-center gap-2 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={!!options.titleCard}
                    onChange={(e) => {
                      if (e.target.checked) {
                        updateTitleCard({ text: current.title ?? '', duration: 3, fontSize: 64, fontColor: '#ffffff' });
                      } else {
                        updateTitleCard(null);
                      }
                    }}
                    className="w-4 h-4 rounded border-zinc-600 bg-zinc-800 text-indigo-500 focus:ring-indigo-500"
                  />
                  启用标题卡片
                </label>

                {options.titleCard && (
                  <div className="space-y-3 pl-6">
                    <div className="space-y-1">
                      <label className="text-xs text-zinc-500">标题文字</label>
                      <input
                        type="text"
                        value={options.titleCard.text}
                        onChange={(e) => updateTitleCard({ text: e.target.value })}
                        className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
                      />
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="space-y-1">
                        <label className="flex items-center justify-between text-xs text-zinc-500">
                          <span>显示时长</span>
                          <span className="font-mono">{options.titleCard.duration}s</span>
                        </label>
                        <input
                          type="range"
                          min="1"
                          max="10"
                          step="0.5"
                          value={options.titleCard.duration}
                          onChange={(e) => updateTitleCard({ duration: parseFloat(e.target.value) })}
                          className="w-full accent-indigo-500"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-500">字体大小</label>
                        <input
                          type="number"
                          min="24"
                          max="128"
                          value={options.titleCard.fontSize}
                          onChange={(e) => updateTitleCard({ fontSize: parseInt(e.target.value) || 64 })}
                          className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-zinc-500">字体颜色</label>
                        <input
                          type="color"
                          value={options.titleCard.fontColor}
                          onChange={(e) => updateTitleCard({ fontColor: e.target.value })}
                          className="w-full h-10 bg-zinc-800 border border-zinc-700 rounded-lg cursor-pointer"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Advanced Settings (collapsible) */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 overflow-hidden">
            <button
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="w-full flex items-center justify-between px-4 py-3 text-sm font-semibold text-zinc-300 hover:bg-zinc-800/50 transition-colors"
            >
              <span className="flex items-center gap-2">
                <Settings2 size={14} className="text-zinc-500" />
                ⚙️ 高级设置
              </span>
              {showAdvanced ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
            </button>
            {showAdvanced && (
              <div className="px-4 pb-4 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  {/* Quality Preset */}
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-500">画质预设</label>
                    <select
                      value={options.qualityPreset}
                      onChange={(e) => setOptions(prev => ({ ...prev, qualityPreset: e.target.value as QualityPreset }))}
                      className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
                    >
                      {(Object.keys(QUALITY_LABELS) as QualityPreset[]).map(q => (
                        <option key={q} value={q}>{QUALITY_LABELS[q]}</option>
                      ))}
                    </select>
                  </div>

                  {/* Speed Preset */}
                  <div className="space-y-2">
                    <label className="text-xs text-zinc-500">编码速度</label>
                    <select
                      value={options.speedPreset}
                      onChange={(e) => setOptions(prev => ({ ...prev, speedPreset: e.target.value as SpeedPreset }))}
                      className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-300"
                    >
                      {(Object.keys(SPEED_LABELS) as SpeedPreset[]).map(s => (
                        <option key={s} value={s}>{SPEED_LABELS[s]}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Transition Duration */}
                <div className="space-y-2">
                  <label className="flex items-center justify-between text-xs text-zinc-500">
                    <span>默认转场时长</span>
                    <span className="font-mono">{options.transitionDuration.toFixed(1)}s</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={options.transitionDuration}
                    onChange={(e) => setOptions(prev => ({ ...prev, transitionDuration: parseFloat(e.target.value) }))}
                    className="w-full accent-indigo-500"
                  />
                </div>

                {/* Reset button */}
                <button
                  onClick={() => setConfirmReset(true)}
                  className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors underline"
                >
                  重置为默认值
                </button>
              </div>
            )}
          </div>

          {/* Info about re-assembly time */}
          <div className="text-xs text-zinc-500 text-center py-2">
            💡 应用更改需要重新组装视频，预计耗时 1-3 分钟
          </div>
          </div>{/* end right panel */}
        </div>{/* end flex split */}
      </StageReviewShell>

      <FloatingActionBar
        hint={
          isRunning ? '正在重新组装视频，请稍候…'
          : '调整参数后点击“应用更改”重新组装视频，预计 1-3 分钟'
        }
        actions={fabActions} />

      <ConfirmModal
        isOpen={confirmReset}
        title="重置设置"
        description="确定要将所有精修设置重置为默认值吗？"
        confirmLabel="确认重置"
        variant="warning"
        onConfirm={handleReset}
        onCancel={() => setConfirmReset(false)}
      />

      {/* BGM Library Panel Overlay */}
      {libraryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                <Library size={16} /> BGM 音乐库
              </h3>
              <div className="flex items-center gap-2">
                <input
                  ref={libraryFileInputRef}
                  type="file"
                  accept=".mp3,.wav,.aac,.m4a,.ogg"
                  onChange={handleLibraryUpload}
                  className="hidden"
                />
                <button
                  onClick={() => libraryFileInputRef.current?.click()}
                  disabled={libraryUploading}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-800 border border-zinc-700 rounded-lg hover:bg-zinc-700 transition-colors disabled:opacity-50"
                >
                  {libraryUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  导入到库
                </button>
                <button
                  onClick={() => {
                    setLibraryOpen(false);
                    if (libraryAudioRef.current) { libraryAudioRef.current.pause(); libraryAudioRef.current.src = ''; }
                    setLibraryPreviewFile(null);
                  }}
                  className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg hover:bg-zinc-800 transition-colors"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Reference mood hint */}
            {referenceBgmMood && (
              <div className="flex items-center gap-2 px-5 py-2 border-b border-zinc-800 bg-amber-900/20">
                <Sparkles size={12} className="text-amber-400 shrink-0" />
                <span className="text-xs text-amber-300">
                  参考视频 BGM 风格：<span className="font-medium text-amber-200">{referenceBgmMood}</span>
                </span>
              </div>
            )}

            {/* Mood filter tags */}
            {(() => {
              const moods = [...new Set(libraryItems.map(i => i.mood))].sort();
              if (moods.length <= 1) return null;
              return (
                <div className="flex items-center gap-2 px-5 py-2.5 border-b border-zinc-800 overflow-x-auto">
                  <button
                    onClick={() => setLibraryMoodFilter(null)}
                    className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                      libraryMoodFilter === null
                        ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
                    }`}
                  >
                    全部
                  </button>
                  {moods.map(mood => (
                    <button
                      key={mood}
                      onClick={() => setLibraryMoodFilter(mood === libraryMoodFilter ? null : mood)}
                      className={`shrink-0 px-2.5 py-1 text-xs font-medium rounded-full border transition-colors ${
                        libraryMoodFilter === mood
                          ? 'bg-indigo-500/20 border-indigo-500/50 text-indigo-300'
                          : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'
                      }`}
                    >
                      {mood}
                    </button>
                  ))}
                </div>
              );
            })()}

            {/* Hidden audio for library preview */}
            <audio ref={libraryAudioRef} preload="none" onEnded={() => setLibraryPreviewFile(null)} />

            {/* List */}
            <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
              {libraryLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 size={20} className="animate-spin text-zinc-500" />
                </div>
              ) : libraryItems.length === 0 ? (
                <div className="text-center py-8 space-y-2">
                  <p className="text-sm text-zinc-400">音乐库为空</p>
                  <p className="text-xs text-zinc-500">
                    文件名格式：<code className="px-1 py-0.5 bg-zinc-800 rounded text-zinc-400">mood--title.mp3</code>
                  </p>
                  <p className="text-xs text-zinc-600">
                    推荐从{' '}
                    <a href="https://pixabay.com/music/" target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:underline">
                      Pixabay Music
                    </a>{' '}
                    下载免费商用音乐，重命名后上传到库
                  </p>
                </div>
              ) : (
                (libraryMoodFilter ? libraryItems.filter(i => i.mood === libraryMoodFilter) : libraryItems).map(item => (
                  <div
                    key={item.filename}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors ${
                      libraryPreviewFile === item.filename
                        ? 'bg-indigo-500/10 border-indigo-500/30'
                        : 'bg-zinc-800/40 border-zinc-800 hover:bg-zinc-800/70'
                    }`}
                  >
                    <button
                      onClick={() => handleLibraryPreview(item.filename)}
                      className="shrink-0 p-1.5 rounded-md text-zinc-300 hover:bg-zinc-700 transition-colors"
                      title="试听"
                    >
                      {libraryPreviewFile === item.filename ? <Pause size={14} /> : <Play size={14} />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-zinc-200 truncate">{item.title}</div>
                      <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700">{item.mood}</span>
                        {item.duration != null && <span>{formatTime(item.duration)}</span>}
                        <span>{(item.size / 1024 / 1024).toFixed(1)} MB</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleLibraryImport(item.filename)}
                      disabled={libraryImporting === item.filename}
                      className="shrink-0 px-2.5 py-1.5 text-xs font-medium text-indigo-300 bg-indigo-500/10 border border-indigo-500/30 rounded-lg hover:bg-indigo-500/20 transition-colors disabled:opacity-50"
                    >
                      {libraryImporting === item.filename ? <Loader2 size={12} className="animate-spin" /> : '选用'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Pixabay download confirmation toast */}
      {downloadConfirm && (
        <DownloadConfirmToast
          originalName={downloadConfirm.originalName}
          onAccept={() => {
            if (current?.id) importBgmFromLibrary(current.id, downloadConfirm.filename);
            setDownloadConfirm(null);
          }}
          onDismiss={() => setDownloadConfirm(null)}
        />
      )}
    </div>
  );
}
