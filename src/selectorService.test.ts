import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SelectorService } from './selectorService.js';
import { WB_EVENT } from './types.js';
import { CustomProviderStore } from './customProviderStore.js';

describe('SelectorService', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'selector-service-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function makeService(options?: {
    cacheFile?: string;
    resources?: Array<any>;
    customSetup?: (store: CustomProviderStore) => void;
  }) {
    const cacheFile = options?.cacheFile ?? join(tempDir, 'selector-cache.json');
    const providerFile = join(tempDir, 'providers.json');
    const customStore = new CustomProviderStore(providerFile);
    options?.customSetup?.(customStore);

    const resources = options?.resources ?? [];
    const sink = {
      emit: vi.fn(),
      emitState: vi.fn(),
    };

    const svc = new SelectorService(
      cacheFile,
      customStore,
      { all: () => resources } as any,
      sink,
    );

    return { svc, sink, customStore, resources, cacheFile };
  }

  it('uses preset selectors for builtin providers', () => {
    const { svc } = makeService();
    const sel = svc.getSelectors('chatgpt');
    expect(sel.chatUrl).toContain('chatgpt');
    expect(sel.promptInput.length).toBeGreaterThan(0);
  });

  it('loads custom provider selectors when no preset exists', () => {
    const { svc } = makeService({
      customSetup: (store) => {
        store.set('myprovider', {
          label: 'My Provider',
          selectors: {
            chatUrl: 'https://my.chat',
            promptInput: 'textarea',
            responseBlock: '.resp',
            readyIndicator: 'textarea',
          },
        });
      },
    });

    const sel = svc.getSelectors('myprovider' as any);
    expect(sel.chatUrl).toBe('https://my.chat');
    expect(sel.responseBlock).toBe('.resp');
  });

  it('applies detected selectors, updates resources, emits events', () => {
    const resource = { provider: 'myprovider', selectors: {} as Record<string, string> };
    const { svc, sink, customStore } = makeService({
      resources: [resource],
      customSetup: (store) => {
        store.set('myprovider', {
          label: 'My Provider',
          selectors: {
            chatUrl: 'https://my.chat',
            promptInput: 'textarea',
            responseBlock: '.resp',
            readyIndicator: 'textarea',
          },
        });
      },
    });

    svc.applyDetectedSelectors('myprovider' as any, {
      promptInput: '#prompt',
      sendButton: '#send',
      responseBlock: '#resp',
      readyIndicator: '#ready',
      fileUploadTrigger: '#upload',
    });

    expect(resource.selectors.promptInput).toBe('#prompt');
    expect(resource.selectors.sendButton).toBe('#send');
    expect(resource.selectors.responseBlock).toBe('#resp');
    expect(resource.selectors.readyIndicator).toBe('#ready');
    expect(resource.selectors.imageUploadTrigger).toBe('#upload');

    const updatedCustom = customStore.get('myprovider')!;
    expect(updatedCustom.selectors.promptInput).toBe('#prompt');

    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({ type: WB_EVENT.SELECTORS_UPDATED }));
    expect(sink.emitState).toHaveBeenCalled();
  });

  it('applies detected video selectors and updates mapped resource fields', () => {
    const resource = { provider: 'myprovider', selectors: {} as Record<string, string> };
    const { svc, sink } = makeService({ resources: [resource] });

    svc.applyDetectedVideoSelectors('myprovider' as any, {
      promptInput: '#prompt',
      generateButton: '#generate',
      imageUploadTrigger: '#upload',
      videoResult: '#video',
      progressIndicator: '#progress',
      downloadButton: '#download',
    });

    expect(resource.selectors.promptInput).toBe('#prompt');
    expect(resource.selectors.generateButton).toBe('#generate');
    expect(resource.selectors.imageUploadTrigger).toBe('#upload');
    expect(resource.selectors.resultElement).toBe('#video');
    expect(resource.selectors.progressIndicator).toBe('#progress');
    expect(resource.selectors.downloadButton).toBe('#download');
    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({ type: WB_EVENT.SELECTORS_UPDATED }));
  });

  it('loads cached selector chains and ignores risky builtin selector overrides', () => {
    const cacheFile = join(tempDir, 'selector-cache.json');
    writeFileSync(cacheFile, JSON.stringify({
      chatgpt: {
        selectors: {
          promptInput: '#bad-prompt',
          responseBlock: '#bad-response',
          readyIndicator: '#bad-ready',
          sendButton: '#ok-send',
        },
        chains: {
          promptInput: [{ selector: '#from-cache', method: 'css', priority: 1 }],
        },
        detectedAt: new Date().toISOString(),
      },
    }));

    const { svc } = makeService({ cacheFile });
    const selectors = svc.getSelectors('chatgpt');

    // builtin prompt/response/ready should not be restored from cache
    expect(selectors.promptInput).not.toBe('#bad-prompt');
    expect(selectors.responseBlock).not.toBe('#bad-response');
    expect(selectors.readyIndicator).not.toBe('#bad-ready');

    // non-risky fields can still override
    expect(selectors.sendButton).toBe('#ok-send');

    const chain = svc.getSelectorChain('chatgpt', 'promptInput');
    expect(chain?.[0]?.selector).toBe('#from-cache');
  });
});
