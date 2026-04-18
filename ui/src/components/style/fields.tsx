import { Plus, Trash2 } from 'lucide-react';

const INPUT_CLS = 'w-full px-2.5 py-1.5 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 focus:outline-none focus:ring-1 focus:ring-indigo-500/50';

export { INPUT_CLS };

export function TextField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className={INPUT_CLS} />;
}

export function NumberField({ value, onChange, step }: { value: number; onChange: (v: number) => void; step?: number }) {
  return <input type="number" value={value} step={step} onChange={(e) => onChange(Number(e.target.value))} className={`${INPUT_CLS} w-32`} />;
}

export function SliderField({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <input type="range" min={0} max={1} step={0.01} value={value} onChange={(e) => onChange(Number(e.target.value))}
        className="flex-1 accent-indigo-500 h-1.5" />
      <span className="text-xs text-zinc-400 w-10 text-right tabular-nums">{(value * 100).toFixed(0)}%</span>
    </div>
  );
}

export function ColorPaletteField({ colors, onChange }: { colors: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {colors.map((c, i) => (
        <div key={i} className="group flex items-center gap-1">
          <input type="color" value={c} onChange={(e) => { const next = [...colors]; next[i] = e.target.value; onChange(next); }}
            className="w-7 h-7 rounded-full border border-zinc-700 cursor-pointer bg-transparent p-0" />
          <span className="text-[10px] text-zinc-500 font-mono">{c}</span>
          <button onClick={() => onChange(colors.filter((_, j) => j !== i))}
            className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-red-400 transition-opacity">
            <Trash2 size={10} />
          </button>
        </div>
      ))}
      <button onClick={() => onChange([...colors, '#808080'])}
        className="w-7 h-7 rounded-full border border-dashed border-zinc-600 flex items-center justify-center text-zinc-600 hover:text-zinc-400 hover:border-zinc-400 transition-colors">
        <Plus size={12} />
      </button>
    </div>
  );
}

export function StringListField({ items, onChange }: { items: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="space-y-1.5">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-2">
          <span className="text-[10px] text-zinc-600 w-4 text-right">{i + 1}.</span>
          <input type="text" value={item} onChange={(e) => { const next = [...items]; next[i] = e.target.value; onChange(next); }}
            className={`${INPUT_CLS} flex-1`} />
          <button onClick={() => onChange(items.filter((_, j) => j !== i))}
            className="text-zinc-600 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
        </div>
      ))}
      <button onClick={() => onChange([...items, ''])}
        className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors">
        <Plus size={12} /> 添加
      </button>
    </div>
  );
}

export function ObjectField({ value, onChange }: { value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void }) {
  return (
    <textarea
      rows={4}
      value={JSON.stringify(value, null, 2)}
      onChange={(e) => { try { onChange(JSON.parse(e.target.value)); } catch { /* ignore invalid json */ } }}
      className={`${INPUT_CLS} font-mono text-xs resize-y`}
    />
  );
}
