import type { FailureSpan } from '../../types';
import { AlertTriangle, RotateCcw, Zap } from 'lucide-react';
import { useState } from 'react';

function ms(v: number): string {
  if (v < 1000) return `${v}ms`;
  const s = v / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m${Math.round(s % 60)}s`;
}

const CATEGORY_LABELS: Record<string, string> = {
  transient: '临时故障', quota: '配额耗尽', safety: '安全拦截',
  timeout: '超时', abort: '用户中止', contract: '数据校验', parse: '解析失败',
  infrastructure: '基础设施', upstream: '上游故障', unknown: '未知',
};

export function FailureDetail({ span }: { span: FailureSpan }) {
  const [showStack, setShowStack] = useState(false);

  return (
    <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <AlertTriangle size={18} className="text-red-400" />
        <h3 className="text-sm font-semibold text-red-300">故障诊断</h3>
      </div>

      {/* Failure info */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
        <div>
          <span className="text-zinc-500">失败阶段</span>
          <p className="text-zinc-200 font-mono">{span.stage}</p>
        </div>
        <div>
          <span className="text-zinc-500">分类</span>
          <p className="text-zinc-200">
            <span className="inline-block px-2 py-0.5 rounded text-xs bg-red-500/20 text-red-300 border border-red-500/30">
              {CATEGORY_LABELS[span.failure.category] ?? span.failure.category}
            </span>
          </p>
        </div>
        <div>
          <span className="text-zinc-500">错误码</span>
          <p className="text-red-300 font-mono text-xs">{span.failure.code}</p>
        </div>
        <div>
          <span className="text-zinc-500">可重试</span>
          <p className={span.failure.retryable ? 'text-yellow-400' : 'text-red-400'}>
            {span.failure.retryable ? '是' : '否'}
          </p>
        </div>
        <div className="col-span-2">
          <span className="text-zinc-500">错误消息</span>
          <p className="text-zinc-300 text-xs break-all">{span.failure.message}</p>
        </div>
        <div>
          <span className="text-zinc-500">总耗时</span>
          <p className="text-zinc-200">{ms(span.totalDurationMs)}</p>
        </div>
      </div>

      {/* Retry chain */}
      {span.retries.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <RotateCcw size={14} className="text-yellow-400" />
            <span className="text-xs font-medium text-yellow-300">重试链 ({span.retries.length} 次)</span>
          </div>
          <div className="space-y-1">
            {span.retries.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-yellow-500/5 border border-yellow-500/10">
                <span className="text-yellow-400">⟳ 第 {r.attempt} 次</span>
                <span className="text-zinc-500">退避: {ms(r.backoffMs)}</span>
                <span className="text-zinc-400 truncate">{r.failure.code}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI calls in failing stage */}
      {span.aiCalls.length > 0 && (
        <div>
          <div className="flex items-center gap-1 mb-1">
            <Zap size={14} className="text-cyan-400" />
            <span className="text-xs font-medium text-cyan-300">相关 AI 调用</span>
          </div>
          <div className="space-y-1">
            {span.aiCalls.map((call, i) => (
              <div key={i} className="flex items-center gap-2 text-xs px-2 py-1 rounded bg-zinc-800/50 border border-zinc-700/50">
                <span className={call.failure ? 'text-red-400' : 'text-green-400'}>
                  {call.failure ? '✗' : '✓'}
                </span>
                <span className="text-zinc-300">{call.provider}/{call.model ?? '?'}</span>
                <span className="text-zinc-500">{call.method}</span>
                <span className="text-zinc-600 font-mono">{ms(call.durationMs)}</span>
                {call.failure && <span className="text-red-400 truncate">{call.failure.code}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stack trace */}
      {span.failure.stack && (
        <div>
          <button
            onClick={() => setShowStack(!showStack)}
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            {showStack ? '隐藏' : '展开'} Stack Trace
          </button>
          {showStack && (
            <pre className="mt-1 text-xs text-zinc-600 bg-zinc-900 rounded-lg p-2 overflow-x-auto max-h-40 overflow-y-auto border border-zinc-800">
              {span.failure.stack}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}
