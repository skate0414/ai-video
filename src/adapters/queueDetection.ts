/* ------------------------------------------------------------------ */
/*  queueDetection – detect queue state from page text                */
/* ------------------------------------------------------------------ */

import type { QueueDetectionConfig } from '../types.js';

const DEFAULT_QUEUE_DETECTION: Required<QueueDetectionConfig> = {
  // Keywords are matched case-insensitively after lowercasing page text.
  queueKeywords: [
    // Chinese
    '排队', '队列', '排队加速中', '生成中', '取消生成', '等待中',
    // English
    'in queue', 'queued', 'in line', 'your position', 'rendering',
    'please wait', 'estimated wait', 'wait time', 'eta', 'processing',
  ],
  // Regex source strings with capture-group mappings.
  etaPatterns: [
    // "预计等待 5 分钟" / "estimated wait 5 min"
    { regex: '(?:预计等待|约|~|大约|estimated\\s*wait|wait\\s*time|eta)\\s*[~≈]?\\s*(\\d+)\\s*(?:分钟|分|min(?:ute)?s?)', minutesGroup: 1 },
    // "~13分46秒" / "13 min 46 sec"
    { regex: '[~≈]?\\s*(\\d+)\\s*(?:分钟?|min(?:ute)?s?)\\s*(\\d+)\\s*(?:秒|s(?:ec(?:ond)?s?)?)', minutesGroup: 1, secondsGroup: 2 },
    // "wait time: 13:46" / "ETA 13:46"
    { regex: '(?:wait|等待|eta|time|预计|估计)[^\\n]{0,30}?(\\d{1,3}):(\\d{2})', minutesGroup: 1, secondsGroup: 2 },
    // fallback: "13 minutes"
    { regex: '(\\d+)\\s*(?:minutes?|mins?|分钟)', minutesGroup: 1 },
    // fallback: "46 seconds"
    { regex: '(\\d+)\\s*(?:seconds?|secs?|秒)', secondsGroup: 1 },
  ],
};

export function resolveQueueDetection(config?: QueueDetectionConfig): Required<QueueDetectionConfig> {
  return {
    queueKeywords: config?.queueKeywords?.length ? config.queueKeywords : DEFAULT_QUEUE_DETECTION.queueKeywords,
    etaPatterns: config?.etaPatterns?.length ? config.etaPatterns : DEFAULT_QUEUE_DETECTION.etaPatterns,
  };
}

/**
 * Parse queue state from page text using provider-configured rules.
 * Exported for tests and for rule-only onboarding of new sites.
 */
export function detectQueueStateFromText(
  pageText: string,
  config?: QueueDetectionConfig,
): { queued: boolean; estimatedSec: number } {
  const text = pageText || '';
  const lower = text.toLowerCase();
  const rules = resolveQueueDetection(config);

  const queued = rules.queueKeywords.some((kw) => lower.includes(kw.toLowerCase()));
  if (!queued) {
    return { queued: false, estimatedSec: 0 };
  }

  let bestEstimatedSec = 0;
  let bestPrecision = -1;

  for (const pattern of rules.etaPatterns) {
    try {
      const regex = new RegExp(pattern.regex, 'i');
      const match = text.match(regex);
      if (!match) continue;

      const min = pattern.minutesGroup ? Number(match[pattern.minutesGroup] ?? 0) : 0;
      const sec = pattern.secondsGroup ? Number(match[pattern.secondsGroup] ?? 0) : 0;
      if (Number.isFinite(min) || Number.isFinite(sec)) {
        const estimatedSec = Math.max(0, (Number.isFinite(min) ? min : 0) * 60 + (Number.isFinite(sec) ? sec : 0));
        if (estimatedSec > 0) {
          const precision = (pattern.minutesGroup ? 1 : 0) + (pattern.secondsGroup ? 2 : 0);
          if (precision > bestPrecision || (precision === bestPrecision && estimatedSec > bestEstimatedSec)) {
            bestPrecision = precision;
            bestEstimatedSec = estimatedSec;
          }
        }
      }
    } catch {
      // Ignore invalid regex rules and continue with the next pattern.
    }
  }

  if (bestEstimatedSec > 0) {
    return { queued: true, estimatedSec: bestEstimatedSec };
  }

  return { queued: true, estimatedSec: 0 };
}
