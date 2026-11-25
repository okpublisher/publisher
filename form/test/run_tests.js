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
  plan: 'Βασικό · 2 posts + 2 stories την εβδομάδα', times: 'αυτόματες', reels: 'στις θέσεις των reels' };

const tests = [];
function test(name, fn) { tests.push([name, fn]); }

test('αίτηση: γραμμή «νέο» + email μόνο στον λογαριασμό της φόρμας', function () {
  const e = makeEnv();
  assert.deepStrictEqual(e.post(BASE), { ok: true });
  const sh = e.sheets['Ενδιαφέροντα'];
  assert.ok(sh, 'καρτέλα Ενδιαφέροντα');
  assert.strictEqual(sh.head.length, 12);
  assert.strictEqual(sh.rows.length, 1);
  const r = sh.rows[0];
  assert.ok(r[0] instanceof Date || Object.prototype.toString.call(r[0]) === '[object Date]');
  assert.deepStrictEqual(Array.from(r.slice(1)), ['Δοκιμή', 'Φούρνος Δοκιμή', 'lead@example.com', '6900000000', 'Μεσαίο', "'@test", 'Γεια', 'el', 'νέο', 'ig / bio', 'ναι']);
  assert.strictEqual(e.mails.length, 1);
  assert.strictEqual(e.mails[0].to, ME);
  assert.strictEqual(e.mails[0].replyTo, 'lead@example.com');
  assert.ok(/Νέο ενδιαφέρον: Φούρνος Δοκιμή \(Μεσαίο\)/.test(e.mails[0].subject));
});

test('χωρίς τετραγωνάκι νέων → «όχι»· χωρίς πηγή → «—»', function () {
  const e = makeEnv();
  const d = Object.assign({}, BASE); delete d.news; delete d.source;
  e.post(d);
  const r = e.sheets['Ενδιαφέροντα'].rows[0];
  assert.strictEqual(r[11], 'όχι');
  assert.strictEqual(r[10], '—');
  assert.ok(/Νέα\/προσφορές με email: όχι/.test(e.mails[0].body));
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
  assert.strictEqual(sh.head[sh.head.length - 1], 'Κατάσταση');
  assert.strictEqual(sh.rows[0].length, sh.head.length);
  assert.strictEqual(sh.rows[0][sh.rows[0].length - 1], 'νέο');
  assert.ok(!e.sheets['Ενδιαφέροντα'], 'δεν γράφει στα Ενδιαφέροντα');
  assert.strictEqual(e.mails[0].to, ME);
  assert.strictEqual(e.mails[0].replyTo, 'owner@example.com');
  assert.strictEqual(e.mails[0].subject, '[okpublisher.gr] Σετάρισμα: Φούρνος Δοκιμή (Βασικό)');
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
