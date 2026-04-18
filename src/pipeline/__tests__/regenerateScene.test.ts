import { describe, it, expect } from 'vitest';

/**
 * Regression test for prompt pollution fix in regenerateScene.
 * Verifies that old [用户反馈: ...] prefixes are stripped before prepending new feedback.
 * This mirrors the exact logic in PipelineService.regenerateScene().
 */

function applyFeedback(visualPrompt: string, feedback: string): string {
  const stripped = visualPrompt.replace(/^\[用户反馈:[^\]]*\]\n/g, '');
  return `[用户反馈: ${feedback.trim()}]\n${stripped}`;
}

describe('regenerateScene feedback dedup', () => {
  it('prepends feedback to a clean prompt', () => {
    const result = applyFeedback('A futuristic city skyline', '更暗一点');
    expect(result).toBe('[用户反馈: 更暗一点]\nA futuristic city skyline');
  });

  it('replaces old feedback instead of stacking', () => {
    const withOldFeedback = '[用户反馈: 更亮一点]\nA futuristic city skyline';
    const result = applyFeedback(withOldFeedback, '更暗一点');
    expect(result).toBe('[用户反馈: 更暗一点]\nA futuristic city skyline');
    // Must NOT contain old feedback
    expect(result).not.toContain('更亮一点');
  });

  it('does not stack multiple rounds of feedback', () => {
    let prompt = 'Original prompt';
    prompt = applyFeedback(prompt, '第一次反馈');
    prompt = applyFeedback(prompt, '第二次反馈');
    prompt = applyFeedback(prompt, '第三次反馈');
    // Only the latest feedback should remain
    expect(prompt).toBe('[用户反馈: 第三次反馈]\nOriginal prompt');
    expect(prompt.match(/用户反馈/g)?.length).toBe(1);
  });

  it('preserves prompt content after feedback prefix', () => {
    const complex = '[用户反馈: old]\nLine 1\nLine 2\nLine 3';
    const result = applyFeedback(complex, 'new');
    expect(result).toBe('[用户反馈: new]\nLine 1\nLine 2\nLine 3');
  });
});
