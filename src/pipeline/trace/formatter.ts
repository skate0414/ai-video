/* ------------------------------------------------------------------ */
/*  Trace Formatter – ANSI-colored CLI output for trace analysis      */
/*  Pure formatting functions — no I/O.                               */
/* ------------------------------------------------------------------ */

import type { TraceReplayBundle } from './traceEvents.js';
import type {
  TimelineEntry,
  FailureSpan,
  ProviderDecision,
  StageDiff,
} from './analyzer.js';

/* ---- ANSI helpers ---- */

const RESET  = '\x1b[0m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE   = '\x1b[34m';
const CYAN   = '\x1b[36m';
const WHITE  = '\x1b[37m';
const BG_RED = '\x1b[41m';

function pad(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : s + ' '.repeat(len - s.length);
}

function padLeft(s: string, len: number): string {
  return s.length >= len ? s.slice(0, len) : ' '.repeat(len - s.length) + s;
}

function ms(v: number | undefined): string {
  if (v === undefined) return '-';
  if (v < 1000) return `${v}ms`;
  return `${(v / 1000).toFixed(1)}s`;
}

function usd(v: number | undefined): string {
  if (v === undefined || v === 0) return '-';
  if (v < 0.001) return `$${v.toFixed(6)}`;
  return `$${v.toFixed(4)}`;
}

const STATUS_ICON: Record<string, string> = {
  ok: `${GREEN}✓${RESET}`,
  error: `${RED}✗${RESET}`,
  retry: `${YELLOW}⟳${RESET}`,
  skip: `${DIM}⊘${RESET}`,
  info: `${BLUE}•${RESET}`,
};

/* ---- Formatters ---- */

/**
 * Format the summary header.
 */
export function formatSummary(bundle: TraceReplayBundle): string {
  const outcomeColor =
    bundle.outcome === 'success' ? GREEN :
    bundle.outcome === 'error' ? RED :
    bundle.outcome === 'aborted' ? YELLOW :
    BLUE;

  const lines: string[] = [
    `${BOLD}══════════════════════════════════════════════════════${RESET}`,
    `${BOLD}  Trace Replay${RESET}`,
    `${BOLD}══════════════════════════════════════════════════════${RESET}`,
    '',
    `  ${DIM}Trace ID:${RESET}   ${bundle.traceId}`,
    `  ${DIM}Project:${RESET}    ${bundle.projectId}`,
    `  ${DIM}Topic:${RESET}      ${bundle.topic}`,
    `  ${DIM}Tier:${RESET}       ${bundle.qualityTier}`,
    `  ${DIM}Outcome:${RESET}    ${outcomeColor}${BOLD}${bundle.outcome.toUpperCase()}${RESET}`,
    `  ${DIM}Duration:${RESET}   ${ms(bundle.durationMs)}`,
    `  ${DIM}Started:${RESET}    ${bundle.startedAt}`,
    `  ${DIM}Ended:${RESET}      ${bundle.endedAt ?? '-'}`,
    '',
    `  ${DIM}Stages:${RESET}     ${bundle.totals.stagesCompleted} completed, ${bundle.totals.stagesFailed} failed, ${bundle.totals.retries} retries`,
    `  ${DIM}LLM Calls:${RESET}  ${bundle.totals.llmCalls}`,
    `  ${DIM}Total Cost:${RESET} ${usd(bundle.totals.costUsd)}`,
    '',
  ];

  return lines.join('\n');
}

/**
 * Format the event timeline as a table.
 */
export function formatTimeline(entries: TimelineEntry[]): string {
  const lines: string[] = [
    `${BOLD}─── Timeline ──────────────────────────────────────────${RESET}`,
    '',
    `  ${DIM}${pad('OFFSET', 10)} ${pad('KIND', 22)} ${pad('STAGE', 22)} ${pad('PROVIDER', 14)} ${pad('DURATION', 10)} STATUS${RESET}`,
    `  ${DIM}${'─'.repeat(90)}${RESET}`,
  ];

  for (const entry of entries) {
    const icon = STATUS_ICON[entry.status] ?? '•';
    const offset = padLeft(ms(entry.offsetMs), 9);
    const kind = pad(entry.kind, 22);
    const stage = pad(entry.stage ?? '', 22);
    const provider = pad(entry.provider ?? '', 14);
    const dur = padLeft(entry.durationMs !== undefined ? ms(entry.durationMs) : '', 9);

    lines.push(`  ${offset} ${kind} ${stage} ${provider} ${dur} ${icon}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format the failure span detail.
 */
export function formatFailureSpan(span: FailureSpan): string {
  const lines: string[] = [
    `${BG_RED}${WHITE}${BOLD} ✗ FAILURE DETAIL ${RESET}`,
    '',
    `  ${RED}${BOLD}Stage:${RESET}     ${span.stage}`,
    `  ${RED}${BOLD}Category:${RESET}  ${span.failure.category}`,
    `  ${RED}${BOLD}Code:${RESET}      ${span.failure.code}`,
    `  ${RED}${BOLD}Message:${RESET}   ${span.failure.message}`,
    `  ${RED}${BOLD}Type:${RESET}      ${span.failure.errorType}`,
    `  ${RED}${BOLD}Retryable:${RESET} ${span.failure.retryable ? `${YELLOW}yes${RESET}` : `${RED}no${RESET}`}`,
    `  ${DIM}Duration:${RESET}  ${ms(span.totalDurationMs)}`,
    '',
  ];

  if (span.retries.length > 0) {
    lines.push(`  ${YELLOW}${BOLD}Retry Chain (${span.retries.length} attempts):${RESET}`);
    for (const r of span.retries) {
      lines.push(`    ${YELLOW}⟳${RESET} Attempt ${r.attempt} → ${r.failure.code} (backoff: ${ms(r.backoffMs)})`);
    }
    lines.push('');
  }

  if (span.aiCalls.length > 0) {
    lines.push(`  ${CYAN}${BOLD}AI Calls in failing stage:${RESET}`);
    for (const call of span.aiCalls) {
      const icon = call.failure ? `${RED}✗${RESET}` : `${GREEN}✓${RESET}`;
      const failMsg = call.failure ? ` → ${DIM}${call.failure.code}${RESET}` : '';
      lines.push(`    ${icon} ${call.provider}/${call.model ?? '?'} ${DIM}(${call.method}, ${ms(call.durationMs)})${RESET}${failMsg}`);
    }
    lines.push('');
  }

  if (span.failure.stack) {
    lines.push(`  ${DIM}Stack trace:${RESET}`);
    const frames = span.failure.stack.split('\n').slice(0, 5);
    for (const frame of frames) {
      lines.push(`    ${DIM}${frame}${RESET}`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Format the provider decision path as a table.
 */
export function formatProviderPath(decisions: ProviderDecision[]): string {
  const lines: string[] = [
    `${BOLD}─── Provider Decision Path ─────────────────────────────${RESET}`,
    '',
    `  ${DIM}${pad('STAGE', 22)} ${pad('PROVIDER', 14)} ${pad('MODEL', 18)} ${pad('METHOD', 16)} ${pad('DURATION', 10)} ${pad('COST', 10)} STATUS${RESET}`,
    `  ${DIM}${'─'.repeat(100)}${RESET}`,
  ];

  for (const d of decisions) {
    const icon = d.failed ? `${RED}✗${RESET}` : `${GREEN}✓${RESET}`;
    const fbBadge = d.isFallback ? ` ${YELLOW}[fallback]${RESET}` : '';
    const stage = pad(d.stage, 22);
    const provider = pad(d.provider, 14);
    const model = pad(d.model ?? '-', 18);
    const method = pad(d.method, 16);
    const dur = padLeft(ms(d.durationMs), 9);
    const cost = padLeft(usd(d.costUsd), 9);

    lines.push(`  ${stage} ${provider} ${model} ${method} ${dur} ${cost} ${icon}${fbBadge}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Format stage diffs as a summary table.
 */
export function formatStageDiff(diffs: StageDiff[]): string {
  const lines: string[] = [
    `${BOLD}─── Stage Summary ──────────────────────────────────────${RESET}`,
    '',
    `  ${DIM}${pad('STAGE', 22)} ${pad('STATUS', 12)} ${pad('DURATION', 10)} ${pad('RETRIES', 8)} ${pad('AI CALLS', 9)} ${pad('COST', 10)}${RESET}`,
    `  ${DIM}${'─'.repeat(80)}${RESET}`,
  ];

  for (const d of diffs) {
    const statusColor =
      d.status === 'completed' ? GREEN :
      d.status === 'error' ? RED :
      d.status === 'skipped' ? DIM :
      BLUE;

    const stage = pad(d.stage, 22);
    const status = pad(`${statusColor}${d.status}${RESET}`, 12 + statusColor.length + RESET.length);
    const dur = padLeft(ms(d.durationMs), 9);
    const retries = padLeft(d.retries > 0 ? `${YELLOW}${d.retries}${RESET}` : '0', d.retries > 0 ? 7 + YELLOW.length + RESET.length : 7);
    const aiCalls = padLeft(String(d.aiCalls), 8);
    const cost = padLeft(usd(d.costUsd), 9);

    lines.push(`  ${stage} ${status} ${dur} ${retries} ${aiCalls} ${cost}`);
  }

  lines.push('');
  return lines.join('\n');
}
