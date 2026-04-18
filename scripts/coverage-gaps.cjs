const path = require('path');
const cov = require(path.join(__dirname, '..', 'coverage', 'coverage-final.json'));
const targets = null; // show all files
for (const [file, data] of Object.entries(cov)) {
  const rel = file.replace(/.*ai-video-main\//, '');
  if (rel.includes('test') || rel.includes('.test.')) continue;
  const stmts = Object.entries(data.s);
  const uncov = stmts.filter(([,c]) => c === 0).map(([k]) => k);
  if (uncov.length < 5) continue;
  const ranges = uncov.map(k => data.statementMap[k]).filter(Boolean);
  const lines = ranges.map(r => r.start.line);
  lines.sort((a,b) => a - b);
  const groups = [];
  let g = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] - g[g.length-1] < 5) g.push(lines[i]);
    else { groups.push(g); g = [lines[i]]; }
  }
  groups.push(g);
  const topGroups = groups.sort((a,b) => b.length - a.length).slice(0, 5);
  console.log(uncov.length + ' uncov | ' + rel);
  for (const gg of topGroups) {
    console.log('  L'+gg[0]+'-'+gg[gg.length-1]+' ('+gg.length+' stmts)');
  }
}
