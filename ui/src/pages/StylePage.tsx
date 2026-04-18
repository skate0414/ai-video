import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Play, Square, ClipboardPaste, Save, ArrowRight, Edit3, ShieldCheck, AlertTriangle } from 'lucide-react';
import { useProject } from '../context/ProjectContext';
import { api } from '../api/client';
import { logger } from '../lib/logger';
import { FloatingActionBar } from '../components/FloatingActionBar';
import { StageReviewShell, deriveActiveStage } from '../components/StageReviewShell';
import { StyleSummaryCard } from '../components/style/StyleSummaryCard';
import { TrackPanel } from '../components/style/TrackPanel';
import { FieldRow } from '../components/style/FieldRow';
import { TextField, NumberField, SliderField, ColorPaletteField, StringListField, ObjectField, INPUT_CLS } from '../components/style/fields';

const STYLE_STAGES = ['CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION'] as const;

/* ================================================================== */
/*  Helpers                                                           */
/* ================================================================== */

function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as any)?.[k], obj);
}

function set(obj: Record<string, unknown>, path: string, value: unknown): Record<string, unknown> {
  const clone = structuredClone(obj);
  const keys = path.split('.');
  let cur: any = clone;
  for (let i = 0; i < keys.length - 1; i++) {
    if (cur[keys[i]] == null) cur[keys[i]] = {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return clone;
}

/* ================================================================== */
/*  StyleProfileView                                                  */
/* ================================================================== */

function StyleProfileView({ profile, onSave }: {
  profile: Record<string, unknown>;
  onSave: (edited: Record<string, unknown>) => Promise<void>;
}) {
  type ConfidenceLevel = 'confident' | 'inferred' | 'guess' | 'computed';
  const [edited, setEdited] = useState<Record<string, unknown>>(profile);
  const [saving, setSaving] = useState(false);

  useEffect(() => { setEdited(profile); }, [profile]);

  const hasChanges = useMemo(
    () => JSON.stringify(edited) !== JSON.stringify(profile),
    [edited, profile],
  );

  const confidenceMap = useMemo(
    () => ((profile.nodeConfidence ?? edited.nodeConfidence ?? {}) as Record<string, ConfidenceLevel>),
    [profile, edited],
  );

  const confidenceAliases: Record<string, string[]> = {
    'hookType': ['hookStrategy'],
    'narrativeStructure': ['narrativeArc'],
    'callToActionType': ['ctaPattern'],
    'track_a_script.hook_strategy': ['hookStrategy'],
    'track_a_script.narrative_arc': ['narrativeArc'],
    'track_a_script.sentence_length_avg': ['sentenceLengthAvg'],
    'track_a_script.sentence_length_max': ['sentenceLengthMax'],
    'track_a_script.metaphor_count': ['metaphorCount'],
    'track_a_script.cta_pattern': ['ctaPattern'],
    'track_a_script.rhetorical_core': ['rhetoricalCore'],
  };

  const confidenceForPath = (path: string): ConfidenceLevel | undefined => {
    const direct = confidenceMap[path];
    if (direct) return direct;
    const aliases = confidenceAliases[path] ?? [];
    for (const alias of aliases) {
      if (confidenceMap[alias]) return confidenceMap[alias];
    }
    return undefined;
  };

  const v = (path: string) => get(edited, path);
  const s = (path: string, val: unknown) => setEdited(prev => set(prev, path, val));

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(edited); } finally { setSaving(false); }
  };

  /* ---- Track field renderer ---- */
  function renderTrackFields(prefix: string, fields: Array<{ key: string; label: string; type?: 'text' | 'number' | 'list' | 'object' }>) {
    const track = v(prefix) as Record<string, unknown> | undefined;
    if (!track) return <p className="text-xs text-zinc-600 italic">暂无数据</p>;

    return (
      <div className="space-y-1">
        {fields.map(({ key, label, type }) => {
          const fullPath = `${prefix}.${key}`;
          const val = v(fullPath);
          if (val === undefined && type !== 'text') return null;
          return (
            <FieldRow key={key} label={label} confidence={confidenceForPath(fullPath)}>
              {type === 'number' ? (
                <NumberField value={(val as number) ?? 0} onChange={(n) => s(fullPath, n)} step={0.1} />
              ) : type === 'list' ? (
                <StringListField items={(val as string[]) ?? []} onChange={(a) => s(fullPath, a)} />
              ) : type === 'object' ? (
                <ObjectField value={(val as Record<string, unknown>) ?? {}} onChange={(o) => s(fullPath, o)} />
              ) : (
                <TextField value={String(val ?? '')} onChange={(t) => s(fullPath, t)} />
              )}
            </FieldRow>
          );
        })}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ---- Core Summary (always expanded) ---- */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-2">
        <h4 className="text-sm font-bold text-white mb-3">📋 核心摘要</h4>

        <FieldRow label="视觉风格" confidence={confidenceForPath('visualStyle')}>
          <TextField value={String(v('visualStyle') ?? '')} onChange={(t) => s('visualStyle', t)} />
        </FieldRow>
        <FieldRow label="节奏" confidence={confidenceForPath('pacing')}>
          <TextField value={String(v('pacing') ?? '')} onChange={(t) => s('pacing', t)} />
        </FieldRow>
        <FieldRow label="基调" confidence={confidenceForPath('tone')}>
          <TextField value={String(v('tone') ?? '')} onChange={(t) => s('tone', t)} />
        </FieldRow>
        <FieldRow label="色板" confidence={confidenceForPath('colorPalette')}>
          <ColorPaletteField colors={(v('colorPalette') as string[]) ?? []} onChange={(c) => s('colorPalette', c)} />
        </FieldRow>
        <FieldRow label="叙事结构" confidence={confidenceForPath('narrativeStructure')}>
          <StringListField items={(v('narrativeStructure') as string[]) ?? []} onChange={(a) => s('narrativeStructure', a)} />
        </FieldRow>
        <FieldRow label="情绪强度" confidence={confidenceForPath('emotionalIntensity')}>
          <SliderField value={Number(v('emotionalIntensity') ?? 0)} onChange={(n) => s('emotionalIntensity', n)} />
        </FieldRow>
        <FieldRow label="Hook 类型" confidence={confidenceForPath('hookType')}>
          <TextField value={String(v('hookType') ?? '')} onChange={(t) => s('hookType', t)} />
        </FieldRow>
        <FieldRow label="CTA 类型" confidence={confidenceForPath('callToActionType')}>
          <TextField value={String(v('callToActionType') ?? '')} onChange={(t) => s('callToActionType', t)} />
        </FieldRow>
        <div className="grid grid-cols-2 gap-4">
          <FieldRow label="字数" confidence={confidenceForPath('wordCount')}>
            <NumberField value={Number(v('wordCount') ?? 0)} onChange={(n) => s('wordCount', n)} />
          </FieldRow>
          <FieldRow label="语速 (wpm)" confidence={confidenceForPath('wordsPerMinute')}>
            <NumberField value={Number(v('wordsPerMinute') ?? 0)} onChange={(n) => s('wordsPerMinute', n)} />
          </FieldRow>
        </div>
      </div>

      {/* ---- Track A: Script Style ---- */}
      <TrackPanel title="Track A — 脚本风格" icon="📝">
        {renderTrackFields('track_a_script', [
          { key: 'hook_strategy', label: 'Hook 策略' },
          { key: 'hook_example', label: 'Hook 示例' },
          { key: 'narrative_arc', label: '叙事弧线', type: 'list' },
          { key: 'emotional_tone_arc', label: '情绪弧线' },
          { key: 'rhetorical_core', label: '修辞核心' },
          { key: 'sentence_length_avg', label: '平均句长', type: 'number' },
          { key: 'sentence_length_max', label: '最大句长', type: 'number' },
          { key: 'sentence_length_unit', label: '句长单位' },
          { key: 'interaction_cues_count', label: '互动提示数', type: 'number' },
          { key: 'cta_pattern', label: 'CTA 模式' },
          { key: 'metaphor_count', label: '隐喻数量', type: 'number' },
          { key: 'jargon_treatment', label: '术语处理' },
        ])}
      </TrackPanel>

      {/* ---- Track B: Visual Style ---- */}
      <TrackPanel title="Track B — 视觉风格" icon="🎬">
        {renderTrackFields('track_b_visual', [
          { key: 'base_medium', label: '基础媒介' },
          { key: 'lighting_style', label: '光照风格' },
          { key: 'camera_motion', label: '镜头运动' },
          { key: 'color_temperature', label: '色温' },
          { key: 'scene_avg_duration_sec', label: '场景平均时长(s)', type: 'number' },
          { key: 'transition_style', label: '转场风格' },
          { key: 'visual_metaphor_mapping', label: '视觉隐喻映射', type: 'object' },
          { key: 'b_roll_ratio', label: 'B-Roll 比例', type: 'number' },
          { key: 'composition_style', label: '构图风格' },
        ])}
      </TrackPanel>

      {/* ---- Track C: Audio Style ---- */}
      <TrackPanel title="Track C — 音频风格" icon="🎵">
        {renderTrackFields('track_c_audio', [
          { key: 'bgm_genre', label: 'BGM 风格' },
          { key: 'bgm_mood', label: 'BGM 情绪' },
          { key: 'bgm_tempo', label: 'BGM 节奏' },
          { key: 'bgm_relative_volume', label: 'BGM 相对音量', type: 'number' },
          { key: 'voice_style', label: '语音风格' },
          { key: 'audio_visual_sync_points', label: '音画同步点', type: 'list' },
        ])}
      </TrackPanel>

      {/* ---- Metadata ---- */}
      {(v('meta') != null || v('profileVersion') != null || v('styleFingerprint') != null) && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 px-2 text-[11px] text-zinc-600">
          {v('meta.video_language') != null ? <span>语言: {String(v('meta.video_language'))}</span> : null}
          {v('meta.video_duration_sec') != null ? <span>时长: {String(v('meta.video_duration_sec'))}s</span> : null}
          {v('meta.video_type') != null ? <span>类型: {String(v('meta.video_type'))}</span> : null}
          {v('profileVersion') != null ? <span>版本: {String(v('profileVersion'))}</span> : null}
          {v('styleFingerprint') != null ? <span>指纹: {String(v('styleFingerprint'))}</span> : null}
        </div>
      )}

      {/* ---- Save button ---- */}
      {hasChanges && (
        <button onClick={handleSave} disabled={saving}
          className="inline-flex items-center gap-1.5 px-5 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg transition-colors">
          <Save size={14} /> {saving ? '保存中…' : '保存风格修改'}
        </button>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Log Summary (during analysis)                                     */
/* ================================================================== */

function AnalysisLogSummary({ logs }: { logs: Array<{ stage?: string; message: string; timestamp: string; type: string }> }) {
  const relevantLogs = useMemo(() =>
    logs
      .filter((l) => l.stage === 'CAPABILITY_ASSESSMENT' || l.stage === 'STYLE_EXTRACTION')
      .slice(-5),
    [logs],
  );

  if (relevantLogs.length === 0) return null;

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 space-y-1.5">
      <h4 className="text-xs font-semibold text-zinc-400 mb-2">📋 分析日志</h4>
      {relevantLogs.map((l, i) => (
        <div key={i} className="flex items-start gap-2 text-xs">
          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full shrink-0 ${
            l.type === 'error' ? 'bg-red-500' : l.type === 'success' ? 'bg-emerald-500' : l.type === 'warning' ? 'bg-amber-500' : 'bg-zinc-600'
          }`} />
          <span className="text-zinc-500 shrink-0">{new Date(l.timestamp).toLocaleTimeString()}</span>
          <span className="text-zinc-300 break-all">{l.message}</span>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/*  Capability Assessment Result Banner                               */
/* ================================================================== */

function CapabilityAssessmentBanner({ projectId, visible }: { projectId: string; visible: boolean }) {
  const [assessment, setAssessment] = useState<{
    safe?: boolean;
    category?: string;
    flags?: string[];
    summary?: string;
    confidence?: number;
  } | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (!visible || loaded.current) return;
    loaded.current = true;
    api.loadArtifact<any>(projectId, 'capability-assessment.json')
      .then((data) => setAssessment(data))
      .catch(() => {});
  }, [projectId, visible]);

  if (!assessment) return null;

  const hasFlagIssues = assessment.flags && assessment.flags.length > 0;
  const isSafe = assessment.safe !== false && !hasFlagIssues;

  return (
    <div className={`rounded-xl p-4 border ${
      isSafe
        ? 'border-emerald-500/20 bg-emerald-500/5'
        : 'border-amber-500/20 bg-amber-500/5'
    }`}>
      <div className="flex items-start gap-3">
        <div className={`flex items-center justify-center w-8 h-8 rounded-lg shrink-0 ${
          isSafe ? 'bg-emerald-500/10' : 'bg-amber-500/10'
        }`}>
          {isSafe ? <ShieldCheck size={16} className="text-emerald-400" /> : <AlertTriangle size={16} className="text-amber-400" />}
        </div>
        <div className="space-y-1 min-w-0">
          <h4 className={`text-sm font-semibold ${isSafe ? 'text-emerald-300' : 'text-amber-300'}`}>
            {isSafe ? '✅ 安全检查通过' : '⚠️ 安全检查有标记'}
          </h4>
          {assessment.category && (
            <p className="text-[11px] text-zinc-400">分类: <span className="text-zinc-300">{assessment.category}</span></p>
          )}
          {assessment.summary && (
            <p className="text-[11px] text-zinc-400 leading-relaxed">{assessment.summary}</p>
          )}
          {assessment.confidence != null && (
            <p className="text-[10px] text-zinc-500">置信度: {(assessment.confidence * 100).toFixed(0)}%</p>
          )}
          {hasFlagIssues && (
            <div className="mt-2 space-y-1">
              {assessment.flags!.map((flag, i) => (
                <div key={i} className="flex items-start gap-1.5 px-2.5 py-1.5 rounded-lg bg-amber-500/5 border border-amber-500/10">
                  <span className="text-amber-400 text-xs mt-0.5">⚠️</span>
                  <span className="text-[11px] text-amber-300/90 leading-relaxed">{flag}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  StylePage                                                         */
/* ================================================================== */

export function StylePage() {
  const { current, startPipeline, stopPipeline, setStyleProfile, logs } = useProject();
  const navigate = useNavigate();
  const [pastedAnalysis, setPastedAnalysis] = useState('');
  const [showManualPaste, setShowManualPaste] = useState(false);
  const [starting, setStarting] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const [editMode, setEditMode] = useState(false);

  if (!current) return null;

  const isRunning = Object.values(current.stageStatus ?? {}).some((s) => s === 'processing');
  const styleComplete = STYLE_STAGES.every((s) => (current.stageStatus ?? {} as any)[s] === 'completed');

  const handleStart = async () => {
    setStarting(true);
    logger.info('user', 'start_style_analysis', { projectId: current.id });
    try { await startPipeline(current.id); } finally { setStarting(false); }
  };

  const handleManualAnalysis = async () => {
    if (!pastedAnalysis.trim()) return;
    logger.info('user', 'manual_style_paste', { projectId: current.id, textLength: pastedAnalysis.length });
    await setStyleProfile(current.id, { pastedText: pastedAnalysis, topic: current.topic });
    setPastedAnalysis('');
    setShowManualPaste(false);
  };

  const handleSaveProfile = async (edited: Record<string, unknown>) => {
    logger.info('user', 'save_style_profile', { projectId: current.id });
    await setStyleProfile(current.id, { styleProfile: edited, topic: current.topic });
  };

  const { stageName, stageLabel, status: activeStatus } = deriveActiveStage(STYLE_STAGES, current.stageStatus);

  return (
    <div className="flex flex-col h-full">
      <StageReviewShell
        stageName={stageName}
        stageLabel={stageLabel}
        stageStatus={activeStatus}
      >
        <div className="space-y-4">
          {/* ---- Analysis in progress: log summary ---- */}
          {isRunning && <AnalysisLogSummary logs={logs} />}

          {/* ---- Capability assessment result ---- */}
          <CapabilityAssessmentBanner
            projectId={current.id}
            visible={(current.stageStatus ?? {} as Record<string, string>).CAPABILITY_ASSESSMENT === 'completed'}
          />

          {/* ---- Not started: manual paste option ---- */}
          {!isRunning && !styleComplete && (
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-4">
              <button
                onClick={() => setShowManualPaste(!showManualPaste)}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <ClipboardPaste size={12} /> {showManualPaste ? '收起' : '手动粘贴分析结果'}
              </button>

              {showManualPaste && (
                <div className="space-y-2 pt-2 border-t border-zinc-800">
                  <p className="text-xs text-zinc-500">将参考视频上传到 Gemini 网页版，获取分析结果后粘贴到此处</p>
                  <textarea
                    rows={6}
                    placeholder="粘贴 JSON 或自由文本分析结果..."
                    value={pastedAnalysis}
                    onChange={(e) => setPastedAnalysis(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-500 resize-y focus:outline-none focus:ring-1 focus:ring-indigo-500/50 font-mono"
                  />
                  <button
                    onClick={handleManualAnalysis}
                    disabled={!pastedAnalysis.trim()}
                    className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
                  >
                    📥 应用并跳过自动分析
                  </button>
                </div>
              )}
            </div>
          )}

          {isRunning && (
            <button
              onClick={() => stopPipeline(current.id)}
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg hover:bg-red-500/20 transition-colors"
            >
              <Square size={14} /> 停止
            </button>
          )}

          {/* ---- Style profile: summary (default) or full editor ---- */}
          {styleComplete && current.styleProfile && Object.keys(current.styleProfile).length > 0 && (
            <>
              {!editMode ? (
                <div className="space-y-3">
                  <StyleSummaryCard profile={current.styleProfile} />
                  <button
                    onClick={() => setEditMode(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 border border-zinc-700 rounded-lg transition-colors"
                  >
                    <Edit3 size={12} /> 编辑完整风格
                  </button>
                </div>
              ) : (
                <StyleProfileView profile={current.styleProfile} onSave={handleSaveProfile} />
              )}
            </>
          )}

          {styleComplete && (
            <div className="space-y-3">
              {!showTemplateSave ? (
                <button
                  onClick={() => setShowTemplateSave(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs text-zinc-400 bg-zinc-900/40 border border-dashed border-zinc-600 rounded-lg hover:bg-zinc-800 hover:text-zinc-200 hover:border-zinc-500 transition-all"
                >
                  <Save size={12} /> 保存为风格模板 (跨项目复用)
                </button>
              ) : (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="模板名称"
                    value={templateName}
                    onChange={(e) => setTemplateName(e.target.value)}
                    className="px-3 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:ring-1 focus:ring-indigo-500/50"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && templateName.trim() && !savingTemplate) {
                        setSavingTemplate(true);
                        logger.info('user', 'save_style_template', { name: templateName.trim(), projectId: current.id });
                        api.loadArtifact(current.id, 'format-signature.json').catch(() => undefined)
                          .then((fs) => api.saveStyleTemplate(templateName.trim(), current.topic, current.styleProfile ?? {}, fs as Record<string, unknown> | undefined))
                          .finally(() => { setSavingTemplate(false); setShowTemplateSave(false); setTemplateName(''); });
                      }
                    }}
                  />
                  <button
                    disabled={!templateName.trim() || savingTemplate}
                    onClick={() => {
                      setSavingTemplate(true);
                      logger.info('user', 'save_style_template', { name: templateName.trim(), projectId: current.id });
                      api.loadArtifact(current.id, 'format-signature.json').catch(() => undefined)
                        .then((fs) => api.saveStyleTemplate(templateName.trim(), current.topic, current.styleProfile ?? {}, fs as Record<string, unknown> | undefined))
                        .finally(() => { setSavingTemplate(false); setShowTemplateSave(false); setTemplateName(''); });
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded-lg transition-colors"
                  >
                    {savingTemplate ? '保存中…' : '保存'}
                  </button>
                  <button
                    onClick={() => { setShowTemplateSave(false); setTemplateName(''); }}
                    className="px-2 py-1.5 text-xs text-zinc-500 hover:text-zinc-300"
                  >
                    取消
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </StageReviewShell>

      <FloatingActionBar actions={[
        ...(!isRunning && !styleComplete ? [{
          label: '开始风格分析',
          icon: <Play size={14} />,
          onClick: handleStart,
          loading: starting,
        }] : []),
        ...(styleComplete && editMode ? [{
          label: '返回概览',
          icon: <ArrowRight size={14} />,
          onClick: () => setEditMode(false),
          variant: 'secondary' as const,
        }] : []),
        ...(styleComplete ? [{
          label: '继续到脚本',
          icon: <ArrowRight size={14} />,
          onClick: () => navigate('../script'),
        }] : []),
      ]} />
    </div>
  );
}
