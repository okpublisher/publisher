// Ετοιμάζει φάκελο για το clasp (Apps Script του okpublisher ή της φόρμας του site).
//   node tools/gas/stage.js push <φάκελος>   → <φάκελος>/src = μόνο <GAS_DIR>/*.gs + appsscript.json, και .clasp.json
//   node tools/gas/stage.js pull <φάκελος>   → άδειος <φάκελος>/src και .clasp.json (για «clasp pull»)
// Το ID του project έρχεται ΜΟΝΟ από τη μεταβλητή SCRIPT_ID (secret στο GitHub) — ποτέ μέσα στο repo, που είναι δημόσιο.
// GAS_DIR = φάκελος του κώδικα (προεπιλογή publisher· φόρμα: form), GAS_MAIN = κύριο αρχείο (προεπιλογή Code.gs· φόρμα: Form.gs).
const fs = require('fs'), path = require('path');
const [mode, out] = process.argv.slice(2);
const scriptId = String(process.env.SCRIPT_ID || '').trim();
if (!/^[\w-]{20,}$/.test(scriptId)) { console.error('Λείπει ή είναι λάθος το SCRIPT_ID.'); process.exit(2); }
if (!out || (mode !== 'push' && mode !== 'pull')) { console.error('Χρήση: stage.js push|pull <φάκελος>'); process.exit(2); }

const GAS_DIR = process.env.GAS_DIR || 'publisher', MAIN = process.env.GAS_MAIN || 'Code.gs';
if (!/^[\w-]+$/.test(GAS_DIR) || !/^[\w-]+\.gs$/.test(MAIN)) { console.error('Λάθος GAS_DIR / GAS_MAIN.'); process.exit(2); }
const SRC = path.join(__dirname, '..', '..', GAS_DIR);
const dir = path.resolve(out);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
fs.writeFileSync(path.join(dir, '.clasp.json'), JSON.stringify({
  scriptId: scriptId, rootDir: 'src', scriptExtensions: ['.gs'], htmlExtensions: ['.html'],
  filePushOrder: ['src/' + MAIN] }, null, 2));

if (mode === 'push') {
  const files = fs.readdirSync(SRC).filter(function (f) { return /\.gs$/.test(f) || f === 'appsscript.json'; });
  if (files.indexOf(MAIN) < 0 || files.indexOf('appsscript.json') < 0) { console.error('Λείπει ' + MAIN + ' ή appsscript.json'); process.exit(2); }
  files.forEach(function (f) { fs.copyFileSync(path.join(SRC, f), path.join(dir, 'src', f)); });
  console.log('Για ανέβασμα: ' + files.join(', '));
}
