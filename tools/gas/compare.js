// Συγκρίνει δύο φακέλους με κώδικα Apps Script (π.χ. ό,τι τρέχει τώρα ↔ το repo).
//   node tools/gas/compare.js <φάκελος Α> <φάκελος Β>
// Βγάζει μόνο ονόματα αρχείων και αριθμό γραμμής (όχι κώδικα): το log του δημόσιου repo είναι δημόσιο.
// Το «Κώδικας.gs» του editor μετράει ίδιο με το «Code.gs». Αγνοούνται CRLF/LF, κενά στο τέλος και η σειρά
// των πεδίων του appsscript.json. Exit 0 = ίδια, 1 = διαφορετικά.
const fs = require('fs'), path = require('path');
const [a, b] = process.argv.slice(2, 4);
const ALIAS = { 'Κώδικας': 'Code' };
function key(f) { const ext = path.extname(f); const base = path.basename(f, ext); return (ALIAS[base] || base) + (ext === '.js' ? '.gs' : ext); }
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') return Object.keys(v).sort().reduce(function (o, k) { o[k] = sortKeys(v[k]); return o; }, {});
  return v;
}
function norm(f, s) {
  s = s.replace(/\r\n/g, '\n').replace(/\s+$/, '') + '\n';
  if (path.basename(f) === 'appsscript.json') { try { s = JSON.stringify(sortKeys(JSON.parse(s)), null, 2); } catch (e) { /* όπως είναι */ } }
  return s;
}
function read(d) {
  const m = {};
  fs.readdirSync(d).filter(function (f) { return /\.(gs|js|html|json)$/.test(f) && f[0] !== '.'; }).forEach(function (f) {
    m[key(f)] = norm(f, fs.readFileSync(path.join(d, f), 'utf8'));
  });
  return m;
}
const A = read(a), B = read(b), diffs = [];
new Set(Object.keys(A).concat(Object.keys(B))).forEach(function (k) {
  if (!(k in A)) diffs.push('+ ' + k + ' (μόνο στο Β)');
  else if (!(k in B)) diffs.push('− ' + k + ' (μόνο στο Α)');
  else if (A[k] !== B[k]) {
    const la = A[k].split('\n'), lb = B[k].split('\n');
    let i = 0; while (i < la.length && la[i] === lb[i]) i++;
    diffs.push('≠ ' + k + ' (πρώτη διαφορά στη γραμμή ' + (i + 1) + ')');
  }
});
if (diffs.length) { console.log('✗ Διαφέρουν:\n' + diffs.join('\n')); process.exit(1); }
console.log('✓ Ίδια: ' + Object.keys(A).sort().join(', '));
