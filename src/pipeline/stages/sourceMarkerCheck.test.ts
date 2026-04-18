import { describe, it, expect } from 'vitest';
import { checkSourceMarkers } from './sourceMarkerCheck.js';

describe('checkSourceMarkers', () => {
  it('returns empty for text with no digits', () => {
    const result = checkSourceMarkers('这是一段没有数字的文本\n另一行');
    expect(result.unmarkedClaims).toEqual([]);
  });

  it('returns empty when numeral lines have attribution markers', () => {
    const script = '研究显示全球有80亿人口\n据统计每年增长1.1%';
    expect(checkSourceMarkers(script).unmarkedClaims).toEqual([]);
  });

  it('flags lines with digits but no attribution', () => {
    const script = '全球有80亿人口\n据统计每年增长1.1%\n温度上升了2度';
    const result = checkSourceMarkers(script);
    expect(result.unmarkedClaims).toEqual([
      '全球有80亿人口',
      '温度上升了2度',
    ]);
  });

  it('limits output to 5 entries', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `第${i}条无来源声明`);
    const result = checkSourceMarkers(lines.join('\n'));
    expect(result.unmarkedClaims).toHaveLength(5);
  });

  it('handles empty input', () => {
    expect(checkSourceMarkers('').unmarkedClaims).toEqual([]);
  });

  it('recognizes various attribution patterns', () => {
    const patterns = [
      '实验证明每天需要8杯水',
      '报告指出碳排放增加3%',
      '数据显示用户增长50万',
      '根据哈佛研究睡眠需要7小时',
    ];
    const result = checkSourceMarkers(patterns.join('\n'));
    expect(result.unmarkedClaims).toEqual([]);
  });
});
