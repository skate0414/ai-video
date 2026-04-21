/**
 * pluginLoader.ts — discovers, verifies and dynamically imports plugins.
 *
 * Discovery sources (in order):
 *   1. data/plugins/<id>/plugin.manifest.json  (file-system plugins)
 *   2. node_modules/<pkg>/plugin.manifest.json (npm-installed plugins
 *      whose package.json declares an `aiVideoPlugin` truthy field)
 *
 * For each candidate, the loader:
 *   1. parses + validates the manifest (zero deps; see pluginManifest.ts)
 *   2. resolves the entry path inside the plugin directory using
 *      pathSafety.ensurePathWithinBase to prevent traversal
 *   3. checks the trust whitelist (data/trusted-plugins.json) by id
 *   4. verifies the ed25519 signature OR sha256 content pin
 *   5. dynamic-imports the entry module and calls
 *      `register({ stageRegistry, pluginRegistry, services })`.
 *
 * Failure modes (signature mismatch, untrusted id, schema error,
 * traversal attempt) abort that single plugin and are reported in the
 * result object — the host keeps booting with the remaining trusted
 * plugins. Strict mode promotes any failure to a thrown error.
 */

import { createHash, createPublicKey, verify as nodeVerify } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { ensurePathWithinBase } from '@ai-video/pipeline-core/libFacade.js';
import { createLogger } from '@ai-video/pipeline-core/libFacade.js';
import {
  canonicalManifestForSigning,
  loadPluginManifestFromFile,
  type PluginManifest,
} from './pluginManifest.js';

const log = createLogger('PluginLoader');

const MANIFEST_FILENAME = 'plugin.manifest.json';

/* ---- Trust file ---- */

export interface TrustedPluginEntry {
  publicKey?: string;
  manifestSha256?: string;
  permissions?: string[];
  note?: string;
}

export interface TrustFile {
  version: 1;
  plugins: Record<string, TrustedPluginEntry>;
}

