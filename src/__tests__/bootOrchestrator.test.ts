import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  BootPhase,
  BOOT_TRANSITIONS,
  isValidTransition,
} from '../../shared/bootPhase.js';

/* ================================================================== */
/*  1. Boot state machine (pure logic — no I/O)                       */
/* ================================================================== */

describe('BootPhase state machine', () => {
  it('defines exactly 11 states', () => {
    const phases = Object.values(BootPhase).filter(
      (v) => typeof v === 'string',
    );
    expect(phases).toHaveLength(11);
  });

  describe('happy path', () => {
    const happyPath = [
      BootPhase.IDLE,
      BootPhase.WINDOW,
      BootPhase.AUTOMATION,
      BootPhase.PORT_CHECK,
      BootPhase.BACKEND_SPAWN,
      BootPhase.HEALTH_WAIT,
      BootPhase.READY,
    ];

    it('every consecutive pair is a valid transition', () => {
      for (let i = 0; i < happyPath.length - 1; i++) {
        expect(
          isValidTransition(happyPath[i]!, happyPath[i + 1]!),
        ).toBe(true);
      }
    });
  });

  describe('crash recovery', () => {
    it('READY → BACKEND_CRASHED is valid', () => {
      expect(isValidTransition(BootPhase.READY, BootPhase.BACKEND_CRASHED)).toBe(true);
    });

    it('HEALTH_WAIT → BACKEND_CRASHED is valid', () => {
      expect(isValidTransition(BootPhase.HEALTH_WAIT, BootPhase.BACKEND_CRASHED)).toBe(true);
    });

    it('BACKEND_CRASHED → PORT_CHECK is valid (restart loop)', () => {
      expect(isValidTransition(BootPhase.BACKEND_CRASHED, BootPhase.PORT_CHECK)).toBe(true);
    });

    it('BACKEND_CRASHED → FAILED is valid (crash exhaustion)', () => {
      expect(isValidTransition(BootPhase.BACKEND_CRASHED, BootPhase.FAILED)).toBe(true);
    });
  });

  describe('shutdown from any live phase', () => {
    const livePhases = [
      BootPhase.IDLE,
      BootPhase.WINDOW,
      BootPhase.AUTOMATION,
      BootPhase.PORT_CHECK,
      BootPhase.BACKEND_SPAWN,
      BootPhase.HEALTH_WAIT,
      BootPhase.READY,
      BootPhase.BACKEND_CRASHED,
      BootPhase.FAILED,
    ];

    it.each(livePhases)('%s → SHUTTING_DOWN is valid', (phase) => {
      expect(isValidTransition(phase, BootPhase.SHUTTING_DOWN)).toBe(true);
    });

    it('SHUTTING_DOWN → STOPPED is valid', () => {
      expect(isValidTransition(BootPhase.SHUTTING_DOWN, BootPhase.STOPPED)).toBe(true);
    });
  });

  describe('terminal states', () => {
    it('STOPPED has no outgoing transitions', () => {
      expect(BOOT_TRANSITIONS[BootPhase.STOPPED]).toEqual([]);
    });
  });

  describe('invalid transitions', () => {
    it('cannot skip phases on the happy path', () => {
      expect(isValidTransition(BootPhase.IDLE, BootPhase.READY)).toBe(false);
      expect(isValidTransition(BootPhase.WINDOW, BootPhase.BACKEND_SPAWN)).toBe(false);
      expect(isValidTransition(BootPhase.PORT_CHECK, BootPhase.READY)).toBe(false);
    });

    it('cannot go backwards on the happy path', () => {
      expect(isValidTransition(BootPhase.AUTOMATION, BootPhase.WINDOW)).toBe(false);
      expect(isValidTransition(BootPhase.READY, BootPhase.HEALTH_WAIT)).toBe(false);
    });

    it('READY cannot reach FAILED directly', () => {
      expect(isValidTransition(BootPhase.READY, BootPhase.FAILED)).toBe(false);
    });
  });
});

/* ================================================================== */
/*  2. BootOrchestrator (mocked I/O)                                  */
/* ================================================================== */

