/* ------------------------------------------------------------------ */
/*  Load test script — measures API throughput, latency, memory        */
/*  under concurrent load.                                            */
/*                                                                    */
/*  Usage:  node --import tsx src/testing/loadTest.ts [options]        */
/*  Options:                                                           */
/*    --port 3220       Target port (default: 3220)                   */
/*    --concurrent 10   Number of concurrent clients (default: 10)    */
/*    --duration 30     Test duration in seconds (default: 30)        */
/*    --ramp-up 5       Ramp-up period in seconds (default: 5)        */
/* ------------------------------------------------------------------ */

interface LoadTestConfig {
  port: number;
  concurrent: number;
  durationSec: number;
  rampUpSec: number;
  baseUrl: string;
}

interface RequestMetric {
  endpoint: string;
  method: string;
  statusCode: number;
  latencyMs: number;
  timestamp: number;
  error?: string;
}

interface EndpointStats {
  endpoint: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  maxLatencyMs: number;
  minLatencyMs: number;
  requestsPerSec: number;
}

interface LoadTestReport {
  config: LoadTestConfig;
  summary: {
    totalRequests: number;
    totalSuccesses: number;
    totalErrors: number;
    overallAvgLatencyMs: number;
    overallP95LatencyMs: number;
    overallP99LatencyMs: number;
    peakRps: number;
    avgRps: number;
    durationMs: number;
  };
  endpoints: EndpointStats[];
  sseTest: {
    maxConcurrentConnections: number;
    connectionSuccesses: number;
    connectionRejections: number;
    avgConnectionTimeMs: number;
  };
  memoryUsage: {
    startMB: number;
    endMB: number;
    deltaMB: number;
  };
  timestamp: string;
}

/* ---- Parse args ---- */

function parseArgs(): LoadTestConfig {
  const args = process.argv.slice(2);
  const get = (flag: string, def: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : def;
  };
  const port = Number(get('--port', process.env.PORT ?? '3220'));
  return {
    port,
    concurrent: Number(get('--concurrent', '10')),
    durationSec: Number(get('--duration', '30')),
    rampUpSec: Number(get('--ramp-up', '5')),
    baseUrl: `http://localhost:${port}`,
  };
}

/* ---- HTTP helper ---- */

async function timedFetch(
  url: string,
  method: string,
  body?: string,
): Promise<{ statusCode: number; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    const opts: RequestInit = {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body,
    };
    const res = await fetch(url, opts);
    const latencyMs = Math.round(performance.now() - start);
    // Consume body to free resources
    await res.text();
    return { statusCode: res.status, latencyMs };
  } catch (err: any) {
    const latencyMs = Math.round(performance.now() - start);
    return { statusCode: 0, latencyMs, error: err.message ?? String(err) };
  }
}

/* ---- Percentile helper ---- */

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/* ---- Endpoint test definitions ---- */

interface EndpointDef {
  name: string;
  method: string;
  path: string;
  body?: string;
}

const TEST_ENDPOINTS: EndpointDef[] = [
  { name: 'GET /health', method: 'GET', path: '/health' },
  { name: 'GET /api/pipeline', method: 'GET', path: '/api/pipeline' },
  { name: 'GET /api/config', method: 'GET', path: '/api/config' },
  { name: 'GET /api/config/environment', method: 'GET', path: '/api/config/environment' },
  { name: 'GET /api/providers/summary', method: 'GET', path: '/api/providers/summary' },
  { name: 'GET /api/config/route-table', method: 'GET', path: '/api/config/route-table' },
  { name: 'GET /api/costs', method: 'GET', path: '/api/costs' },
  { name: 'GET /api/providers/video-health', method: 'GET', path: '/api/providers/video-health' },
];

/* ---- SSE connection test ---- */

async function testSSEConnections(
  baseUrl: string,
  maxConnections: number,
): Promise<LoadTestReport['sseTest']> {
  console.log(`\n📡 Testing SSE connections (up to ${maxConnections})...`);

  let successes = 0;
  let rejections = 0;
  const controllers: AbortController[] = [];
  const latencies: number[] = [];

  for (let i = 0; i < maxConnections; i++) {
    const controller = new AbortController();
    controllers.push(controller);
    const start = performance.now();

    try {
      const res = await fetch(`${baseUrl}/api/events`, {
        signal: controller.signal,
        headers: { Accept: 'text/event-stream' },
      });
      latencies.push(Math.round(performance.now() - start));

      if (res.status === 200) {
        successes++;
      } else {
        rejections++;
      }
    } catch {
      rejections++;
    }
  }

  // Clean up all connections
  for (const c of controllers) c.abort();
  // Small delay for cleanup
  await new Promise(r => setTimeout(r, 500));

  console.log(`   ✅ Connected: ${successes}, ❌ Rejected: ${rejections}`);

  return {
    maxConcurrentConnections: successes,
    connectionSuccesses: successes,
    connectionRejections: rejections,
    avgConnectionTimeMs: latencies.length > 0
      ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
      : 0,
  };
}

/* ---- Main load test ---- */

