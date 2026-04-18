import { useState, useCallback, useMemo } from 'react';
import type { SpanNode } from '../../types';
import { GitBranch, ChevronDown, ChevronRight, Crosshair, Maximize2, Minimize2 } from 'lucide-react';

const KIND_LABELS: Record<string, string> = {
  'pipeline.start': '流水线开始', 'pipeline.complete': '流水线完成', 'pipeline.error': '流水线错误',
  'stage.start': '阶段开始', 'stage.complete': '阶段完成', 'stage.error': '阶段错误',
  'stage.retry': '重试', 'stage.skip': '跳过',
  'ai_call.start': 'AI 调用', 'ai_call.complete': 'AI 完成', 'ai_call.error': 'AI 错误',
  'cost.recorded': '费用记录',
  'scene.review': '场景审核', 'assembly.progress': '组装进度',
  'checkpoint.pause': '暂停', 'checkpoint.resume': '恢复',
};

function ms(v: number | undefined): string {
  if (v === undefined) return '';
  if (v < 1000) return `${v}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

/** Collect span IDs on the error path (node itself is error, or has a descendant that is) */
function collectErrorPath(nodes: SpanNode[]): Set<string> {
  const ids = new Set<string>();
  function walk(n: SpanNode): boolean {
    const childHasErr = n.children.some(c => walk(c));
    if (n.status === 'error' || childHasErr) { ids.add(n.spanId); return true; }
    return false;
  }
  nodes.forEach(walk);
  return ids;
}

function collectExpandableIds(nodes: SpanNode[]): string[] {
  const ids: string[] = [];
  function walk(n: SpanNode) {
    if (n.children.length > 0) ids.push(n.spanId);
    n.children.forEach(walk);
  }
  nodes.forEach(walk);
  return ids;
}

function countAll(nodes: SpanNode[]): number {
  return nodes.reduce((s, n) => s + 1 + countAll(n.children), 0);
}

/* ── Node card ─────────────────────────────────────────────── */

interface NodeCardProps {
  node: SpanNode;
  depth: number;
  errorPath: Set<string>;
  selectedId: string | null;
  onSelect: (node: SpanNode) => void;
  expandedIds: Set<string>;
  onToggle: (id: string) => void;
}

function NodeCard({ node, depth, errorPath, selectedId, onSelect, expandedIds, onToggle }: NodeCardProps) {
  const isExpanded = expandedIds.has(node.spanId);
  const hasChildren = node.children.length > 0;
  const isOnErrorPath = errorPath.has(node.spanId);
  const isError = node.status === 'error';
  const isSelected = selectedId === node.spanId;
  const kindLabel = KIND_LABELS[node.kind] ?? node.kind;

  const isAiCall = node.kind.startsWith('ai_call');
  const isStageNode = node.kind.startsWith('stage.');
  const isClickable = !!(node.stage && (isAiCall || isStageNode));

  const borderCls = isSelected
    ? 'border-blue-400/70'
    : isError ? 'border-red-500/60'
    : isOnErrorPath ? 'border-red-500/30'
    : 'border-zinc-700/50';

  const bgCls = isSelected
    ? 'bg-blue-950/30'
    : isError ? 'bg-red-950/30'
    : isOnErrorPath ? 'bg-red-950/10'
    : 'bg-zinc-900/40';

  const leftAccent = isError
    ? 'border-l-2 border-l-red-500'
    : isOnErrorPath ? 'border-l-2 border-l-red-500/40'
    : '';

  const statusDot = isError
    ? 'bg-red-400 shadow-[0_0_6px] shadow-red-400/60'
    : node.status === 'ok' ? 'bg-emerald-400'
    : 'bg-blue-400';

  return (
    <div>
      {/* Node card */}
      <div
        className={`border ${borderCls} ${bgCls} ${leftAccent} rounded-lg px-2.5 py-1.5 mb-0.5 transition-all duration-150 ${
          isClickable ? 'cursor-pointer hover:brightness-125' : ''
        } ${isSelected ? 'ring-1 ring-blue-400/40' : ''}`}
        onClick={e => { e.stopPropagation(); if (isClickable) onSelect(node); }}
        title={isAiCall ? '点击查看 AI 调用详情' : isStageNode ? '点击查看时间线' : undefined}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {hasChildren ? (
            <button
              onClick={e => { e.stopPropagation(); onToggle(node.spanId); }}
              className="p-0.5 -ml-0.5 hover:bg-zinc-700/50 rounded shrink-0"
            >
              {isExpanded
                ? <ChevronDown size={12} className="text-zinc-400" />
                : <ChevronRight size={12} className="text-zinc-400" />}
            </button>
          ) : <span className="w-4 shrink-0" />}

          <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot}`} />

          <span className={`text-xs font-medium shrink-0 ${
            isError ? 'text-red-400' : node.status === 'ok' ? 'text-emerald-400' : 'text-blue-400'
          }`}>
            {kindLabel}
          </span>

          {node.stage && <span className="text-xs text-zinc-400 font-mono truncate">{node.stage}</span>}

          <span className="flex-1 min-w-0" />

          {node.provider && (
            <span className="text-[10px] bg-zinc-800/80 border border-zinc-700/50 rounded-full px-1.5 py-0.5 text-blue-400 shrink-0 whitespace-nowrap">
              {node.provider}{node.model ? ` · ${node.model}` : ''}
            </span>
          )}

          {node.method && !node.provider && (
            <span className="text-[10px] text-zinc-500 shrink-0">{node.method}</span>
          )}

          {node.durationMs !== undefined && (
            <span className="text-xs text-zinc-500 font-mono shrink-0">{ms(node.durationMs)}</span>
          )}

          {isClickable && <Crosshair size={10} className="text-zinc-600 shrink-0" />}
        </div>
      </div>

      {/* Children with tree connectors */}
      {isExpanded && hasChildren && (
        <div className="ml-4">
          {node.children.map((child, i) => {
            const isLast = i === node.children.length - 1;
            const childOnError = errorPath.has(child.spanId);
            const lineCls = childOnError ? 'bg-red-500/50' : 'bg-zinc-700/50';
            const dotCls = childOnError ? 'bg-red-400' : 'bg-zinc-600';

            return (
              <div key={child.spanId} className="relative pl-5">
                {/* Vertical trunk */}
                <div className={`absolute left-[4px] top-0 w-px ${lineCls} ${isLast ? 'h-4' : 'h-full'}`} />
                {/* Horizontal branch */}
                <div className={`absolute left-[4px] top-4 w-[14px] h-px ${lineCls}`} />
                {/* Junction dot */}
                <div className={`absolute left-[17px] top-[14px] w-1 h-1 rounded-full ${dotCls}`} />

                <NodeCard
                  node={child}
                  depth={depth + 1}
                  errorPath={errorPath}
                  selectedId={selectedId}
                  onSelect={onSelect}
                  expandedIds={expandedIds}
                  onToggle={onToggle}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Main component ────────────────────────────────────────── */

interface SpanGraphProps {
  tree: SpanNode[];
  onSelectSpan?: (node: SpanNode) => void;
}

export function SpanGraphView({ tree, onSelectSpan }: SpanGraphProps) {
  const errorPath = useMemo(() => collectErrorPath(tree), [tree]);
  const allExpandableIds = useMemo(() => collectExpandableIds(tree), [tree]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    const ep = collectErrorPath(tree);
    function walk(nodes: SpanNode[], d: number) {
      for (const n of nodes) {
        if ((d < 2 || ep.has(n.spanId)) && n.children.length > 0) {
          ids.add(n.spanId);
          walk(n.children, d + 1);
        }
      }
    }
    walk(tree, 0);
    return ids;
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleToggle = useCallback((id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleSelect = useCallback((node: SpanNode) => {
    setSelectedId(prev => prev === node.spanId ? null : node.spanId);
    onSelectSpan?.(node);
  }, [onSelectSpan]);

  if (tree.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4">
        <h3 className="text-sm font-semibold text-zinc-300">Span 节点图</h3>
        <p className="text-xs text-zinc-600 mt-2">无 Span 数据</p>
      </div>
    );
  }

  const total = countAll(tree);

  return (
    <div className="rounded-xl border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-3">
      {/* Header */}
      <div className="flex items-center gap-2 flex-wrap">
        <GitBranch size={16} className="text-zinc-400" />
        <h3 className="text-sm font-semibold text-zinc-300">Span 节点图</h3>
        <span className="text-xs text-zinc-500">{total} spans</span>
        {errorPath.size > 0 && <span className="text-xs text-red-400">{errorPath.size} 错误路径</span>}
        <span className="flex-1" />
        <button
          onClick={() => setExpandedIds(new Set(allExpandableIds))}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800"
        >
          <Maximize2 size={10} /> 展开全部
        </button>
        <button
          onClick={() => setExpandedIds(new Set())}
          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-1.5 py-0.5 rounded hover:bg-zinc-800"
        >
          <Minimize2 size={10} /> 折叠全部
        </button>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-3 text-[10px] text-zinc-500">
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> 成功</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400" /> 错误</span>
        <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400" /> 信息</span>
        <span className="flex items-center gap-1"><Crosshair size={8} /> 可点击联动</span>
      </div>

      {/* Tree */}
      <div className="overflow-x-auto">
        {tree.map(node => (
          <NodeCard
            key={node.spanId}
            node={node}
            depth={0}
            errorPath={errorPath}
            selectedId={selectedId}
            onSelect={handleSelect}
            expandedIds={expandedIds}
            onToggle={handleToggle}
          />
        ))}
      </div>
    </div>
  );
}