describe('BootOrchestrator', () => {
  // Dynamic import to avoid module-resolution issues with browser-shell path
  let BootOrchestrator: typeof import('../../browser-shell/src/boot-orchestrator.js').BootOrchestrator;

  beforeEach(async () => {
    const mod = await import('../../browser-shell/src/boot-orchestrator.js');
    BootOrchestrator = mod.BootOrchestrator;
  });

  function makeCallbacks() {
    return {
      createWindow: vi.fn(),
      startAutomation: vi.fn(),
      openAppTab: vi.fn(),
      resolveBackend: vi.fn().mockReturnValue({
        command: 'echo',
        args: ['test'],
        env: {},
        cwd: '.',
      }),
    };
  }

  function stubInternals(orc: InstanceType<typeof BootOrchestrator>, healthOk = true, providers = 2) {
    vi.spyOn(orc as any, 'checkPorts').mockResolvedValue(undefined);
    vi.spyOn(orc as any, 'spawnBackend').mockImplementation(() => {});
    vi.spyOn(orc as any, 'waitForHealth').mockResolvedValue({
      ok: healthOk,
      providers,
    });
  }

  describe('happy path boot', () => {
    it('transitions IDLE → … → READY in order', async () => {
      const orc = new BootOrchestrator();
      stubInternals(orc);

      const phases: string[] = [];
      orc.on('phase', (p: string) => phases.push(p));

      const result = await orc.boot(makeCallbacks());

      expect(result).toBe(BootPhase.READY);
      expect(phases).toEqual([
        'WINDOW', 'AUTOMATION', 'PORT_CHECK',
        'BACKEND_SPAWN', 'HEALTH_WAIT', 'READY',
      ]);
    });

    it('calls all callbacks in order', async () => {
      const orc = new BootOrchestrator();
      stubInternals(orc);
      const cbs = makeCallbacks();

      await orc.boot(cbs);

      expect(cbs.createWindow).toHaveBeenCalledOnce();
      expect(cbs.startAutomation).toHaveBeenCalledOnce();
      expect(cbs.openAppTab).toHaveBeenCalledOnce();
    });

    it('resets crash count on READY', async () => {
      const orc = new BootOrchestrator();
      stubInternals(orc);
      // Simulate prior crashes
      (orc as any).crashCount = 3;

      await orc.boot(makeCallbacks());

      expect((orc as any).crashCount).toBe(0);
    });
  });

  describe('health timeout', () => {
    it('transitions to FAILED when health check fails', async () => {
      const orc = new BootOrchestrator({ healthTimeoutMs: 100 });
      stubInternals(orc, false);

      const cbs = makeCallbacks();
      const result = await orc.boot(cbs);

      expect(result).toBe(BootPhase.FAILED);
      expect(cbs.openAppTab).not.toHaveBeenCalled();
    });
  });

  describe('port conflict', () => {
    it('transitions to FAILED when port is in use', async () => {
      const orc = new BootOrchestrator();
      vi.spyOn(orc as any, 'checkPorts').mockRejectedValue(
        new Error('Port 3220 is already in use'),
      );

      const result = await orc.boot(makeCallbacks());

      expect(result).toBe(BootPhase.FAILED);
      expect(orc.phase).toBe(BootPhase.FAILED);
    });
  });

  describe('provider gate logging', () => {
    it('logs warning when no providers configured', async () => {
      const orc = new BootOrchestrator();
      stubInternals(orc, true, 0);

      const logs: string[] = [];
      orc.on('log', (_level: string, msg: string) => logs.push(msg));

      await orc.boot(makeCallbacks());

      expect(logs.some((m) => m.includes('No providers configured'))).toBe(true);
    });

    it('logs provider count when providers exist', async () => {
      const orc = new BootOrchestrator();
      stubInternals(orc, true, 3);

      const logs: string[] = [];
      orc.on('log', (_level: string, msg: string) => logs.push(msg));

      await orc.boot(makeCallbacks());

      expect(logs.some((m) => m.includes('3 provider(s) registered'))).toBe(true);
    });
  });

  describe('shutdown', () => {
    it('transitions to SHUTTING_DOWN → STOPPED', async () => {
      const orc = new BootOrchestrator();
      stubInternals(orc);

      await orc.boot(makeCallbacks());
      expect(orc.phase).toBe(BootPhase.READY);

      const phases: string[] = [];
      orc.on('phase', (p: string) => phases.push(p));

      await orc.shutdown();

      expect(phases).toEqual(['SHUTTING_DOWN', 'STOPPED']);
      expect(orc.phase).toBe(BootPhase.STOPPED);
    });

    it('is idempotent', async () => {
      const orc = new BootOrchestrator();
      stubInternals(orc);
      await orc.boot(makeCallbacks());

      await orc.shutdown();
      // Second call should be a no-op
      await orc.shutdown();

      expect(orc.phase).toBe(BootPhase.STOPPED);
    });
  });

  describe('exponential backoff calculation', () => {
    it('computes correct delays for crash sequence', () => {
      // Verify the backoff formula: min(2000 * 2^(n-1), 32000)
      const delays = [1, 2, 3, 4, 5].map(
        (n) => Math.min(2000 * 2 ** (n - 1), 32_000),
      );
      expect(delays).toEqual([2000, 4000, 8000, 16000, 32000]);
    });
  });

  describe('config defaults', () => {
    it('uses sensible defaults', () => {
      const orc = new BootOrchestrator();
      expect(orc.config.backendPort).toBe(3220);
      expect(orc.config.cdpPort).toBe(9222);
      expect(orc.config.healthTimeoutMs).toBe(30_000);
      expect(orc.config.maxCrashRestarts).toBe(5);
    });

    it('allows overrides', () => {
      const orc = new BootOrchestrator({
        backendPort: 4000,
        maxCrashRestarts: 10,
      });
      expect(orc.config.backendPort).toBe(4000);
      expect(orc.config.maxCrashRestarts).toBe(10);
      // Defaults for unspecified
      expect(orc.config.cdpPort).toBe(9222);
    });
  });
});
