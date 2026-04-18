/**
 * Source marker detection — checks that numeric claims in Chinese scripts
 * are accompanied by attribution markers (e.g. "研究显示", "据统计").
 * Non-blocking QA supplement for human review.
 */

const SOURCE_MARKERS =
  /研究显示|据统计|科学家发现|数据表明|研究表明|根据.*?研究|调查显示|实验证明|报告指出|数据显示/;

/** Matches lines containing at least one digit (potential numeric claim). */
const HAS_DIGIT = /\d/;

export interface SourceMarkerResult {
  /** Lines containing numeric claims without an attribution marker. */
  unmarkedClaims: string[];
}

export function checkSourceMarkers(script: string): SourceMarkerResult {
  const lines = script.split('\n').filter(l => HAS_DIGIT.test(l));
  const unmarked = lines.filter(l => !SOURCE_MARKERS.test(l));
  return { unmarkedClaims: unmarked.slice(0, 5) };
}