async function runLoadTest(): Promise<LoadTestReport> {
  const config = parseArgs();
  console.log('🚀 AI Video Pipeline — Load Test');
  console.log('════════════════════════════════════');
  console.log(`Target:      ${config.baseUrl}`);
  console.log(`Concurrent:  ${config.concurrent} clients`);
  console.log(`Duration:    ${config.durationSec}s`);
  console.log(`Ramp-up:     ${config.rampUpSec}s`);

  // Health check
  try {
    const health = await timedFetch(`${config.baseUrl}/health`, 'GET');
    if (health.statusCode !== 200) {
      console.error(`\n❌ Server not responding at ${config.baseUrl}/health (status: ${health.statusCode})`);
      process.exit(1);
    }
    console.log(`\n✅ Server healthy (${health.latencyMs}ms)`);
  } catch {
    console.error(`\n❌ Cannot connect to ${config.baseUrl}`);
    process.exit(1);
  }

  // Collect memory before
  const memBefore = await getServerMemory(config.baseUrl);

  const metrics: RequestMetric[] = [];
  const startTime = Date.now();
  const endTime = startTime + config.durationSec * 1000;
  let activeWorkers = 0;
  const maxWorkers = config.concurrent;

  console.log(`\n⏱️  Running load test for ${config.durationSec}s...`);

  // Worker function
  async function worker(id: number) {
    while (Date.now() < endTime) {
      // Pick a random endpoint
      const ep = TEST_ENDPOINTS[Math.floor(Math.random() * TEST_ENDPOINTS.length)];
      const url = `${config.baseUrl}${ep.path}`;
      const result = await timedFetch(url, ep.method, ep.body);

      metrics.push({
        endpoint: ep.name,
        method: ep.method,
        statusCode: result.statusCode,
        latencyMs: result.latencyMs,
        timestamp: Date.now(),
        error: result.error,
      });
    }
  }

  // Ramp up workers progressively
  const workers: Promise<void>[] = [];
  const rampInterval = (config.rampUpSec * 1000) / maxWorkers;

  for (let i = 0; i < maxWorkers; i++) {
    workers.push(worker(i));
    activeWorkers++;
    if (i < maxWorkers - 1 && rampInterval > 0) {
      await new Promise(r => setTimeout(r, rampInterval));
    }
  }

  await Promise.all(workers);
  const actualDurationMs = Date.now() - startTime;

  // Collect memory after
  const memAfter = await getServerMemory(config.baseUrl);

  // SSE test
  const sseResult = await testSSEConnections(config.baseUrl, 55);

  // Compute stats per endpoint
  const byEndpoint = new Map<string, RequestMetric[]>();
  for (const m of metrics) {
    if (!byEndpoint.has(m.endpoint)) byEndpoint.set(m.endpoint, []);
    byEndpoint.get(m.endpoint)!.push(m);
  }

  const endpointStats: EndpointStats[] = [];
  for (const [name, epMetrics] of byEndpoint) {
    const latencies = epMetrics.map(m => m.latencyMs).sort((a, b) => a - b);
    const successes = epMetrics.filter(m => m.statusCode >= 200 && m.statusCode < 400);
    const errors = epMetrics.filter(m => m.statusCode === 0 || m.statusCode >= 400);

    endpointStats.push({
      endpoint: name,
      totalRequests: epMetrics.length,
      successCount: successes.length,
      errorCount: errors.length,
      avgLatencyMs: Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
      p50LatencyMs: percentile(latencies, 50),
      p95LatencyMs: percentile(latencies, 95),
      p99LatencyMs: percentile(latencies, 99),
      maxLatencyMs: latencies[latencies.length - 1] ?? 0,
      minLatencyMs: latencies[0] ?? 0,
      requestsPerSec: Math.round((epMetrics.length / actualDurationMs) * 1000 * 10) / 10,
    });
  }

  // Overall stats
  const allLatencies = metrics.map(m => m.latencyMs).sort((a, b) => a - b);
  const totalSuccesses = metrics.filter(m => m.statusCode >= 200 && m.statusCode < 400).length;

  // Peak RPS (1-second window)
  const secondBuckets = new Map<number, number>();
  for (const m of metrics) {
    const sec = Math.floor(m.timestamp / 1000);
    secondBuckets.set(sec, (secondBuckets.get(sec) ?? 0) + 1);
  }
  const peakRps = Math.max(...secondBuckets.values(), 0);

  const report: LoadTestReport = {
    config,
    summary: {
      totalRequests: metrics.length,
      totalSuccesses,
      totalErrors: metrics.length - totalSuccesses,
      overallAvgLatencyMs: Math.round(allLatencies.reduce((a, b) => a + b, 0) / (allLatencies.length || 1)),
      overallP95LatencyMs: percentile(allLatencies, 95),
      overallP99LatencyMs: percentile(allLatencies, 99),
      peakRps,
      avgRps: Math.round((metrics.length / actualDurationMs) * 1000 * 10) / 10,
      durationMs: actualDurationMs,
    },
    endpoints: endpointStats.sort((a, b) => b.totalRequests - a.totalRequests),
    sseTest: sseResult,
    memoryUsage: {
      startMB: memBefore,
      endMB: memAfter,
      deltaMB: Math.round((memAfter - memBefore) * 10) / 10,
    },
    timestamp: new Date().toISOString(),
  };

  return report;
}