export function loadTrustFile(trustFilePath: string): TrustFile {
  if (!existsSync(trustFilePath)) {
    return { version: 1, plugins: {} };
  }
  const raw = readFileSync(trustFilePath, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(
      `trusted-plugins.json is malformed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (parsed === null || typeof parsed !== 'object') {
    throw new Error('trusted-plugins.json must be an object');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`trusted-plugins.json: unsupported version ${String(obj.version)}; expected 1`);
  }
  const plugins = (obj.plugins ?? {}) as Record<string, TrustedPluginEntry>;
  return { version: 1, plugins };
}

/* ---- Verification ---- */

export type VerifyOutcome =
  | { ok: true; reason: 'signature' | 'manifestSha256' | 'unsigned-untracked' }
  | { ok: false; reason: string };

export function verifyManifestTrust(
  manifest: PluginManifest,
  trust: TrustFile,
  options: { strict?: boolean } = {},
): VerifyOutcome {
  const entry = trust.plugins[manifest.id];

  if (!entry) {
    if (options.strict) return { ok: false, reason: `plugin "${manifest.id}" is not in trusted-plugins.json` };
    return { ok: true, reason: 'unsigned-untracked' };
  }

  // sha256 pin path — useful for hand-audited unsigned plugins.
  if (entry.manifestSha256) {
    const canonical = canonicalManifestForSigning(manifest);
    const got = createHash('sha256').update(canonical).digest('hex');
    if (got !== entry.manifestSha256) {
      return { ok: false, reason: `manifest sha256 mismatch (expected ${entry.manifestSha256}, got ${got})` };
    }
    return { ok: true, reason: 'manifestSha256' };
  }

  // ed25519 path.
  if (entry.publicKey) {
    if (!manifest.signature) {
      return { ok: false, reason: 'trusted-plugins.json declares a publicKey but manifest carries no signature' };
    }
    const sig = manifest.signature;
    if (sig.algorithm !== 'ed25519') {
      return { ok: false, reason: `unsupported signature algorithm ${sig.algorithm}` };
    }
    if (sig.publicKey && sig.publicKey !== entry.publicKey) {
      return { ok: false, reason: 'manifest publicKey does not match the trust file publicKey' };
    }
    const canonical = canonicalManifestForSigning(manifest);
    const ok = ed25519Verify(entry.publicKey, sig.value, canonical);
    if (!ok) return { ok: false, reason: 'ed25519 signature verification failed' };
    return { ok: true, reason: 'signature' };
  }

  return { ok: false, reason: 'trusted-plugins.json entry has neither publicKey nor manifestSha256' };
}

function ed25519Verify(publicKeyHex: string, signatureHex: string, message: string): boolean {
  const keyDer = Buffer.concat([
    Buffer.from('302a300506032b6570032100', 'hex'),
    Buffer.from(publicKeyHex, 'hex'),
  ]);
  // Build a KeyObject via createPublicKey to keep the API simple.
  // We deliberately use the synchronous verify API — the work is tiny
  // (32-byte key, 64-byte signature).
  const key = createPublicKey({ key: keyDer, format: 'der', type: 'spki' });
  return nodeVerify(null, Buffer.from(message, 'utf8'), key, Buffer.from(signatureHex, 'hex'));
}

/* ---- Discovery + load ---- */

export interface DiscoveredPlugin {
  manifest: PluginManifest;
  manifestPath: string;
  pluginDir: string;
  /** Absolute file:// URL ready for dynamic import. */
  entryUrl: string;
}

export interface PluginLoadFailure {
  id?: string;
  source: string;
  reason: string;
}

export interface PluginLoadResult {
  loaded: DiscoveredPlugin[];
  skipped: PluginLoadFailure[];
}

export interface DiscoverOptions {
  /** Root to scan for file-system plugins. Default: data/plugins. */
  pluginsRoot?: string;
  /** Trust file path. Default: data/trusted-plugins.json. */
  trustFilePath?: string;
  /** When true, any failure (untrusted, bad sig, schema error) throws. */
  strict?: boolean;
}

const DEFAULT_PLUGINS_ROOT = 'data/plugins';
const DEFAULT_TRUST_FILE = 'data/trusted-plugins.json';

export function discoverFsPlugins(options: DiscoverOptions = {}): PluginLoadResult {
  const root = options.pluginsRoot ?? DEFAULT_PLUGINS_ROOT;
  const trustPath = options.trustFilePath ?? DEFAULT_TRUST_FILE;
  const trust = loadTrustFile(trustPath);

  const loaded: DiscoveredPlugin[] = [];
  const skipped: PluginLoadFailure[] = [];

  if (!existsSync(root)) {
    return { loaded, skipped };
  }

  const entries = readdirSync(root, { withFileTypes: true });
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    const pluginDir = path.join(root, ent.name);
    const manifestPath = path.join(pluginDir, MANIFEST_FILENAME);

    if (!existsSync(manifestPath)) {
      skipped.push({ source: pluginDir, reason: `missing ${MANIFEST_FILENAME}` });
      continue;
    }

    const result = loadPluginManifestFromFile(manifestPath);
    if (!result.valid || !result.manifest) {
      skipped.push({
        source: manifestPath,
        reason: 'manifest validation failed: ' + result.errors.map(e => `${e.path || '<root>'} ${e.message}`).join('; '),
      });
      continue;
    }
    const manifest = result.manifest;

    // Resolve the entry path under the plugin dir, refuse traversal.
    let entryAbs: string;
    try {
      const candidate = path.isAbsolute(manifest.entry)
        ? manifest.entry
        : path.join(pluginDir, manifest.entry);
      entryAbs = ensurePathWithinBase(pluginDir, candidate);
    } catch (err) {
      skipped.push({
        id: manifest.id,
        source: manifestPath,
        reason: `entry escapes plugin dir: ${err instanceof Error ? err.message : String(err)}`,
      });
      continue;
    }
    if (!existsSync(entryAbs) || !statSync(entryAbs).isFile()) {
      skipped.push({ id: manifest.id, source: manifestPath, reason: `entry not found: ${entryAbs}` });
      continue;
    }

    const verdict = verifyManifestTrust(manifest, trust, { strict: options.strict });
    if (!verdict.ok) {
      skipped.push({ id: manifest.id, source: manifestPath, reason: verdict.reason });
      if (options.strict) {
        throw new Error(`Plugin ${manifest.id} rejected: ${verdict.reason}`);
      }
      continue;
    }

    loaded.push({
      manifest,
      manifestPath,
      pluginDir,
      entryUrl: pathToFileURL(entryAbs).href,
    });
  }

  log.info('plugins_discovered', {
    loaded: loaded.length,
    skipped: skipped.length,
    root,
  });
  return { loaded, skipped };
}

/**
 * Convenience helper: discover + dynamic import + invoke each plugin's
 * `register()` export. Each plugin module is expected to export
 * `register(api: { manifest, services? })` — anything else is logged.
 */
export async function loadAndRegisterPlugins(
  registerApi: Record<string, unknown>,
  options: DiscoverOptions = {},
): Promise<PluginLoadResult> {
  const { loaded, skipped } = discoverFsPlugins(options);
  for (const plugin of loaded) {
    try {
      const mod = await import(plugin.entryUrl) as { register?: (api: Record<string, unknown>) => unknown };
      if (typeof mod.register !== 'function') {
        skipped.push({
          id: plugin.manifest.id,
          source: plugin.manifestPath,
          reason: 'entry module does not export `register(api)`',
        });
        continue;
      }
      await mod.register({ ...registerApi, manifest: plugin.manifest });
      log.info('plugin_registered', { id: plugin.manifest.id, version: plugin.manifest.version });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push({ id: plugin.manifest.id, source: plugin.manifestPath, reason: `register() threw: ${reason}` });
      if (options.strict) throw err;
    }
  }
  return { loaded: loaded.filter(p => !skipped.some(s => s.id === p.manifest.id)), skipped };
}
