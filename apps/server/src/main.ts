import { fileURLToPath } from 'node:url';
import { createLogger } from '@ai-video/lib/logger.js';
import {
  configurePipelineCorePorts,
  defaultPipelineCorePorts,
  freezePipelineCorePorts,
  isPipelineCorePortsFrozen,
  type PipelineCorePorts,
} from '@ai-video/pipeline-core/index.js';
import { bootstrapServerEnvironment } from './bootstrap.js';
import { createServerWiring } from './wiring.js';
import { startServerRuntime } from './runtime.js';

// Side-effect import: registers all provider plugins.
import '@ai-video/pipeline-core/providerPlugins.js';
// Side-effect import: registers all built-in video stage definitions before
// external plugins try to slot in via after/before constraints.
import '@ai-video/pipeline-video/stageDefinitions.js';

const STARTUP_PORT_SOURCES_DEFAULT: Record<keyof PipelineCorePorts, string> = {
  adapterHostBindingsPort: 'default',
  chatAutomationPort: 'default',
  ffmpegAssemblerPort: 'default',
  responseParserPort: 'default',
  videoProviderPort: 'default',
  voiceStylePort: 'default',
};

const STARTUP_PORT_SOURCE_ENV = 'PIPELINE_CORE_PORT_SOURCE';
const STARTUP_PORT_SOURCE_TAGS_ENV = 'PIPELINE_CORE_PORT_SOURCE_TAGS';

function buildStartupPortSources(log: ReturnType<typeof createLogger>): Record<keyof PipelineCorePorts, string> {
  const sources: Record<keyof PipelineCorePorts, string> = { ...STARTUP_PORT_SOURCES_DEFAULT };
  const globalSource = process.env[STARTUP_PORT_SOURCE_ENV]?.trim();
  if (globalSource) {
    for (const key of Object.keys(sources) as Array<keyof PipelineCorePorts>) {
      sources[key] = globalSource;
    }
  }

  const sourceTagsRaw = process.env[STARTUP_PORT_SOURCE_TAGS_ENV]?.trim();
  if (!sourceTagsRaw) return sources;

  try {
    const parsed = JSON.parse(sourceTagsRaw) as Partial<Record<keyof PipelineCorePorts, unknown>>;
    for (const [rawKey, rawValue] of Object.entries(parsed)) {
      if (!(rawKey in sources)) {
        log.warn('pipeline_core_port_source_tag_ignored', { key: rawKey, reason: 'unknown_port_key' });
        continue;
      }
      const value = typeof rawValue === 'string' ? rawValue.trim() : '';
      if (!value) {
        log.warn('pipeline_core_port_source_tag_ignored', { key: rawKey, reason: 'empty_source_label' });
        continue;
      }
      sources[rawKey as keyof PipelineCorePorts] = value;
    }
  } catch (err) {
    log.warn('pipeline_core_port_source_tags_parse_failed', {
      env: STARTUP_PORT_SOURCE_TAGS_ENV,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  return sources;
}

function configureAndFreezePipelineCorePorts(log: ReturnType<typeof createLogger>): void {
  if (isPipelineCorePortsFrozen()) {
    log.info('pipeline_core_ports_already_frozen');
    return;
  }
  const startupPortSources = buildStartupPortSources(log);
  const startupPorts: PipelineCorePorts = { ...defaultPipelineCorePorts };
  configurePipelineCorePorts(startupPorts);
  log.info('pipeline_core_ports_configured', {
    strategy: 'explicit-default-map',
    sources: startupPortSources,
  });
  freezePipelineCorePorts();
  log.info('pipeline_core_ports_frozen');
}

export async function startServerApp() {
  const log = createLogger('server');
  configureAndFreezePipelineCorePorts(log);
  const boot = await bootstrapServerEnvironment(log);
  const wiring = createServerWiring(boot.dataDir, log);
  const runtime = startServerRuntime({
    port: boot.port,
    dataDir: boot.dataDir,
    uploadDir: boot.uploadDir,
    allowedOrigins: boot.allowedOrigins,
    apiKey: boot.apiKey,
    workbench: wiring.workbench,
    pipelineService: wiring.pipelineService,
    logger: log,
  });

  wiring.eventBridge.setSink(runtime.broadcastEvent);
  return runtime.server;
}

const isDirectEntry = process.argv[1] != null
  && fileURLToPath(import.meta.url) === process.argv[1];

if (isDirectEntry) {
  startServerApp().catch((err) => {
    const log = createLogger('server');
    log.error(
      'startup_failed',
      err instanceof Error ? err : undefined,
      err instanceof Error ? undefined : { error: String(err) },
    );
    process.exitCode = 1;
  });
}
