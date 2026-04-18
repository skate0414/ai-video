import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '../registry.js';

/*
 * These tests validate the concrete plugin descriptors by importing
 * them via the side-effect barrel and verifying they self-register
 * with correct capabilities.
 */

describe('Concrete plugin descriptors', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    // Create a fresh registry and manually register each plugin
    // (avoids side-effect import pollution of the global registry across tests)
    registry = new PluginRegistry();
  });

  describe('gemini-api', () => {
    it('declares correct capabilities', async () => {
      const mod = await import('../plugins/gemini-api.js');
      const plugin = mod.default;
      registry.register(plugin);

      expect(plugin.id).toBe('gemini-api');
      expect(plugin.adapterType).toBe('api');
      expect(plugin.costTier).toBe('paid');
      expect(plugin.capabilities.text).toBe(true);
      expect(plugin.capabilities.imageGeneration).toBe(true);
      expect(plugin.capabilities.videoGeneration).toBe(true);
      expect(plugin.capabilities.tts).toBe(true);
      expect(plugin.capabilities.fileUpload).toBe(true);
      expect(plugin.models).toContain('gemini-3.1-pro-preview');
      expect(plugin.models).toContain('veo-3.1');
      expect(plugin.routing).toBeDefined();
      expect(plugin.routing!.length).toBeGreaterThan(0);
    });

    it('createAdapter returns deps.apiAdapter', async () => {
      const mod = await import('../plugins/gemini-api.js');
      const plugin = mod.default;
      const mockAdapter = { provider: 'gemini-api', generateText: async () => ({ text: '' }), generateImage: async () => ({ text: '' }), generateVideo: async () => ({ text: '' }) } as any;
      const result = plugin.createAdapter({ apiAdapter: mockAdapter });
      expect(result).toBe(mockAdapter);
    });

    it('createAdapter returns undefined when no apiAdapter provided', async () => {
      const mod = await import('../plugins/gemini-api.js');
      const plugin = mod.default;
      expect(plugin.createAdapter({})).toBeUndefined();
    });
  });

  describe('gemini-chat', () => {
    it('declares correct capabilities', async () => {
      const mod = await import('../plugins/gemini-chat.js');
      const plugin = mod.default;

      expect(plugin.id).toBe('gemini-chat');
      expect(plugin.adapterType).toBe('chat');
      expect(plugin.costTier).toBe('free');
      expect(plugin.capabilities.text).toBe(true);
      expect(plugin.capabilities.imageGeneration).toBe(true);
      expect(plugin.capabilities.videoGeneration).toBe(false);
      expect(plugin.capabilities.fileUpload).toBe(true);
      expect(plugin.capabilities.webSearch).toBe(true);
    });

    it('createAdapter returns deps.chatAdapter', async () => {
      const mod = await import('../plugins/gemini-chat.js');
      const plugin = mod.default;
      const mockAdapter = { provider: 'chat', generateText: async () => ({ text: '' }), generateImage: async () => ({ text: '' }), generateVideo: async () => ({ text: '' }) } as any;
      expect(plugin.createAdapter({ chatAdapter: mockAdapter })).toBe(mockAdapter);
    });
  });

  describe('chatgpt-chat', () => {
    it('declares correct capabilities', async () => {
      const mod = await import('../plugins/chatgpt-chat.js');
      const plugin = mod.default;

      expect(plugin.id).toBe('chatgpt-chat');
      expect(plugin.adapterType).toBe('chat');
      expect(plugin.costTier).toBe('free');
      expect(plugin.capabilities.text).toBe(true);
      expect(plugin.capabilities.imageGeneration).toBe(true);
      expect(plugin.capabilities.videoGeneration).toBe(false);
      expect(plugin.capabilities.tts).toBe(false);
    });

    it('has routing rules for image generation stages', async () => {
      const mod = await import('../plugins/chatgpt-chat.js');
      const plugin = mod.default;
      const imageRoutes = plugin.routing?.filter((r: any) =>
        r.taskTypes?.includes('image_generation'),
      );
      expect(imageRoutes?.length).toBeGreaterThan(0);
    });
  });

  describe('kling-chat', () => {
    it('declares video generation capability only', async () => {
      const mod = await import('../plugins/kling-chat.js');
      const plugin = mod.default;

      expect(plugin.id).toBe('kling-chat');
      expect(plugin.capabilities.videoGeneration).toBe(true);
      expect(plugin.capabilities.text).toBe(false);
      expect(plugin.capabilities.imageGeneration).toBe(false);
      expect(plugin.capabilities.tts).toBe(false);
      expect(plugin.costTier).toBe('free');
    });
  });

  describe('edge-tts', () => {
    it('declares TTS capability only', async () => {
      const mod = await import('../plugins/edge-tts.js');
      const plugin = mod.default;

      expect(plugin.id).toBe('edge-tts');
      expect(plugin.capabilities.tts).toBe(true);
      expect(plugin.capabilities.text).toBe(false);
      expect(plugin.capabilities.imageGeneration).toBe(false);
      expect(plugin.capabilities.videoGeneration).toBe(false);
      expect(plugin.costTier).toBe('free');
    });

    it('has routing rules for TTS stage', async () => {
      const mod = await import('../plugins/edge-tts.js');
      const plugin = mod.default;
      const ttsRoutes = plugin.routing?.filter((r: any) =>
        r.taskTypes?.includes('tts'),
      );
      expect(ttsRoutes?.length).toBeGreaterThan(0);
    });
  });

  describe('side-effect auto-registration', () => {
    it('all plugins register in global registry', async () => {
      // Import the barrel — triggers all side-effect registrations
      const { getGlobalPluginRegistry } = await import('../registry.js');
      await import('../plugins/index.js');

      const global = getGlobalPluginRegistry();
      const all = global.getAll();

      // Should have at least the 5 built-in plugins
      expect(all.length).toBeGreaterThanOrEqual(5);
      const ids = all.map(p => p.id);
      expect(ids).toContain('gemini-api');
      expect(ids).toContain('gemini-chat');
      expect(ids).toContain('chatgpt-chat');
      expect(ids).toContain('kling-chat');
      expect(ids).toContain('edge-tts');
    });
  });
});
