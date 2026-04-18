function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as any)?.[k], obj);
}

function MetricCell({ label, value }: { label: string; value: string | number | undefined }) {
  if (value == null || value === '') return null;
  return (
    <div className="px-3 py-2 rounded-lg bg-zinc-800/50">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">{label}</div>
      <div className="text-sm text-zinc-200 font-medium truncate">{String(value)}</div>
    </div>
  );
}

function PaletteCell({ label, colors }: { label: string; colors: string[] }) {
  if (!colors.length) return null;
  return (
    <div className="px-3 py-2 rounded-lg bg-zinc-800/50">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="flex gap-1">
        {colors.slice(0, 8).map((c, i) => (
          <span key={i} className="w-5 h-5 rounded-md border border-zinc-700" style={{ backgroundColor: c }} title={c} />
        ))}
      </div>
    </div>
  );
}

export function StyleSummaryCard({ profile }: { profile: Record<string, unknown> }) {
  const palette = (get(profile, 'colorPalette') as string[] | undefined) ?? [];
  const narrativeStructure = (get(profile, 'narrativeStructure') as string[] | undefined) ?? [];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 space-y-3">
      <h4 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">风格概览</h4>

      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
        <MetricCell label="视觉风格" value={get(profile, 'visualStyle') as string} />
        <MetricCell label="节奏" value={get(profile, 'pacing') as string} />
        <MetricCell label="基调" value={get(profile, 'tone') as string} />
        <MetricCell label="Hook 类型" value={get(profile, 'hookType') as string} />
        <MetricCell label="情绪强度" value={get(profile, 'emotionalIntensity') as number} />
        <MetricCell label="字数" value={get(profile, 'wordCount') as number} />
        <MetricCell label="语速 (wpm)" value={get(profile, 'wordsPerMinute') as number} />
        <MetricCell label="平均句长" value={get(profile, 'track_a_script.sentence_length_avg') as number} />
        <MetricCell label="场景时长(s)" value={get(profile, 'track_b_visual.scene_avg_duration_sec') as number} />
        <MetricCell label="BGM 风格" value={get(profile, 'track_c_audio.bgm_genre') as string} />
        <MetricCell label="语音风格" value={get(profile, 'track_c_audio.voice_style') as string} />
        <PaletteCell label="色板" colors={palette} />
      </div>

      {narrativeStructure.length > 0 && (
        <div className="px-3 py-2 rounded-lg bg-zinc-800/50">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-1">叙事结构</div>
          <div className="flex flex-wrap gap-1">
            {narrativeStructure.map((s, i) => (
              <span key={i} className="px-2 py-0.5 text-xs text-zinc-300 bg-zinc-700/50 rounded">{s}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
