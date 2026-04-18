/* ------------------------------------------------------------------ */
/*  Trace Writer – crash-safe JSONL streaming + atomic bundle output  */
/*  Events are appended one-per-line during execution (crash-safe).  */
/*  Final replay bundle is written atomically on completion.          */
/* ------------------------------------------------------------------ */

import { existsSync, mkdirSync, appendFileSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../lib/logger.js';
import type {
  AnyTraceEvent,
  TraceReplayBundle,
  StageSummary,
  ReplayTotals,
  FailureDescriptor,
} from './traceEvents.js';
import { TRACE_SCHEMA_VERSION } from './traceEvents.js';

const log = createLogger('TraceWriter');

export interface TraceWriterMeta {
  topic: string;
  qualityTier: string;
  startedAt: string;
}

export class TraceWriter {
  private readonly events: AnyTraceEvent[] = [];
  private readonly traceDir: string;
  private readonly jsonlPath: string;

  constructor(
    private readonly traceId: string,
    private readonly projectId: string,
    projectDir: string,
  ) {
    this.traceDir = join(projectDir, 'trace');
    this.jsonlPath = join(this.traceDir, `events-${traceId}.jsonl`);
    try {
      if (!existsSync(this.traceDir)) mkdirSync(this.traceDir, { recursive: true });
    } catch (e) {
      log.warn('trace_dir_create_failed', { traceDir: this.traceDir, error: (e as Error).message });
    }
  }

  /** Append an event to the in-memory buffer and the JSONL file. */
  append(event: AnyTraceEvent): void {
    this.events.push(event);
    try {
      appendFileSync(this.jsonlPath, JSON.stringify(event) + '\n');
    } catch (e) {
      // Trace I/O failure must never break the pipeline
      log.warn('trace_append_failed', { kind: event.kind, error: (e as Error).message });
    }
  }

  /** Get the in-memory event buffer (read-only). */
  getEvents(): readonly AnyTraceEvent[] {
    return this.events;
  }

  /** Build a replay bundle from buffered events. */
  buildReplayBundle(meta: TraceWriterMeta): TraceReplayBundle {
    const stageSummary: Record<string, StageSummary> = {};
    const totals: ReplayTotals = {
      stagesCompleted: 0,
      stagesFailed: 0,
      llmCalls: 0,
      costUsd: 0,
      retries: 0,
    };

    let endedAt: string | undefined;
    let durationMs: number | undefined;
    let outcome: TraceReplayBundle['outcome'] = 'in_progress';
    let terminalFailure: FailureDescriptor | undefined;

    for (const evt of this.events) {
      switch (evt.kind) {
        case 'stage.start':
          stageSummary[evt.data.stage] = {
            status: 'not_started',
            retries: 0,
          };
          break;

        case 'stage.complete':
          if (stageSummary[evt.data.stage]) {
            stageSummary[evt.data.stage].status = 'completed';
            stageSummary[evt.data.stage].durationMs = evt.data.durationMs;
          }
          totals.stagesCompleted++;
          break;

        case 'stage.error':
          if (stageSummary[evt.data.stage]) {
            stageSummary[evt.data.stage].status = 'error';
            stageSummary[evt.data.stage].failure = evt.data.failure;
          }
          totals.stagesFailed++;
          break;

        case 'stage.retry':
          if (stageSummary[evt.data.stage]) {
            stageSummary[evt.data.stage].retries++;
          }
          totals.retries++;
          break;

        case 'stage.skip':
          stageSummary[evt.data.stage] = {
            status: 'skipped',
            retries: 0,
          };
          break;

        case 'ai_call.start':
          totals.llmCalls++;
          break;

        case 'cost.recorded':
          totals.costUsd += evt.data.estimatedCostUsd;
          break;

        case 'pipeline.complete':
          outcome = 'success';
          endedAt = evt.ts;
          durationMs = evt.data.durationMs;
          break;

        case 'pipeline.error':
          outcome = evt.data.failure.category === 'abort' ? 'aborted' : 'error';
          terminalFailure = evt.data.failure;
          endedAt = evt.ts;
          durationMs = evt.data.durationMs;
          break;
      }
    }

    return {
      v: TRACE_SCHEMA_VERSION,
      traceId: this.traceId,
      projectId: this.projectId,
      topic: meta.topic,
      qualityTier: meta.qualityTier,
      startedAt: meta.startedAt,
      endedAt,
      durationMs,
      outcome,
      terminalFailure,
      events: this.events,
      stageSummary,
      totals,
    };
  }

  /** Atomically write the replay bundle to disk (write → rename). */
  save(meta: TraceWriterMeta): void {
    try {
      const bundle = this.buildReplayBundle(meta);
      const bundlePath = join(this.traceDir, `trace-${this.traceId}.json`);
      const tmpPath = bundlePath + '.tmp';
      writeFileSync(tmpPath, JSON.stringify(bundle, null, 2));
      renameSync(tmpPath, bundlePath);
    } catch (e) {
      log.warn('trace_save_failed', { traceId: this.traceId, error: (e as Error).message });
    }
  }

  /** Load a replay bundle from disk. */
  static load(bundlePath: string): TraceReplayBundle {
    const raw = readFileSync(bundlePath, 'utf-8');
    const bundle = JSON.parse(raw) as TraceReplayBundle;
    if (bundle.v !== TRACE_SCHEMA_VERSION) {
      throw new Error(`Unsupported trace schema version: ${bundle.v} (expected ${TRACE_SCHEMA_VERSION})`);
    }
    return bundle;
  }
}
