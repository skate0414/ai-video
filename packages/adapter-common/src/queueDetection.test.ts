import { describe, it, expect } from 'vitest';
import {
  resolveQueueDetection,
  detectQueueStateFromText,
} from './queueDetection.js';
import type { QueueDetectionConfig } from '@ai-video/shared/types.js';

describe('resolveQueueDetection', () => {
  it('returns defaults when called with no arguments', () => {
    const result = resolveQueueDetection();
    expect(result.queueKeywords.length).toBeGreaterThan(0);
    expect(result.etaPatterns.length).toBeGreaterThan(0);
  });

  it('returns defaults when config is undefined', () => {
    const result = resolveQueueDetection(undefined);
    expect(result.queueKeywords).toContain('in queue');
    expect(result.queueKeywords).toContain('排队');
  });

  it('uses custom keywords when provided', () => {
    const config: QueueDetectionConfig = {
      queueKeywords: ['waiting', 'pending'],
      etaPatterns: [],
    };
    const result = resolveQueueDetection(config);
    expect(result.queueKeywords).toEqual(['waiting', 'pending']);
  });

  it('falls back to default keywords when empty array is provided', () => {
    const config: QueueDetectionConfig = { queueKeywords: [], etaPatterns: [] };
    const result = resolveQueueDetection(config);
    expect(result.queueKeywords.length).toBeGreaterThan(0);
  });

  it('uses custom eta patterns when provided', () => {
    const config: QueueDetectionConfig = {
      etaPatterns: [{ regex: '(\\d+) min', minutesGroup: 1 }],
    };
    const result = resolveQueueDetection(config);
    expect(result.etaPatterns).toHaveLength(1);
    expect(result.etaPatterns[0].regex).toBe('(\\d+) min');
  });

  it('falls back to default eta patterns when empty array is provided', () => {
    const config: QueueDetectionConfig = { etaPatterns: [] };
    const result = resolveQueueDetection(config);
    expect(result.etaPatterns.length).toBeGreaterThan(0);
  });
});

describe('detectQueueStateFromText', () => {
  it('returns not queued for empty text', () => {
    expect(detectQueueStateFromText('')).toEqual({ queued: false, estimatedSec: 0 });
  });

  it('returns not queued when no queue keywords found', () => {
    const result = detectQueueStateFromText('Video generated successfully. Download ready.');
    expect(result.queued).toBe(false);
    expect(result.estimatedSec).toBe(0);
  });

  it('detects Chinese queue keyword 排队', () => {
    const result = detectQueueStateFromText('当前状态：排队中，请耐心等待');
    expect(result.queued).toBe(true);
  });

  it('detects English queue keyword "in queue"', () => {
    const result = detectQueueStateFromText('Your request is in queue.');
    expect(result.queued).toBe(true);
  });

  it('detects "queued" keyword', () => {
    const result = detectQueueStateFromText('Status: queued');
    expect(result.queued).toBe(true);
  });

  it('detects "processing" keyword', () => {
    const result = detectQueueStateFromText('Processing your request...');
    expect(result.queued).toBe(true);
  });

  it('detects "rendering" keyword', () => {
    const result = detectQueueStateFromText('Rendering video...');
    expect(result.queued).toBe(true);
  });

  it('detects "please wait" keyword', () => {
    const result = detectQueueStateFromText('Please wait while we process your video.');
    expect(result.queued).toBe(true);
  });

  it('extracts estimated wait time in minutes (Chinese)', () => {
    const result = detectQueueStateFromText('排队中，预计等待 5 分钟');
    expect(result.queued).toBe(true);
    expect(result.estimatedSec).toBe(300);
  });

  it('extracts estimated wait time in minutes and seconds', () => {
    const result = detectQueueStateFromText('排队中，约 2 分 30 秒');
    expect(result.queued).toBe(true);
    expect(result.estimatedSec).toBe(150);
  });

  it('extracts ETA in mm:ss format', () => {
    const result = detectQueueStateFromText('wait time: 3:45');
    expect(result.queued).toBe(true);
    // 3 minutes + 45 seconds = 225 seconds
    expect(result.estimatedSec).toBe(225);
  });

  it('extracts ETA in "N minutes" fallback', () => {
    const result = detectQueueStateFromText('estimated wait 10 minutes, please wait');
    expect(result.queued).toBe(true);
    expect(result.estimatedSec).toBe(600);
  });

  it('returns 0 estimated time when queued but no ETA pattern matches', () => {
    const result = detectQueueStateFromText('in queue, no time estimate');
    expect(result.queued).toBe(true);
    expect(result.estimatedSec).toBe(0);
  });

  it('handles keywords case-insensitively', () => {
    const result = detectQueueStateFromText('Status: IN QUEUE');
    expect(result.queued).toBe(true);
  });

  it('uses custom config when provided', () => {
    const config: QueueDetectionConfig = {
      queueKeywords: ['custom-queue'],
      etaPatterns: [],
    };
    expect(detectQueueStateFromText('custom-queue detected', config).queued).toBe(true);
    expect(detectQueueStateFromText('in queue', config).queued).toBe(false);
  });

  it('ignores invalid regex patterns without crashing', () => {
    const config: QueueDetectionConfig = {
      queueKeywords: ['queued'],
      etaPatterns: [{ regex: '[invalid(', minutesGroup: 1 }],
    };
    const result = detectQueueStateFromText('queued, wait time unknown', config);
    expect(result.queued).toBe(true);
    expect(result.estimatedSec).toBe(0);
  });

  it('prefers higher-precision ETA (min+sec over minutes-only)', () => {
    // Text that matches both minute-only and min+sec patterns
    const result = detectQueueStateFromText('排队中，约 1 分 30 秒 (1 minutes fallback)');
    expect(result.queued).toBe(true);
    // The min+sec match (90 s) should win over the minutes-only match (60 s)
    expect(result.estimatedSec).toBe(90);
  });
});
