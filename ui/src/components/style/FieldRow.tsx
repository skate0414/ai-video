type ConfidenceLevel = 'confident' | 'inferred' | 'guess' | 'computed';

function confidenceText(level: ConfidenceLevel) {
  if (level === 'guess') return '猜测';
  if (level === 'inferred') return '推断';
  if (level === 'computed') return '计算';
  return '可信';
}

function confidenceClass(level: ConfidenceLevel) {
  if (level === 'guess') return 'border-red-500/30 bg-red-500/10 text-red-300';
  if (level === 'inferred') return 'border-amber-500/30 bg-amber-500/10 text-amber-300';
  if (level === 'computed') return 'border-blue-500/30 bg-blue-500/10 text-blue-300';
  return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300';
}

export function FieldRow({
  label,
  children,
  confidence,
}: {
  label: string;
  children: React.ReactNode;
  confidence?: ConfidenceLevel;
}) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 items-start py-1.5">
      <div className="pt-1.5">
        <span className="text-xs font-medium text-zinc-500 truncate block">{label}</span>
        {confidence && (confidence === 'guess' || confidence === 'inferred') && (
          <span className={`inline-flex mt-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${confidenceClass(confidence)}`}>
            {confidenceText(confidence)}
          </span>
        )}
      </div>
      <div>{children}</div>
    </div>
  );
}
