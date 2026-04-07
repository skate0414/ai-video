import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, basename, extname, resolve } from 'node:path';
import type { Workbench } from '../workbench.js';
import type { ProviderId, ChatMode, ProviderSelectors } from '../types.js';
import {
  json, parseJsonBody, readBody, type Route,
  MAX_UPLOAD_SIZE, ALLOWED_UPLOAD_EXTENSIONS, MAX_SINGLE_FILE_BYTES,
} from './helpers.js';

export function workbenchRoutes(workbench: Workbench, uploadDir: string): Route[] {
  return [
    /* ---- State ---- */
    {
      method: 'GET',
      pattern: /^\/api\/state$/,
      handler: (_req, res) => json(res, 200, workbench.getState()),
    },

    /* ---- Tasks ---- */
    {
      method: 'POST',
      pattern: /^\/api\/tasks$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{
          questions: string[];
          preferredProvider?: ProviderId;
          preferredModel?: string;
          attachments?: string[];
        }>(req);
        const tasks = workbench.tasks.add(
          body.questions,
          body.preferredProvider,
          body.preferredModel,
          body.attachments,
        );
        json(res, 201, tasks);
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/tasks\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const ok = workbench.tasks.remove(match.groups!.id);
        json(res, ok ? 200 : 404, { ok });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/tasks\/clear$/,
      handler: (_req, res) => {
        workbench.tasks.clear();
        json(res, 200, { ok: true });
      },
    },

    /* ---- File upload ---- */
    {
      method: 'POST',
      pattern: /^\/api\/upload$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{
          files: Array<{ name: string; data: string }>;
        }>(req, MAX_UPLOAD_SIZE);
        if (!body.files?.length) return json(res, 400, { error: 'No files provided' });
        if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

        const savedPaths: string[] = [];
        for (const file of body.files) {
          const safeName = basename(file.name).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
          const ext = extname(safeName).toLowerCase();
          if (!ALLOWED_UPLOAD_EXTENSIONS.has(ext)) {
            return json(res, 400, { error: `File type not allowed: ${ext}` });
          }
          const decoded = Buffer.from(file.data, 'base64');
          if (decoded.length > MAX_SINGLE_FILE_BYTES) {
            return json(res, 400, { error: `File exceeds 50 MB limit: ${file.name}` });
          }
          const nameWithoutExt = safeName.slice(0, safeName.length - ext.length) || 'file';
          const uniqueName = `${Date.now()}_${nameWithoutExt}${ext}`;
          const filePath = join(uploadDir, uniqueName);
          writeFileSync(filePath, decoded);
          savedPaths.push(resolve(filePath));
        }
        json(res, 200, { paths: savedPaths });
      },
    },

    /* ---- Accounts ---- */
    {
      method: 'POST',
      pattern: /^\/api\/accounts$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{
          provider: ProviderId;
          label: string;
          profileDir: string;
        }>(req);
        const acc = workbench.accounts.addAccount(body.provider, body.label, body.profileDir);
        json(res, 201, acc);
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/accounts\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const ok = workbench.accounts.removeAccount(match.groups!.id);
        json(res, ok ? 200 : 404, { ok });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/accounts\/reset-quotas$/,
      handler: (_req, res) => {
        workbench.accounts.resetAllQuotas();
        json(res, 200, { ok: true });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/accounts\/(?<id>[^/]+)\/login$/,
      handler: async (_req, res, match) => {
        try {
          await workbench.openLoginBrowser(match.groups!.id);
          json(res, 200, { ok: true });
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/accounts\/(?<id>[^/]+)\/close-login$/,
      handler: async (_req, res, match) => {
        await workbench.closeLoginBrowser(match.groups!.id);
        json(res, 200, { ok: true });
      },
    },

    /* ---- Chat mode ---- */
    {
      method: 'POST',
      pattern: /^\/api\/chat-mode$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{ mode: string }>(req);
        if (body.mode !== 'new' && body.mode !== 'continue') {
          return json(res, 400, { error: 'Invalid mode. Must be "new" or "continue".' });
        }
        workbench.setChatMode(body.mode as ChatMode);
        json(res, 200, { ok: true });
      },
    },

    /* ---- Control ---- */
    {
      method: 'POST',
      pattern: /^\/api\/start$/,
      handler: (_req, res) => {
        workbench.start().catch((err) => console.error('[workbench] loop error:', err));
        json(res, 200, { ok: true });
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/stop$/,
      handler: (_req, res) => {
        workbench.stop();
        json(res, 200, { ok: true });
      },
    },

    /* ---- Providers ---- */
    {
      method: 'GET',
      pattern: /^\/api\/providers$/,
      handler: (_req, res) => {
        const providers = workbench.getProviderList().map((p) => ({
          ...p,
          selectors: (() => { try { return workbench.getSelectors(p.id); } catch { return null; } })(),
          models: workbench.getModels(p.id),
        }));
        json(res, 200, providers);
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/providers$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{
          id: string;
          label: string;
          selectors: Record<string, string>;
        }>(req);
        if (!body.id?.trim() || !body.label?.trim() || !body.selectors?.chatUrl) {
          return json(res, 400, { error: 'id, label, and selectors.chatUrl are required' });
        }
        try {
          const info = workbench.addCustomProvider(
            body.id.trim(),
            body.label.trim(),
            body.selectors as unknown as ProviderSelectors,
          );
          json(res, 201, info);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/providers\/from-url$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{ chatUrl: string }>(req);
        if (!body.chatUrl?.trim()) return json(res, 400, { error: 'chatUrl is required' });
        try {
          const result = await workbench.addProviderFromUrl(body.chatUrl.trim());
          json(res, 201, result);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/providers\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const ok = workbench.removeCustomProvider(decodeURIComponent(match.groups!.id));
        json(res, ok ? 200 : 404, { ok });
      },
    },

    /* ---- Models ---- */
    {
      method: 'GET',
      pattern: /^\/api\/models\/(?<provider>[^/]+)$/,
      handler: (_req, res, match) => {
        json(res, 200, workbench.getModels(match.groups!.provider as ProviderId));
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/models\/(?<provider>[^/]+)$/,
      handler: async (_req, res, match) => {
        try {
          const models = await workbench.detectModels(match.groups!.provider as ProviderId);
          json(res, 200, models);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },
  ];
}
