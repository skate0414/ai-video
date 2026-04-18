import { describe, it, expect } from 'vitest';
import {
  sanitizePromptForJimeng,
  sanitizePromptForKling,
  rewritePromptForCompliance,
} from './promptSanitizer.js';

describe('sanitizePromptForJimeng', () => {
  it('replaces anatomical English terms', () => {
    const result = sanitizePromptForJimeng('The brain sends signals through neural pathways');
    expect(result).not.toMatch(/brain/i);
    expect(result).not.toMatch(/neural pathways/i);
    expect(result).toContain('glowing sphere');
    expect(result).toContain('flowing light streams');
  });

  it('replaces medical terms', () => {
    const result = sanitizePromptForJimeng('blood vessel surgery on the organ');
    expect(result).not.toMatch(/blood vessel/i);
    expect(result).not.toMatch(/surgery/i);
    expect(result).not.toMatch(/organ/i);
  });

  it('replaces Chinese anatomical terms', () => {
    const result = sanitizePromptForJimeng('大脑中的神经元通过神经通路传递意识');
    expect(result).not.toContain('大脑');
    expect(result).not.toContain('神经元');
    expect(result).not.toContain('神经通路');
    expect(result).not.toContain('意识');
    expect(result).toContain('发光球体');
  });

  it('leaves safe text unchanged', () => {
    const safe = 'A beautiful sunset over the ocean with gentle waves';
    expect(sanitizePromptForJimeng(safe)).toBe(safe);
  });

  it('handles cerebral variants', () => {
    const result = sanitizePromptForJimeng('cerebral cortex and cerebrospinal fluid');
    expect(result).not.toMatch(/cerebr/i);
  });
});

describe('sanitizePromptForKling', () => {
  it('replaces chemical terms', () => {
    const result = sanitizePromptForKling('chemical substances and molecules form compounds');
    expect(result).not.toMatch(/chemical substances/i);
    expect(result).not.toMatch(/molecules/i);
    expect(result).toContain('luminous essence');
  });

  it('replaces violence/weapon terms', () => {
    const result = sanitizePromptForKling('The weapon exploded and destroyed the wall');
    expect(result).not.toMatch(/weapon/i);
    expect(result).not.toMatch(/explod/i);
    expect(result).not.toMatch(/destroy/i);
  });

  it('replaces medical terms', () => {
    const result = sanitizePromptForKling('cancer cells and tumors causing disease and death');
    expect(result).not.toMatch(/cancer/i);
    expect(result).not.toMatch(/tumor/i);
    expect(result).not.toMatch(/disease/i);
    expect(result).not.toMatch(/death/i);
  });

  it('replaces Chinese terms', () => {
    const result = sanitizePromptForKling('癌变的细菌感染导致疾病和死亡');
    expect(result).not.toContain('癌');
    expect(result).not.toContain('细菌');
    expect(result).not.toContain('感染');
    expect(result).not.toContain('疾病');
    expect(result).not.toContain('死亡');
  });

  it('replaces drug-related terms', () => {
    const result = sanitizePromptForKling('drug injection at the right dose avoids toxin buildup');
    expect(result).not.toMatch(/drug/i);
    expect(result).not.toMatch(/injection/i);
    expect(result).not.toMatch(/dose/i);
    expect(result).not.toMatch(/toxin/i);
  });

  it('leaves safe text unchanged', () => {
    const safe = 'Golden sunlight through crystal windows';
    expect(sanitizePromptForKling(safe)).toBe(safe);
  });
});

describe('rewritePromptForCompliance', () => {
  it('extracts visual description from template and sanitizes', () => {
    const template = '场景描述: 大脑中的神经通路传递血液\n风格要求: 写实风格';
    const result = rewritePromptForCompliance(template);
    expect(result).toContain('Create a cinematic motion graphics animation:');
    expect(result).not.toContain('大脑');
    expect(result).not.toContain('神经通路');
    expect(result).not.toContain('血液');
    expect(result).not.toContain('风格要求');
    expect(result).toContain('4K quality');
  });

  it('strips 请根据 template wrapper', () => {
    const prompt = '请根据以下场景描述生成视频：场景描述: 美丽的日落\n请直接生成';
    const result = rewritePromptForCompliance(prompt);
    expect(result).not.toContain('请根据');
    expect(result).not.toContain('请直接生成');
    expect(result).toContain('cinematic');
  });

  it('handles plain prompt without template markers', () => {
    const result = rewritePromptForCompliance('brain cells firing in darkness');
    expect(result).toContain('Create a cinematic motion graphics animation:');
    expect(result).not.toMatch(/brain/i);
    expect(result).toContain('4K quality');
  });

  it('applies Kling sanitization to extracted content', () => {
    const result = rewritePromptForCompliance('场景描述: weapon attack explosion\n风格要求: 3D');
    expect(result).not.toMatch(/weapon/i);
    expect(result).not.toMatch(/attack/i);
    expect(result).not.toMatch(/explo/i);
  });
});
