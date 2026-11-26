// Δοκιμές της φόρμας του okpublisher.gr (form/Form.gs) με ψεύτικες υπηρεσίες Google: node form/test/run_tests.js
// Τίποτα δεν βγαίνει στο internet. Ελέγχει και το appsscript.json: χωρίς σωστό "webapp" η νέα έκδοση θα έσπαγε το /exec.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const DIR = path.join(__dirname, '..');
const CODE = fs.readFileSync(path.join(DIR, 'Form.gs'), 'utf8');
const ME = 'form-owner@example.com';

function makeEnv() {
  const sheets = {}, mails = [], cache = {};
  function makeSheet(name) {
    const sh = { name: name, rows: [], head: null, frozen: 0, cols: 0 };
    sh.getRange = function (r, c, nr, nc) {
      return {
        setValues: function (v) { if (r === 1) { sh.head = v[0].slice(); sh.cols = Math.max(sh.cols, v[0].length); } return this; },
        setFontWeight: function () { return this; },
      };
    };
    sh.setFrozenRows = function (n) { sh.frozen = n; };
    sh.getLastColumn = function () { return sh.cols; };
    sh.appendRow = function (row) { sh.rows.push(row); sh.cols = Math.max(sh.cols, row.length); };
    return sh;
  }
  const ctx = {
    console: { log: function () {} },
    SpreadsheetApp: { getActive: function () { return {
      getSheetByName: function (n) { return sheets[n] || null; },
      insertSheet: function (n) { sheets[n] = makeSheet(n); return sheets[n]; },
    }; } },
    CacheService: { getScriptCache: function () { return {
      get: function (k) { return k in cache ? cache[k] : null; },
      put: function (k, v) { cache[k] = String(v); },
    }; } },
    LockService: { getScriptLock: function () { return { tryLock: function () { return true; }, releaseLock: function () {} }; } },
    Session: { getEffectiveUser: function () { return { getEmail: function () { return ME; } }; } },
    MailApp: { sendEmail: function (o) { mails.push(o); } },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: function (s) { return { setMimeType: function () { return this; }, getContent: function () { return s; } }; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx, { filename: 'Form.gs' });
  return { ctx: ctx, sheets: sheets, mails: mails, cache: cache,
    post: function (obj) { return JSON.parse(ctx.doPost({ postData: { contents: typeof obj === 'string' ? obj : JSON.stringify(obj) } }).getContent()); } };
}

const BASE = { name: 'Δοκιμή', business: 'Φούρνος Δοκιμή', email: 'lead@example.com', phone: '6900000000', plan: 'Μεσαίο',
  social: '@test', message: 'Γεια', lang: 'el', source: 'ig / bio', news: 'ναι' };
const SETUP = { type: 'setup', business: 'Φούρνος Δοκιμή', name: 'Υπεύθυνος', email: 'owner@example.com', about: 'Ψωμί και γλυκά',
  plan: 'Βασικό · 2 posts + 2 stories την εβδομάδα', times: 'αυτόματες', reels: 'στις θέσεις των reels', terms: 'v1-2026-11-25',
  bill_name: 'Φούρνος Δοκιμή ΙΚΕ', bill_afm: '123456783', bill_doy: 'Δοκιμαστική ΔΟΥ', bill_address: 'Οδός Δοκιμής 1, 00000 Πόλη' };
const BILL_HEAD = ['Επωνυμία τιμολόγησης', 'ΑΦΜ', 'ΔΟΥ', 'Διεύθυνση τιμολόγησης', 'Έλεγχος τιμολόγησης'];
function col(sh, h) { const i = Array.from(sh.head).indexOf(h); assert.ok(i >= 0, 'λείπει η στήλη ' + h); return i; }

function owner(e) { return e.mails.filter(function (m) { return m.to === ME; }); }
function replies(e) { return e.mails.filter(function (m) { return m.to !== ME; }); }

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('αίτηση: γραμμή «νέο» + email στον λογαριασμό της φόρμας + αυτόματη απάντηση μόνο στον ενδιαφερόμενο', function () {
  const e = makeEnv();
  assert.deepStrictEqual(e.post(BASE), { ok: true });
  const sh = e.sheets['Ενδιαφέροντα'];
  assert.ok(sh, 'καρτέλα Ενδιαφέροντα');
  assert.strictEqual(sh.head.length, 12);
  assert.strictEqual(sh.rows.length, 1);
  const r = sh.rows[0];
  assert.ok(r[0] instanceof Date || Object.prototype.toString.call(r[0]) === '[object Date]');
  assert.deepStrictEqual(Array.from(r.slice(1)), ['Δοκιμή', 'Φούρνος Δοκιμή', 'lead@example.com', '6900000000', 'Μεσαίο', "'@test", 'Γεια', 'el', 'νέο', 'ig / bio', 'ναι']);
  assert.strictEqual(e.mails.length, 2);
  const o = owner(e)[0], a = replies(e)[0];
  assert.strictEqual(o.replyTo, 'lead@example.com');
  assert.ok(/Νέο ενδιαφέρον: Φούρνος Δοκιμή \(Μεσαίο\)/.test(o.subject));
  assert.ok(/Αυτόματη απάντηση: στάλθηκε \(Μεσαίο\)/.test(o.body));
  assert.strictEqual(a.to, 'lead@example.com');
  assert.strictEqual(a.replyTo, ME);
});

test('χωρίς τετραγωνάκι νέων → «όχι»· χωρίς πηγή → «—»', function () {
  const e = makeEnv();
  const d = Object.assign({}, BASE); delete d.news; delete d.source;
  e.post(d);
  const r = e.sheets['Ενδιαφέροντα'].rows[0];
  assert.strictEqual(r[11], 'όχι');
  assert.strictEqual(r[10], '—');
  assert.ok(/Νέα\/προσφορές με email: όχι/.test(owner(e)[0].body));
});

test('αυτόματη απάντηση: ανάλογα με το πακέτο (τιμή, posts/stories, 1ος μήνας δώρο, σετάρισμα)', function () {
  [['Βασικό', '€150 + ΦΠΑ', '2 posts και 2 stories την εβδομάδα (περίπου 9 + 9'],
   ['Μεσαίο', '€250 + ΦΠΑ', '4 posts και 4 stories την εβδομάδα (περίπου 17 + 17'],
   ['Καθημερινό', '€400 + ΦΠΑ', '7 posts και 7 stories την εβδομάδα (περίπου 30 + 30']].forEach(function (c) {
    const e = makeEnv();
    e.post(Object.assign({}, BASE, { plan: c[0] }));
    const a = replies(e)[0];
    assert.strictEqual(a.subject, 'okpublisher: το πακέτο «' + c[0] + '» και τα επόμενα βήματα');
    assert.ok(a.body.indexOf('Γεια σας,\n') === 0, a.body);
    assert.ok(a.body.indexOf(c[0] + ' · ' + c[1] + ' τον μήνα') >= 0, c[0]);
    assert.ok(a.body.indexOf(c[2]) >= 0, c[0]);
    assert.ok(/Ο 1ος μήνας είναι δώρο\nΠληρώνετε με κάρτα τον 2ο μήνα με το σετάρισμα/.test(a.body));
    assert.ok(a.body.indexOf('https://okpublisher.gr/setup.html') >= 0);
    assert.ok(!/Δεν είστε σίγουροι/.test(a.body));
  });
});

test('αυτόματη απάντηση: χωρίς πακέτο → όλα τα πακέτα + πρόταση· αγγλικά με lang=en· πρόσθετο reels', function () {
  let e = makeEnv();
  e.post(Object.assign({}, BASE, { plan: '' }));
  let a = replies(e)[0];
  assert.strictEqual(a.subject, 'okpublisher: τα πακέτα και τα επόμενα βήματα');
  ['• Βασικό · €150', '• Μεσαίο · €250', '• Καθημερινό · €400', 'Όλα περιλαμβάνουν:', 'Δεν είστε σίγουροι'].forEach(function (t) { assert.ok(a.body.indexOf(t) >= 0, t); });
  assert.ok(/Αυτόματη απάντηση: στάλθηκε \(όλα τα πακέτα\)/.test(owner(e)[0].body));
  e = makeEnv();
  e.post(Object.assign({}, BASE, { lang: 'en', plan: 'Καθημερινό', name: 'Anna Smith', message: '[Πρόσθετο: γύρισμα/μοντάζ reels] Hi' }));
  a = replies(e)[0];
  assert.strictEqual(a.subject, 'okpublisher: the Daily plan and next steps');
  assert.ok(a.body.indexOf('Hello Anna,') === 0);
  assert.ok(a.body.indexOf('Daily · €400 + VAT a month') >= 0 && a.body.indexOf('Your first month is on us') >= 0);
  assert.ok(/separate quote/.test(a.body));
  assert.ok(!/[α-ω]{4,}/.test(a.body.replace('Πρόσθετο', '')), 'χωρίς ελληνικά στο αγγλικό');
});

test('αυτόματη απάντηση: μία ανά email κάθε 6 ώρες (όχι πολλά email στον ίδιο)', function () {
  const e = makeEnv();
  e.post(BASE); e.post(Object.assign({}, BASE, { email: 'LEAD@example.com' })); e.post(BASE);
  assert.strictEqual(replies(e).length, 1);
  assert.strictEqual(owner(e).length, 3, 'ο λογαριασμός ενημερώνεται για κάθε αίτηση');
  assert.ok(/Αυτόματη απάντηση: όχι/.test(owner(e)[2].body));
  e.post(Object.assign({}, BASE, { email: 'other@example.com' }));
  assert.strictEqual(replies(e).length, 2);
});

test('bot (κρυφό πεδίο website) → τίποτα, σιωπηλά', function () {
  const e = makeEnv();
  assert.deepStrictEqual(e.post(Object.assign({ website: 'x' }, BASE)), { ok: true });
  assert.strictEqual(Object.keys(e.sheets).length, 0);
  assert.strictEqual(e.mails.length, 0);
});

test('λείπουν πεδία ή λάθος email → απόρριψη χωρίς γραμμή/email', function () {
  const e = makeEnv();
  assert.strictEqual(e.post(Object.assign({}, BASE, { email: 'όχι-email' })).ok, false);
  assert.strictEqual(e.post(Object.assign({}, BASE, { business: '' })).ok, false);
  assert.strictEqual(e.post('{χαλασμένο').ok, false);
  assert.strictEqual(e.mails.length, 0);
});

test('τύποι στα κελιά (= + - @) γράφονται ως κείμενο', function () {
  const e = makeEnv();
  e.post(Object.assign({}, BASE, { name: '=HYPERLINK("x")', message: '+30 210', social: '-x' }));
  const r = e.sheets['Ενδιαφέροντα'].rows[0];
  assert.strictEqual(r[1], '\'=HYPERLINK("x")');
  assert.strictEqual(r[7], "'+30 210");
  assert.strictEqual(r[6], "'-x");
});

test('όρια μήκους και χαρακτήρες ελέγχου', function () {
  const e = makeEnv();
  e.post(Object.assign({}, BASE, { message: 'α'.repeat(5000), name: 'Α\u0007Β' }));
  const r = e.sheets['Ενδιαφέροντα'].rows[0];
  assert.strictEqual(r[7].length, 3000);
  assert.strictEqual(r[1], 'ΑΒ');
});

test('το πολύ 30 αιτήματα την ώρα', function () {
  const e = makeEnv();
  for (let i = 0; i < 30; i++) assert.strictEqual(e.post(BASE).ok, true);
  assert.deepStrictEqual(e.post(BASE), { ok: false, error: 'busy' });
  assert.strictEqual(e.sheets['Ενδιαφέροντα'].rows.length, 30);
});

test('σετάρισμα: καρτέλα «Σεταρίσματα» + email «Σετάρισμα:»', function () {
  const e = makeEnv();
  assert.deepStrictEqual(e.post(SETUP), { ok: true });
  const sh = e.sheets['Σεταρίσματα'];
  assert.ok(sh);
  assert.strictEqual(sh.head[0], 'Χρόνος');
  assert.strictEqual(col(sh, 'Όροι (έκδοση)'), col(sh, 'Κατάσταση') + 1);
  assert.deepStrictEqual(Array.from(sh.head).slice(col(sh, 'Όροι (έκδοση)') + 1, -1), BILL_HEAD, 'τα στοιχεία τιμολόγησης μετά τους όρους');
  assert.strictEqual(sh.head[sh.head.length - 1], 'Μουσική στα reels', 'η μουσική τελευταία στήλη');
  assert.strictEqual(sh.rows[0].length, sh.head.length);
  assert.strictEqual(sh.rows[0][col(sh, 'Κατάσταση')], 'νέο');
  assert.strictEqual(sh.rows[0][col(sh, 'Όροι (έκδοση)')], 'v1-2026-11-25');
  assert.ok(/Όροι: αποδοχή στη φόρμα, έκδοση v1-2026-11-25/.test(e.mails[0].body));
  assert.ok(!e.sheets['Ενδιαφέροντα'], 'δεν γράφει στα Ενδιαφέροντα');
  assert.strictEqual(e.mails[0].to, ME);
  assert.strictEqual(e.mails[0].replyTo, 'owner@example.com');
  assert.strictEqual(e.mails[0].subject, '[okpublisher.gr] Σετάρισμα: Φούρνος Δοκιμή (Βασικό)');
});

test('σετάρισμα χωρίς αποδοχή όρων (ή με άκυρη τιμή) → απόρριψη, τίποτα στο Sheet', function () {
  const e = makeEnv();
  const d = Object.assign({}, SETUP); delete d.terms;
  assert.deepStrictEqual(e.post(d), { ok: false, error: 'terms not accepted' });
  assert.deepStrictEqual(e.post(Object.assign({}, SETUP, { terms: 'ναι' })), { ok: false, error: 'terms not accepted' });
  assert.ok(!e.sheets['Σεταρίσματα']);
  assert.strictEqual(e.mails.length, 0);
});

test('παλιά καρτέλα «Σεταρίσματα»: η στήλη όρων μπαίνει στο τέλος, οι υπόλοιπες μένουν στη θέση τους', function () {
  const e = makeEnv();
  const ss = e.ctx.SpreadsheetApp.getActive();
  const old = ss.insertSheet('Σεταρίσματα');
  const oldHead = ['Χρόνος'].concat(Array.from(vm.runInContext('FORM_.SETUP', e.ctx)).map(function (f) { return f[1]; }), ['Κατάσταση']);
  old.getRange(1, 1, 1, oldHead.length).setValues([oldHead]);
  old.appendRow(['t'].concat(oldHead.slice(1, -1).map(function () { return 'x'; }), ['νέο']));
  e.post(SETUP);
  assert.deepStrictEqual(Array.from(old.head).slice(0, oldHead.length), oldHead);
  assert.strictEqual(old.head[oldHead.length], 'Όροι (έκδοση)');
  assert.strictEqual(old.rows[1][oldHead.length - 1], 'νέο');
  assert.strictEqual(old.rows[1][oldHead.length], 'v1-2026-11-25');
});

test('σετάρισμα: στοιχεία τιμολόγησης στο Sheet και στο email· ΑΦΜ ως κείμενο', function () {
  const e = makeEnv();
  e.post(Object.assign({}, SETUP, { bill_afm: 'EL 012-345.670' }));
  const sh = e.sheets['Σεταρίσματα'], r = sh.rows[0];
  assert.deepStrictEqual(Array.from(r.slice(-6, -1)), ['Φούρνος Δοκιμή ΙΚΕ', "'012345670", 'Δοκιμαστική ΔΟΥ', 'Οδός Δοκιμής 1, 00000 Πόλη', 'ΟΚ']);
  const body = e.mails[0].body;
  assert.ok(/Τιμολόγηση:\nΕπωνυμία τιμολόγησης: Φούρνος Δοκιμή ΙΚΕ\nΑΦΜ: 012345670\nΔΟΥ: Δοκιμαστική ΔΟΥ\nΔιεύθυνση τιμολόγησης: Οδός Δοκιμής 1/.test(body), body);
  assert.ok(!/⚠/.test(body));
});

test('σετάρισμα από παλιά σελίδα (χωρίς τιμολόγηση) → γράφεται κανονικά, με σημείωση τι λείπει', function () {
  const e = makeEnv();
  const d = Object.assign({}, SETUP); ['bill_name', 'bill_afm', 'bill_doy', 'bill_address'].forEach(function (k) { delete d[k]; });
  assert.deepStrictEqual(e.post(d), { ok: true });
  const sh = e.sheets['Σεταρίσματα'], r = sh.rows[0];
  assert.strictEqual(r.length, sh.head.length);
  assert.strictEqual(r[col(sh, 'ΑΦΜ')], '');
  assert.strictEqual(r[col(sh, 'Έλεγχος τιμολόγησης')], 'Λείπουν: Επωνυμία τιμολόγησης, ΑΦΜ, ΔΟΥ, Διεύθυνση τιμολόγησης');
  assert.ok(/⚠ Λείπουν: Επωνυμία τιμολόγησης/.test(e.mails[0].body));
});

test('ΑΦΜ που δεν περνά τον έλεγχο → γράφεται, με σημείωση (δεν χάνεται το σετάρισμα)', function () {
  ['123456789', '12345678', '000000000', 'abcdefghi'].forEach(function (afm) {
    const e = makeEnv();
    assert.deepStrictEqual(e.post(Object.assign({}, SETUP, { bill_afm: afm })), { ok: true });
    const sh = e.sheets['Σεταρίσματα'];
    assert.strictEqual(sh.rows[0][col(sh, 'Έλεγχος τιμολόγησης')], 'Ο ΑΦΜ δεν περνά τον έλεγχο', afm);
    assert.ok(/⚠ Ο ΑΦΜ δεν περνά τον έλεγχο/.test(e.mails[0].body));
  });
});

test('έλεγχος ΑΦΜ (ψηφίο ελέγχου)', function () {
  const e = makeEnv();
  const ok = function (a) { return e.ctx.afmOk_(e.ctx.normAfm_(a)); };
  assert.strictEqual(ok('123456783'), true);
  assert.strictEqual(ok('012345670'), true);
  assert.strictEqual(ok('EL123456783'), true);
  assert.strictEqual(ok('gr 123 456 783'), true);
  assert.strictEqual(ok('123456784'), false);
  assert.strictEqual(ok('1234567830'), false);
});

test('καρτέλα με στήλη «Όροι» στο τέλος: τα στοιχεία τιμολόγησης μπαίνουν μετά, οι παλιές μένουν στη θέση τους', function () {
  const e = makeEnv();
  const ss = e.ctx.SpreadsheetApp.getActive();
  const old = ss.insertSheet('Σεταρίσματα');
  const oldHead = ['Χρόνος'].concat(Array.from(vm.runInContext('FORM_.SETUP', e.ctx)).map(function (f) { return f[1]; }), ['Κατάσταση', 'Όροι (έκδοση)']);
  old.getRange(1, 1, 1, oldHead.length).setValues([oldHead]);
  old.appendRow(['t'].concat(oldHead.slice(1, -2).map(function () { return 'x'; }), ['νέο', 'v3-2026-11-25']));
  e.post(SETUP);
  assert.deepStrictEqual(Array.from(old.head).slice(0, oldHead.length), oldHead);
  assert.deepStrictEqual(Array.from(old.head).slice(oldHead.length), BILL_HEAD.concat(['Μουσική στα reels']));
  assert.strictEqual(old.rows[1][oldHead.length - 1], 'v1-2026-11-25');
  assert.strictEqual(old.rows[1][oldHead.length], 'Φούρνος Δοκιμή ΙΚΕ');
});

test('μουσική στα reels: νέα στήλη στο τέλος, οι παλιές μένουν στη θέση τους· και στο email', function () {
  const e = makeEnv();
  const ss = e.ctx.SpreadsheetApp.getActive();
  const old = ss.insertSheet('Σεταρίσματα');
  const oldHead = ['Χρόνος'].concat(Array.from(vm.runInContext('FORM_.SETUP', e.ctx)).map(function (f) { return f[1]; }), ['Κατάσταση', 'Όροι (έκδοση)'], BILL_HEAD);
  old.getRange(1, 1, 1, oldHead.length).setValues([oldHead]);
  e.post(Object.assign({}, SETUP, { music: 'Ήρεμη' }));
  assert.deepStrictEqual(Array.from(old.head).slice(0, oldHead.length), oldHead);
  assert.strictEqual(old.head[oldHead.length], 'Μουσική στα reels');
  assert.strictEqual(old.rows[0][oldHead.length], 'Ήρεμη');
  assert.strictEqual(old.rows[0][oldHead.length - 1], 'ΟΚ');
  assert.ok(/Μουσική στα reels: Ήρεμη/.test(e.mails[0].body), e.mails[0].body);
  e.post(SETUP);                                                      // παλιά σελίδα χωρίς το πεδίο
  assert.strictEqual(old.rows[1][oldHead.length], '');
  assert.ok(/Μουσική στα reels: —/.test(e.mails[1].body));
});

test('σετάρισμα χωρίς «Τι κάνει» → απόρριψη', function () {
  const e = makeEnv();
  const d = Object.assign({}, SETUP); delete d.about;
  assert.strictEqual(e.post(d).ok, false);
  assert.strictEqual(e.mails.length, 0);
});

test('doGet: η απάντηση που ελέγχει το deploy', function () {
  const e = makeEnv();
  assert.deepStrictEqual(JSON.parse(e.ctx.doGet().getContent()), { ok: true, service: 'okpublisher form' });
});

test('appsscript.json: εφαρμογή ιστού, εκτέλεση ως ο ιδιοκτήτης, πρόσβαση οποιοσδήποτε', function () {
  const m = JSON.parse(fs.readFileSync(path.join(DIR, 'appsscript.json'), 'utf8'));
  assert.strictEqual(m.runtimeVersion, 'V8');
  assert.ok(m.webapp, 'λείπει το "webapp": η νέα έκδοση θα έσπαγε τη διεύθυνση /exec');
  assert.strictEqual(m.webapp.executeAs, 'USER_DEPLOYING');
  assert.strictEqual(m.webapp.access, 'ANYONE_ANONYMOUS');
});

let failed = 0;
tests.forEach(function (t) {
  try { t[1](); console.log('✓ ' + t[0]); } catch (err) { failed++; console.log('✗ ' + t[0] + '\n   ' + err.message); }
});
console.log((tests.length - failed) + '/' + tests.length + ' δοκιμές OK');
process.exit(failed ? 1 : 0);
