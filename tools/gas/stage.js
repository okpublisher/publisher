// Ετοιμάζει φάκελο για το clasp (Apps Script του okpublisher).
//   node tools/gas/stage.js push <φάκελος>   → <φάκελος>/src = μόνο publisher/*.gs + appsscript.json, και .clasp.json
//   node tools/gas/stage.js pull <φάκελος>   → άδειος <φάκελος>/src και .clasp.json (για «clasp pull»)
// Το ID του project έρχεται ΜΟΝΟ από τη μεταβλητή SCRIPT_ID (secret στο GitHub) — ποτέ μέσα στο repo, που είναι δημόσιο.
const fs = require('fs'), path = require('path');
const [mode, out] = process.argv.slice(2);
const scriptId = String(process.env.SCRIPT_ID || '').trim();
if (!/^[\w-]{20,}$/.test(scriptId)) { console.error('Λείπει ή είναι λάθος το SCRIPT_ID.'); process.exit(2); }
if (!out || (mode !== 'push' && mode !== 'pull')) { console.error('Χρήση: stage.js push|pull <φάκελος>'); process.exit(2); }

const SRC = path.join(__dirname, '..', '..', 'publisher');
const dir = path.resolve(out);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.writeFileSync(path.join(dir, '.clasp.json'), JSON.stringify({
  scriptId: scriptId, rootDir: 'src', scriptExtensions: ['.gs'], htmlExtensions: ['.html'],
  filePushOrder: ['src/Code.gs'] }, null, 2));

if (mode === 'push') {
  const files = fs.readdirSync(SRC).filter(function (f) { return /\.gs$/.test(f) || f === 'appsscript.json'; });
  if (files.indexOf('Code.gs') < 0 || files.indexOf('appsscript.json') < 0) { console.error('Λείπει Code.gs ή appsscript.json'); process.exit(2); }
  files.forEach(function (f) { fs.copyFileSync(path.join(SRC, f), path.join(dir, 'src', f)); });
  console.log('Για ανέβασμα: ' + files.join(', '));
}
