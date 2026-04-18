#!/usr/bin/env npx tsx
/* ------------------------------------------------------------------ */
/*  Trace Replay CLI – one command to diagnose pipeline failures      */
/*                                                                    */
/*  Usage:                                                            */
/*    npx tsx src/cli/replay.ts <arg> [options]                       */
/*                                                                    */
/*  <arg> can be:                                                     */
/*    - Path to a trace-*.json bundle file                            */
/*    - A project ID (finds latest trace)                             */
/*    - A 32-char hex trace ID (scans all projects)                   */
/*                                                                    */
/*  Options:                                                          */
/*    --json           Output as JSON (for CI integration)            */
/*    --format <mode>  summary|timeline|failure|providers|stages|all  */
/*                     (default: all)                                 */
/*    --list           List all available trace bundles                */
/* ------------------------------------------------------------------ */

import { TraceWriter } from '../pipeline/trace/traceWriter.js';
import {
  buildTimeline,
  findFailureSpan,
  buildProviderDecisionPath,
  buildStageDiff,
} from '../pipeline/trace/analyzer.js';
import {
  formatSummary,
  formatTimeline,
  formatFailureSpan,
  formatProviderPath,
  formatStageDiff,
} from '../pipeline/trace/formatter.js';
import { findTraceBundle, listAllTraces } from './findTrace.js';

type FormatMode = 'summary' | 'timeline' | 'failure' | 'providers' | 'stages' | 'all';

function printUsage(): void {
  console.log(`
Usage: npx tsx src/cli/replay.ts <arg> [options]

Arguments:
  <arg>              Path to trace-*.json, project ID, or 32-char trace ID

Options:
  --json             Output as JSON (machine-readable)
  --format <mode>    Output mode: summary|timeline|failure|providers|stages|all
                     (default: all)
  --list             List all available trace bundles
  --help             Show this help

Examples:
  npx tsx src/cli/replay.ts ./data/projects/my-project/trace/trace-abc123.json
  npx tsx src/cli/replay.ts my-project
  npx tsx src/cli/replay.ts abc123def456...  (32-char hex)
  npx tsx src/cli/replay.ts my-project --json
  npx tsx src/cli/replay.ts my-project --format failure
  npx tsx src/cli/replay.ts --list
`);
}

function parseArgs(argv: string[]) {
  const args = argv.slice(2);
  let positional: string | undefined;
  let jsonMode = false;
  let format: FormatMode = 'all';
  let listMode = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') {
      jsonMode = true;
    } else if (arg === '--format') {
      const next = args[++i];
      if (!next || !['summary', 'timeline', 'failure', 'providers', 'stages', 'all'].includes(next)) {
        console.error('Error: --format requires one of: summary, timeline, failure, providers, stages, all');
        process.exit(2);
      }
      format = next as FormatMode;
    } else if (arg === '--list') {
      listMode = true;
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    } else if (!arg.startsWith('-')) {
      positional = arg;
    } else {
      console.error(`Unknown option: ${arg}`);
      printUsage();
      process.exit(2);
    }
  }

  return { positional, jsonMode, format, listMode };
}

function handleList(jsonMode: boolean): void {
  const traces = listAllTraces();
  if (traces.length === 0) {
    if (jsonMode) {
      console.log(JSON.stringify([]));
    } else {
      console.log('No trace bundles found.');
    }
    process.exit(0);
  }

  if (jsonMode) {
    console.log(JSON.stringify(traces, null, 2));
    process.exit(0);
  }

  console.log(`\nFound ${traces.length} trace bundle(s):\n`);
  for (const t of traces) {
    const outcomeIcon = t.outcome === 'success' ? '✓' : t.outcome === 'error' ? '✗' : '•';
    const dur = t.durationMs ? `${(t.durationMs / 1000).toFixed(1)}s` : '-';
    console.log(`  ${outcomeIcon} ${t.traceId.slice(0, 12)}…  ${t.projectId}  ${t.outcome}  ${dur}  ${t.startedAt}`);
  }
  console.log('');
  process.exit(0);
}

function main(): void {
  const { positional, jsonMode, format, listMode } = parseArgs(process.argv);

  if (listMode) {
    handleList(jsonMode);
    return;
  }

  if (!positional) {
    console.error('Error: Please provide a trace file path, project ID, or trace ID.');
    printUsage();
    process.exit(2);
  }

  // Resolve trace bundle
  let bundlePath: string;
  try {
    bundlePath = findTraceBundle(positional);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    process.exit(2);
  }

  // Load bundle
  const bundle = TraceWriter.load(bundlePath);

  // Compute analysis
  const timeline = buildTimeline(bundle);
  const failureSpan = findFailureSpan(bundle);
  const providerPath = buildProviderDecisionPath(bundle);
  const stageDiff = buildStageDiff(bundle);

  // JSON output mode
  if (jsonMode) {
    const output = {
      bundle: {
        traceId: bundle.traceId,
        projectId: bundle.projectId,
        topic: bundle.topic,
        qualityTier: bundle.qualityTier,
        outcome: bundle.outcome,
        durationMs: bundle.durationMs,
        startedAt: bundle.startedAt,
        endedAt: bundle.endedAt,
        totals: bundle.totals,
        terminalFailure: bundle.terminalFailure,
      },
      timeline,
      failureSpan,
      providerPath,
      stageDiff,
    };
    console.log(JSON.stringify(output, null, 2));
    process.exit(bundle.outcome === 'error' || bundle.outcome === 'aborted' ? 1 : 0);
  }

  // Text output
  const sections: string[] = [];

  if (format === 'all' || format === 'summary') {
    sections.push(formatSummary(bundle));
  }

  if (format === 'all' || format === 'stages') {
    sections.push(formatStageDiff(stageDiff));
  }

  if (format === 'all' || format === 'timeline') {
    sections.push(formatTimeline(timeline));
  }

  if ((format === 'all' || format === 'failure') && failureSpan) {
    sections.push(formatFailureSpan(failureSpan));
  }

  if (format === 'all' || format === 'providers') {
    sections.push(formatProviderPath(providerPath));
  }

  console.log(sections.join('\n'));

  // Exit code: 1 for errors, 0 for success
  process.exit(bundle.outcome === 'error' || bundle.outcome === 'aborted' ? 1 : 0);
}

main();