async function getServerMemory(baseUrl: string): Promise<number> {
  try {
    const res = await fetch(`${baseUrl}/health`);
    const data = await res.json() as any;
    // Health endpoint may not have memory info, estimate from process
    return Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 10) / 10;
  } catch {
    return 0;
  }
}

function printReport(report: LoadTestReport): void {
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('              📊 LOAD TEST REPORT');
  console.log('═══════════════════════════════════════════════════════════════');

  console.log('\n📋 CONFIGURATION');
  console.log(`   Target:        ${report.config.baseUrl}`);
  console.log(`   Concurrency:   ${report.config.concurrent} workers`);
  console.log(`   Duration:      ${(report.summary.durationMs / 1000).toFixed(1)}s`);

  console.log('\n📈 OVERALL RESULTS');
  console.log(`   Total Requests:    ${report.summary.totalRequests}`);
  console.log(`   Successes:         ${report.summary.totalSuccesses} (${((report.summary.totalSuccesses / report.summary.totalRequests) * 100).toFixed(1)}%)`);
  console.log(`   Errors:            ${report.summary.totalErrors}`);
  console.log(`   Avg Latency:       ${report.summary.overallAvgLatencyMs}ms`);
  console.log(`   P95 Latency:       ${report.summary.overallP95LatencyMs}ms`);
  console.log(`   P99 Latency:       ${report.summary.overallP99LatencyMs}ms`);
  console.log(`   Avg RPS:           ${report.summary.avgRps}`);
  console.log(`   Peak RPS:          ${report.summary.peakRps}`);

  console.log('\n📊 PER-ENDPOINT BREAKDOWN');
  console.log(`   ${'Endpoint'.padEnd(35)} ${'Reqs'.padStart(6)} ${'OK%'.padStart(6)} ${'Avg'.padStart(6)} ${'P95'.padStart(6)} ${'P99'.padStart(6)} ${'Max'.padStart(6)}`);
  console.log(`   ${'─'.repeat(35)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(6)} ${'─'.repeat(6)}`);
  for (const ep of report.endpoints) {
    const okPct = ep.totalRequests > 0 ? ((ep.successCount / ep.totalRequests) * 100).toFixed(0) : '0';
    console.log(
      `   ${ep.endpoint.padEnd(35)} ${String(ep.totalRequests).padStart(6)} ${(okPct + '%').padStart(6)} ` +
      `${(ep.avgLatencyMs + 'ms').padStart(6)} ${(ep.p95LatencyMs + 'ms').padStart(6)} ` +
      `${(ep.p99LatencyMs + 'ms').padStart(6)} ${(ep.maxLatencyMs + 'ms').padStart(6)}`
    );
  }

  console.log('\n📡 SSE CONNECTION TEST');
  console.log(`   Max Concurrent:    ${report.sseTest.maxConcurrentConnections}`);
  console.log(`   Accepted:          ${report.sseTest.connectionSuccesses}`);
  console.log(`   Rejected (>50):    ${report.sseTest.connectionRejections}`);
  console.log(`   Avg Connect Time:  ${report.sseTest.avgConnectionTimeMs}ms`);

  console.log('\n💾 MEMORY');
  console.log(`   Start:  ${report.memoryUsage.startMB} MB`);
  console.log(`   End:    ${report.memoryUsage.endMB} MB`);
  console.log(`   Delta:  ${report.memoryUsage.deltaMB > 0 ? '+' : ''}${report.memoryUsage.deltaMB} MB`);

  // Verdict
  console.log('\n🏁 VERDICT');
  const p95 = report.summary.overallP95LatencyMs;
  const errorRate = report.summary.totalErrors / report.summary.totalRequests;
  const sseOk = report.sseTest.connectionSuccesses >= 50;

  if (p95 < 100 && errorRate < 0.01 && sseOk) {
    console.log('   ✅ PASS — All metrics within acceptable ranges');
  } else {
    const issues: string[] = [];
    if (p95 >= 100) issues.push(`P95 latency ${p95}ms exceeds 100ms threshold`);
    if (errorRate >= 0.01) issues.push(`Error rate ${(errorRate * 100).toFixed(1)}% exceeds 1% threshold`);
    if (!sseOk) issues.push(`SSE limit: only ${report.sseTest.connectionSuccesses}/50 connections accepted`);
    console.log(`   ⚠️  CONCERNS — ${issues.join('; ')}`);
  }

  console.log('\n═══════════════════════════════════════════════════════════════\n');
}

/* ---- Entry point ---- */

runLoadTest()
  .then(async (report) => {
    printReport(report);
    // Write JSON report
    const reportPath = `load-test-report-${Date.now()}.json`;
    const fs = await import('node:fs');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Full report saved to: ${reportPath}`);
    process.exit(report.summary.totalErrors > report.summary.totalRequests * 0.05 ? 1 : 0);
  })
  .catch((err) => {
    console.error('Load test failed:', err);
    process.exit(1);
  });
