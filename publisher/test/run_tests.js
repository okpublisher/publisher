// Δοκιμές του Apps Script με ψεύτικες υπηρεσίες Google/Meta (node publisher/test/run_tests.js).
// Τίποτα δεν βγαίνει στο internet: κάθε κλήση καταγράφεται και απαντιέται από εδώ.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const DIR = path.join(__dirname, '..');
const OLD_DIR = process.env.OLD_PUBLISHER_DIR || '';   // προαιρετικά: σύγκριση με τον παλιό LS Publisher

function fmt(d, tz, f) {
  const parts = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, weekday: 'short' })
    .formatToParts(d).forEach(function (p) { parts[p.type] = p.value; });
  const pad = function (s) { return ('0' + s).slice(-2); };
  return f.replace('yyyy', parts.year).replace('MM', pad(parts.month)).replace('dd', pad(parts.day)).replace('HH', pad(parts.hour === '24' ? '0' : parts.hour))
    .replace('mm', parts.minute).replace(/\bd\b/, String(Number(parts.day))).replace(/\bM\b/, String(Number(parts.month)));
}

function makeEnv(opts) {
  opts = opts || {};
  const props = Object.assign({}, opts.props || {});
  const calls = [], mails = [], sheets = {}, triggers = [];
  const queues = opts.queues || {};
  let mediaN = 0;
  const graphFail = opts.graphFail || function () { return false; };
  const env = {
    calls: calls, mails: mails, props: props, sheets: sheets, triggers: triggers,
    nowMs: opts.now ? new Date(opts.now).getTime() : Date.now(),
    activeUser: opts.activeUser === undefined ? 'owner@example.com' : opts.activeUser, cache: {},
  };
  function resp(code, body, headers) {
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    const buf = Buffer.isBuffer(body) ? body : Buffer.from(text);
    return { getResponseCode: () => code, getContentText: () => (Buffer.isBuffer(body) ? body.toString('utf8') : text), getAllHeaders: () => headers || {},
      getContent: () => Array.from(buf), getBlob: function () { const b = { bytes: buf, name: '', setName: function (n) { b.name = n; return b; } }; return b; } };
  }
  function fetch(url, o) {
    o = o || {};
    calls.push({ url: url, method: o.method || 'get', payload: o.payload, headers: o.headers });
    const qkey = Object.keys(queues).find(function (u) { return url.indexOf(u) === 0; });
    if (qkey) return queues[qkey] === null ? resp(404, 'Not found') : resp(200, queues[qkey]);
    if (url.indexOf('https://graph.facebook.com') === 0) {
      if (graphFail(url, o)) return resp(400, { error: { message: 'mock failure', code: 1 } });
      if (opts.graph) { const g = opts.graph(url, o, resp); if (g) return g; }
      if (/\/media(\?|$)/.test(url) && o.method === 'post') return resp(200, { id: 'C' + (++mediaN) });
      if (/media_publish/.test(url)) return resp(200, { id: 'M' + (++mediaN) });
      if (/fields=status_code/.test(url)) return resp(200, { status_code: 'FINISHED' });
      if (/fields=permalink/.test(url)) return resp(200, { permalink: 'https://instagram.com/p/x' + mediaN });
      if (/\/photos$/.test(url)) return resp(200, { id: 'PH' + (++mediaN), post_id: 'PP' + mediaN });
      if (/\/feed$/.test(url)) return resp(200, { id: 'F' + (++mediaN) });
      if (/photo_stories$/.test(url)) return resp(200, { post_id: 'PS' + (++mediaN) });
      if (/video_reels$|video_stories$/.test(url)) {
        if (String(o.payload && o.payload.upload_phase) === 'start') return resp(200, { video_id: 'V' + (++mediaN), upload_url: 'https://rupload.facebook.com/x' });
        return resp(200, { post_id: 'VP' + (++mediaN), success: true });
      }
      if (/\/me\?/.test(url)) return resp(200, { id: 'PAGE1', name: 'Σελίδα', instagram_business_account: { id: 'IG1', username: 'learning.sensory.or' } });
      return resp(200, {});
    }
    if (url.indexOf('https://rupload.facebook.com') === 0) return resp(200, { success: true });
    if (opts.extraFetch) { const r = opts.extraFetch(url, o, resp); if (r) return r; }
    if (opts.driveTree && url.indexOf('https://www.googleapis.com/drive/v3/files?') === 0) {
      const m = decodeURIComponent(url).match(/'([^']+)' in parents/);
      return resp(200, { files: opts.driveTree[m[1]] || [] });
    }
    if (url.indexOf('https://www.googleapis.com/upload/drive') === 0) return resp(200, { id: 'U1' }, { Location: 'https://upload.example/session1' });
    return resp(200, 'ok');
  }
  function sheet(name) {
    const rows = [];
    return {
      name: name, rows: rows,
      getRange: function (r, c, nr, nc) {
        return {
          setValues: function (v) { v.forEach(function (row, i) { const cur = c === 1 ? [] : (rows[r - 1 + i] || []).slice(); row.forEach(function (x, j) { cur[c - 1 + j] = x; }); if (c > 1) { for (let k = 0; k < c - 1; k++) if (!(k in cur)) cur[k] = ''; } rows[r - 1 + i] = cur; }); return this; },
          setFontWeight: function () { return this; }, setNumberFormat: function () { return this; },
          setValue: function (v) { const cur = (rows[r - 1] || []).slice(); while (cur.length < c - 1) cur.push(''); cur[c - 1] = v; rows[r - 1] = cur; return this; },
          getValues: function () { const out = []; for (let i = 0; i < nr; i++) out.push((rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return out; },
          clearContent: function () { for (let i = 0; i < nr; i++) rows[r - 1 + i] = []; return this; },
        };
      },
      appendRow: function (row) { rows.push(row); },
      getDataRange: function () { return { getValues: function () { return rows.map(function (x) { return (x || []).slice(); }); } }; },
      getLastRow: function () { let n = rows.length; while (n && (!rows[n - 1] || !rows[n - 1].length)) n--; return n; },
      setFrozenRows: function () {},
    };
  }
  const ctx = {
    console: { log: function () {}, warn: function () {}, error: function () {} },
    Date: (function () {
      // Το «τώρα» είναι σταθερό ανά δοκιμή, ώστε να ελέγχονται οι ώρες.
      class D extends Date {
        constructor() { if (arguments.length) super(...arguments); else super(env.nowMs); }
        static now() { return env.nowMs; }
      }
      return D;
    })(),
    JSON: JSON, Math: Math, Object: Object, String: String, Number: Number, Error: Error, isNaN: isNaN, RegExp: RegExp, Array: Array,
    encodeURIComponent: encodeURIComponent,
    PropertiesService: { getScriptProperties: function () {
      return {
        getProperty: function (k) { return Object.prototype.hasOwnProperty.call(props, k) ? props[k] : null; },
        setProperty: function (k, v) { props[k] = String(v); },
        deleteProperty: function (k) { delete props[k]; },
        getProperties: function () { return Object.assign({}, props); },
      };
    } },
    UrlFetchApp: { fetch: fetch, fetchAll: function (reqs) { return reqs.map(function (r) { return fetch(r.url, r); }); } },
    MailApp: { sendEmail: function (a, b, c) { mails.push(typeof a === 'object' ? a : { to: a, subject: b, body: c }); } },
    LockService: { getScriptLock: function () { return { tryLock: () => true, releaseLock: () => {} }; },
      getUserLock: function () { return { tryLock: () => true, releaseLock: () => {} }; } },
    Utilities: {
      formatDate: fmt, sleep: function () { env.nowMs += 1000; }, getUuid: function () { return 'abcd-ef01-2345-6789-abcdefabcdef'; },
      computeDigest: function (alg, v) {
        if (alg !== 'sha256') return [1, 2, 3];
        return Array.from(require('crypto').createHash('sha256').update(typeof v === 'string' ? Buffer.from(v, 'utf8') : Buffer.from(v)).digest()).map(function (x) { return x > 127 ? x - 256 : x; });
      },
      DigestAlgorithm: { MD5: 'md5', SHA_256: 'sha256' },
      newBlob: function (b, m, n) { return { bytes: b, mime: m, name: n, getDataAsString: function () { return Buffer.from(b).toString('utf8'); } }; },
      base64Encode: function (x, cs) { return (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x)).toString('base64'); },
      base64Decode: function (s) { return Array.from(Buffer.from(s, 'base64')); },
      Charset: { UTF_8: 'UTF-8' },
    },
    SpreadsheetApp: { getActive: function () { return {
      getSheetByName: function (n) { return sheets[n] || null; },
      insertSheet: function (n) { sheets[n] = sheet(n); return sheets[n]; },
    }; }, getUi: function () { return {}; } },
    Session: { getEffectiveUser: function () { return { getEmail: function () { return 'system@example.com'; } }; },
      // ποιος τρέχει τη συνάρτηση: από τον editor ο λογαριασμός· από σελίδα της εφαρμογής ιστού (ανώνυμα) κενό
      getActiveUser: function () { return { getEmail: function () { return env.activeUser; } }; } },
    CacheService: { getScriptCache: function () { return {
      get: function (k) { const v = env.cache[k]; return v && v.exp > env.nowMs ? v.v : null; },
      put: function (k, v, s) { env.cache[k] = { v: String(v), exp: env.nowMs + (s || 600) * 1000 }; },
      remove: function (k) { delete env.cache[k]; },
    }; } },
    ScriptApp: {
      getOAuthToken: function () { return 'oauth'; },
      getProjectTriggers: function () { return triggers.slice(); },
      deleteTrigger: function (t) { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: function (fn) { const t = { fn: fn, getHandlerFunction: () => fn, getEventType: () => 'CLOCK' };
        const b = { timeBased: () => b, everyMinutes: () => b, everyHours: () => b, everyDays: () => b, atHour: () => b, after: () => b, create: () => { triggers.push(t); return t; } }; return b; },
      EventType: { CLOCK: 'CLOCK' }, getService: function () { return { getUrl: () => '' }; },
    },
    DriveApp: opts.DriveApp || { getFolderById: function (id) { return folder(id, 'Φάκελος ' + id); } },
    ContentService: { createTextOutput: function (s) { return { text: s, setMimeType: function () { return this; } }; }, MimeType: { JSON: 'json' } },
    HtmlService: { createHtmlOutput: function (h) { const o = { html: h, title: '', setTitle: function (t) { o.title = t; return o; },
      addMetaTag: function () { return o; }, getContent: function () { return h; } }; return o; } },
  };
  function folder(id, name) {
    return { getId: () => id, getName: () => name, getFoldersByName: function (n) { return { hasNext: () => false }; },
      createFolder: function (n) { return folder(id + '/' + n, n); }, getAccess: () => 'EDIT', getFiles: () => ({ hasNext: () => false }) };
  }
  vm.createContext(ctx);
  const dir = opts.dir || DIR;
  fs.readdirSync(dir).filter(function (f) { return /\.gs$/.test(f); }).sort().forEach(function (f) {
    vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
  });
  env.ctx = ctx;
  return env;
}

// ------------------------------------------------------------------ δεδομένα
const OLD_Q = 'https://raw.githubusercontent.com/malamaspe/learning-sensory-social/main/queue.json';
const NEW_Q = 'https://raw.githubusercontent.com/okpublisher/publisher/main/queue.json';
const M = 'https://raw.githubusercontent.com/malamaspe/learning-sensory-social/main/media/2026-12/LS/';
function lsQueue() {
  return {
    version: 1, items: [
      { id: 'LS-2026-12-01-story', account: 'LS', type: 'STORY', publish_at: '2026-12-01T10:00:00+02:00', images: [M + 's1.jpg'] },
      { id: 'LS-2026-12-01-post', account: 'LS', type: 'CAROUSEL', publish_at: '2026-12-01T22:00:00+02:00', images: [M + 'a.jpg', M + 'b.jpg'], caption: 'Καρουζέλ' },
      { id: 'LS-2026-12-02-story', account: 'LS', type: 'STORY', publish_at: '2026-12-02T10:00:00+02:00', images: [M + 's2.jpg'] },
      { id: 'LS-2026-12-04-post', account: 'LS', type: 'REEL', publish_at: '2026-12-04T22:00:00+02:00', video: M + 'r.mp4', cover: M + 'c.jpg', caption: 'Reel' },
      { id: 'LS-2026-12-06-post', account: 'LS', type: 'IMAGE', publish_at: '2026-12-06T22:00:00+02:00', images: [M + 'i.jpg'], caption: 'Εικόνα' },
    ],
  };
}
const BASE_PROPS = {
  CLIENTS: 'ORE', TOKEN_ORE: 'tokORE', IG_USER_ORE: 'IG1', FB_PAGE_ORE: 'PAGE1', NOTIFY_TO_ORE: 'center@example.com',
  NAME_ORE: 'Learning & Sensory Ωραιόκαστρο', ALIAS_ORE: 'LS', QUEUE_URL_ORE: OLD_Q,
};
function graphPosts(env) { return env.calls.filter(function (c) { return c.url.indexOf('graph.facebook.com') >= 0 && c.method === 'post'; }); }
function mailsNoQEnd(env) { return env.mails.filter(function (m) { return !/ουρά τελειώνει/.test(m.subject); }); }
function statusKeys(env) { return Object.keys(env.props).filter(function (k) { return /^(fb)?(done|fail|skip)_/.test(k); }).sort(); }

const tests = [];
function test(name, fn) { tests.push({ name: name, fn: fn }); }

// ------------------------------------------------------------------ δοκιμές
test('alias LS→ORE: η ουρά του παλιού συστήματος διαβάζεται ως ORE, με story για κάθε reel', function () {
  const env = makeEnv({ props: BASE_PROPS, queues: { [OLD_Q]: lsQueue() }, now: '2026-11-30T12:00:00+02:00' });
  const q = env.ctx.fetchQueue_('ORE', {});
  assert.strictEqual(q.items.length, 6);
  assert.ok(q.items.every(function (it) { return it.client === 'ORE'; }));
  const rs = q.items.find(function (it) { return it.id === 'LS-2026-12-04-reelstory'; });
  assert.ok(rs && rs.type === 'STORY' && rs.publish_at === '2026-12-04T20:15:00.000Z');
});

test('χωρίς alias ο πελάτης ΔΕΝ βλέπει τις εγγραφές LS', function () {
  const p = Object.assign({}, BASE_PROPS); delete p.ALIAS_ORE;
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() } });
  assert.strictEqual(env.ctx.fetchQueue_('ORE', {}).items.length, 0);
});

test('START_AFTER: τίποτα παλιότερο δεν δημοσιεύεται, δεν μαρκάρεται και δεν στέλνει email', function () {
  const p = Object.assign({}, BASE_PROPS, { START_AFTER: '2026-12-02T15:00:00+02:00' });
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() }, now: '2026-12-02T15:10:00+02:00' });
  env.ctx.run();
  assert.strictEqual(graphPosts(env).length, 0);
  assert.deepStrictEqual(statusKeys(env), []);
  assert.strictEqual(mailsNoQEnd(env).length, 0);
});

test('χωρίς START_AFTER, η αλλαγή θα έστελνε email «παραλείφθηκε» (γι’ αυτό η START_AFTER είναι υποχρεωτική στη μετάβαση)', function () {
  const env = makeEnv({ props: BASE_PROPS, queues: { [OLD_Q]: lsQueue() }, now: '2026-12-02T15:10:00+02:00' });
  env.ctx.run();
  assert.ok(env.mails.length >= 3);
});

test('δημοσίευση στην ώρα της: Instagram + Facebook, μία φορά, ποτέ δεύτερη', function () {
  const p = Object.assign({}, BASE_PROPS, { START_AFTER: '2026-12-06T12:00:00+02:00' });
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() }, now: '2026-12-06T22:03:00+02:00' });
  env.ctx.run();
  assert.ok(env.props['done_LS-2026-12-06-post']);
  assert.ok(env.props['fbdone_LS-2026-12-06-post']);
  const n = graphPosts(env).length;
  assert.ok(n >= 3);
  env.nowMs += 10 * 60000;
  env.ctx.run();
  assert.strictEqual(graphPosts(env).length, n, 'δεύτερη εκτέλεση δεν δημοσιεύει ξανά');
  assert.strictEqual(mailsNoQEnd(env).length, 0);
  // το token του πελάτη χρησιμοποιείται σε κάθε κλήση
  assert.ok(graphPosts(env).every(function (c) { return c.payload.access_token === 'tokORE'; }));
});

test('καθυστέρηση > 3 ωρών: παράλειψη και email ΜΟΝΟ στο email του κέντρου', function () {
  const p = Object.assign({}, BASE_PROPS, { START_AFTER: '2026-12-06T12:00:00+02:00' });
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() }, now: '2026-12-07T02:00:00+02:00' });
  env.ctx.run();
  assert.strictEqual(graphPosts(env).length, 0);
  assert.ok(env.props['skip_LS-2026-12-06-post'] && env.props['fbskip_LS-2026-12-06-post']);
  assert.ok(env.mails.length >= 2);
  assert.ok(env.mails.every(function (m) { return m.to === 'center@example.com'; }));
  assert.ok(env.mails.every(function (m) { return m.subject.indexOf('[Learning & Sensory Ωραιόκαστρο]') === 0; }));
});

test('3 αποτυχίες Instagram: σταματά, email στον πελάτη· το Facebook δημοσιεύεται κανονικά', function () {
  const p = Object.assign({}, BASE_PROPS, { START_AFTER: '2026-12-06T12:00:00+02:00' });
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() }, now: '2026-12-06T22:01:00+02:00',
    graphFail: function (url) { return /IG1\/media/.test(url); } });
  for (let i = 0; i < 4; i++) { env.ctx.run(); env.nowMs += 10 * 60000; }
  assert.strictEqual(env.props['fail_LS-2026-12-06-post'], '3');
  assert.ok(env.props['skip_LS-2026-12-06-post']);
  assert.ok(env.props['fbdone_LS-2026-12-06-post']);
  const ms = mailsNoQEnd(env);
  assert.strictEqual(ms.length, 1);
  assert.strictEqual(ms[0].to, 'center@example.com');
  assert.ok(/Απέτυχε/.test(ms[0].subject));
  assert.ok(env.mails.every(function (m) { return m.to === 'center@example.com'; }));
});

test('χωρίς NOTIFY_TO_<K> δεν στέλνεται κανένα email σε κανέναν', function () {
  const p = Object.assign({}, BASE_PROPS, { START_AFTER: '2026-12-06T12:00:00+02:00' }); delete p.NOTIFY_TO_ORE;
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() }, now: '2026-12-07T02:00:00+02:00' });
  env.ctx.run();
  assert.strictEqual(env.mails.length, 0);
});

test('δύο πελάτες στην ίδια ουρά: ο καθένας μόνο τα δικά του, με το δικό του token, email μόνο στον δικό του', function () {
  const q = { items: [
    { id: 'ORE-2026-12-10-post', account: 'ORE', type: 'IMAGE', publish_at: '2026-12-10T22:00:00+02:00', images: ['https://x/o.jpg'] },
    { id: 'KAL-2026-12-10-post', account: 'KAL', type: 'IMAGE', publish_at: '2026-12-10T22:00:00+02:00', images: ['https://x/k.jpg'] },
    { id: 'KAL-2026-12-01-post', account: 'KAL', type: 'IMAGE', publish_at: '2026-12-10T17:00:00+02:00', images: ['https://x/k0.jpg'] },
  ] };
  const p = { CLIENTS: 'ORE, KAL', TOKEN_ORE: 'tO', IG_USER_ORE: 'IGO', TOKEN_KAL: 'tK', IG_USER_KAL: 'IGK',
    NOTIFY_TO_ORE: 'ore@example.com', NOTIFY_TO_KAL: 'kal@example.com', START_AFTER: '2026-12-10T12:00:00+02:00' };
  const env = makeEnv({ props: p, queues: { [NEW_Q]: q }, now: '2026-12-10T22:05:00+02:00' });
  env.ctx.run();
  assert.ok(env.props['done_ORE-2026-12-10-post'] && env.props['done_KAL-2026-12-10-post']);
  const posts = graphPosts(env);
  assert.ok(posts.filter(function (c) { return /IGO\//.test(c.url); }).every(function (c) { return c.payload.access_token === 'tO'; }));
  assert.ok(posts.filter(function (c) { return /IGK\//.test(c.url); }).every(function (c) { return c.payload.access_token === 'tK'; }));
  // το KAL-…-01 άργησε 5 ώρες → email μόνο στο KAL
  const ms = mailsNoQEnd(env);
  assert.strictEqual(ms.length, 1);
  assert.strictEqual(ms[0].to, 'kal@example.com');
  // οι ειδοποιήσεις «τέλος ουράς» πάνε στον καθένα χωριστά
  assert.deepStrictEqual(env.mails.filter(function (m) { return /ουρά τελειώνει/.test(m.subject); }).map(function (m) { return m.to; }).sort(), ['kal@example.com', 'ore@example.com']);
  // χωρίς FB_PAGE δεν γίνεται τίποτα στο Facebook
  assert.ok(!env.props['fbdone_ORE-2026-12-10-post']);
});

test('παύση ενός πελάτη δεν σταματά τον άλλον· PAUSED σταματά όλους', function () {
  const q = { items: [
    { id: 'ORE-a', account: 'ORE', type: 'IMAGE', publish_at: '2026-12-10T22:00:00+02:00', images: ['https://x/o.jpg'] },
    { id: 'KAL-a', account: 'KAL', type: 'IMAGE', publish_at: '2026-12-10T22:00:00+02:00', images: ['https://x/k.jpg'] },
  ] };
  const p = { CLIENTS: 'ORE,KAL', TOKEN_ORE: 'tO', IG_USER_ORE: 'IGO', TOKEN_KAL: 'tK', IG_USER_KAL: 'IGK', PAUSED_KAL: 'true' };
  const env = makeEnv({ props: p, queues: { [NEW_Q]: q }, now: '2026-12-10T22:05:00+02:00' });
  env.ctx.run();
  assert.ok(env.props['done_ORE-a'] && !env.props['done_KAL-a']);
  const env2 = makeEnv({ props: Object.assign({}, p, { PAUSED: 'true' }), queues: { [NEW_Q]: q }, now: '2026-12-10T22:05:00+02:00' });
  env2.ctx.run();
  assert.deepStrictEqual(statusKeys(env2), []);
});

test('όριο χρόνου: βίντεο ξεκινά μόνο στο 1ο λεπτό κάθε κύκλου· τα υπόλοιπα στον επόμενο, χωρίς σφάλματα', function () {
  const items = [];
  for (let i = 0; i < 6; i++) items.push({ id: 'ORE-v' + i, account: 'ORE', type: 'REEL', story: false, publish_at: '2026-12-10T22:00:00+02:00', video: 'https://x/v' + i + '.mp4' });
  const p = { CLIENTS: 'ORE', TOKEN_ORE: 't', IG_USER_ORE: 'IG', NOTIFY_TO_ORE: 'c@example.com' };
  const env = makeEnv({ props: p, queues: { [NEW_Q]: { items: items } }, now: '2026-12-10T22:01:00+02:00' });
  // κάθε reel «καθυστερεί» 40″ στο waitReady (ψεύτικο: 40 × sleep 1″)
  const origFetch = env.ctx.UrlFetchApp.fetch;
  const polls = {};
  env.ctx.UrlFetchApp.fetch = function (url, o) {
    const m = url.match(/graph\.facebook\.com\/(C\d+)\?fields=status_code/);
    if (m && (polls[m[1]] = (polls[m[1]] || 0) + 1) < 40) {
      env.calls.push({ url: url, method: 'get' });
      return { getResponseCode: () => 200, getContentText: () => '{"status_code":"IN_PROGRESS"}' };
    }
    return origFetch(url, o);
  };
  env.ctx.run();
  const first = statusKeys(env).filter(function (k) { return /^done_/.test(k); }).length;
  assert.ok(first >= 2 && first < 6, 'πρώτος κύκλος: ' + first);
  env.nowMs += 10 * 60000;
  env.ctx.run(); env.nowMs += 10 * 60000; env.ctx.run();
  assert.strictEqual(statusKeys(env).filter(function (k) { return /^done_/.test(k); }).length, 6);
  assert.strictEqual(mailsNoQEnd(env).length, 0);
  assert.ok(!statusKeys(env).some(function (k) { return /^(fail|skip)_/.test(k); }));
});

test('καθάρισμα σημειώσεων: σβήνει μόνο όσα δεν είναι στην ουρά και είναι παλιά', function () {
  const p = Object.assign({}, BASE_PROPS, {
    'done_LS-2026-10-01-post': JSON.stringify({ at: '2026-10-01T20:00:00Z' }),
    'skip_LS-2026-10-02-post': '2026-10-02T20:00:00Z',
    'fail_LS-2026-10-03-post': '2',
    'done_LS-2026-11-29-post': JSON.stringify({ at: '2026-11-29T20:00:00Z' }),
    'done_LS-2026-12-01-story': JSON.stringify({ at: '2026-10-01T08:00:00Z' }),   // στην ουρά: μένει πάντα
    START_AFTER: '2026-11-30T00:00:00+02:00',
  });
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() }, now: '2026-11-30T12:00:00+02:00' });
  env.ctx.run();
  assert.ok(!env.props['done_LS-2026-10-01-post'] && !env.props['skip_LS-2026-10-02-post'] && !env.props['fail_LS-2026-10-03-post']);
  assert.ok(env.props['done_LS-2026-11-29-post'], 'πρόσφατο: μένει');
  assert.ok(env.props['done_LS-2026-12-01-story'], 'στην ουρά: μένει');
});

test('τέλος ουράς: email μία φορά στον πελάτη', function () {
  const p = Object.assign({}, BASE_PROPS, { START_AFTER: '2026-12-03T00:00:00+02:00' });
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() }, now: '2026-12-03T12:00:00+02:00' });
  env.ctx.run(); env.nowMs += 600000; env.ctx.run();
  const w = env.mails.filter(function (m) { return /ουρά τελειώνει/.test(m.subject); });
  assert.strictEqual(w.length, 1);
  assert.strictEqual(w[0].to, 'center@example.com');
});

test('σφάλμα ουράς (404): email ΜΟΝΟ στο inbox του okpublisher, μία φορά', function () {
  const env = makeEnv({ props: BASE_PROPS, queues: { [OLD_Q]: null }, now: '2026-12-03T12:00:00+02:00' });
  env.ctx.run(); env.nowMs += 600000; env.ctx.run();
  assert.strictEqual(env.mails.length, 1);
  assert.strictEqual(env.mails[0].to, 'system@example.com');
});

test('Sheet: στήλη Πελάτης και όλες οι εγγραφές', function () {
  const p = Object.assign({}, BASE_PROPS, { START_AFTER: '2026-11-30T00:00:00+02:00' });
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() }, now: '2026-11-30T12:00:00+02:00' });
  env.ctx.run();
  const rows = env.sheets['Ουρά'].rows.filter(function (r) { return r && r.length; });
  assert.strictEqual(rows[0][0], 'Πελάτης');
  assert.strictEqual(rows.length, 7);
  assert.ok(rows.slice(1).every(function (r) { return r[0] === 'ORE'; }));
  assert.strictEqual(rows[0][11], 'Τελευταίος κύκλος', 'σήμα ζωής για τον Φύλακα');
  assert.strictEqual(rows[0][12].getTime(), env.nowMs);
});

test('μεγάλα βίντεο: τα κομμάτια που υπάρχουν ΔΕΝ ξανακατεβαίνουν (MD5 από το Drive)· κατεβαίνει μόνο ό,τι λείπει', function () {
  const made = [];
  const X = { getId: () => 'X', getFiles: () => iter([]),
    createFile: function (b) { made.push(b); return { getId: () => 'N' + made.length }; } };
  const ROOT = { getId: () => 'ROOT', getFoldersByName: function (n) { return iter(n === '_ΜΕΤΑΦΟΡΑ' ? [X] : []); },
    createFolder: function () { throw new Error('δεν πρέπει'); } };
  const tree = {
    ROOT: [{ id: 'v1', name: 'big.mov', size: '25', md5Checksum: 'vmd5', createdTime: '2026-11-24T10:00:00Z', mimeType: 'video/quicktime' }],
    X: [{ id: 'p1', name: 'big.mov__v1.p01', size: '10', md5Checksum: 'h1' },
        { id: 'p2', name: 'big.mov__v1.p02', size: '10', md5Checksum: 'h2' }],
  };
  const ranges = [];
  const env = makeEnv({ props: { CLIENTS: 'ORE', FOLDER_ORE: 'ROOT' }, driveTree: tree, DriveApp: { getFolderById: function () { return ROOT; } },
    extraFetch: function (url, o, resp) {
      if (/\/files\/v1\?alt=media/.test(url)) { ranges.push(o.headers.Range); const m = o.headers.Range.match(/(\d+)-(\d+)/); return resp(206, Buffer.alloc(Number(m[2]) - Number(m[1]) + 1, 7)); }
    } });
  vm.runInContext('XFER_.CHUNK = 10; XFER_.MIN_SIZE = 15;', env.ctx);
  const r = env.ctx.splitBigVideos(env.nowMs + 60000);
  assert.deepStrictEqual(ranges, ['bytes=20-24'], 'μόνο το 3ο κομμάτι κατέβηκε');
  assert.deepStrictEqual(made.map(function (b) { return b.name; }), ['big.mov__v1.p03', 'big.mov__v1.manifest.json']);
  const man = JSON.parse(made[1].getDataAsString());
  assert.deepStrictEqual(man.parts.map(function (p) { return [p.name, p.size, p.md5]; }),
    [['big.mov__v1.p01', 10, 'h1'], ['big.mov__v1.p02', 10, 'h2'], ['big.mov__v1.p03', 5, '010203']]);
  assert.strictEqual(r.done, 1); assert.strictEqual(r.parts, 1); assert.strictEqual(r.left, 0);
  assert.strictEqual(env.triggers.length, 0, 'τίποτα δεν έμεινε → κανένας νέος κύκλος');
});

test('συντόμευση iPhone: κάθε πελάτης μόνο με το δικό του κλειδί, στον δικό του φάκελο', function () {
  const p = { CLIENTS: 'ORE,KAL', FOLDER_ORE: 'https://drive.google.com/drive/folders/FOLD_ORE?usp=sharing', FOLDER_KAL: 'FOLD_KAL',
    UPLOAD_KEY_ORE: 'kOREkOREkOREkOREkORE', UPLOAD_KEY_KAL: 'kKALkKALkKALkKALkKAL' };
  const env = makeEnv({ props: p });
  const ok = JSON.parse(env.ctx.doPost({ parameter: { c: 'ORE', key: 'kOREkOREkOREkOREkORE' }, postData: { contents: '{"name":"IMG_1.HEIC"}' } }).text);
  assert.strictEqual(ok.upload_url, 'https://upload.example/session1');
  const up = env.calls.filter(function (c) { return /upload\/drive/.test(c.url); })[0];
  assert.deepStrictEqual(JSON.parse(up.payload).parents, ['FOLD_ORE']);
  const bad = JSON.parse(env.ctx.doPost({ parameter: { c: 'ORE', key: 'kKALkKALkKALkKALkKAL' }, postData: { contents: '{}' } }).text);
  assert.ok(bad.error, 'κλειδί άλλου πελάτη απορρίπτεται');
  const none = JSON.parse(env.ctx.doPost({ parameter: { key: '' }, postData: { contents: '{}' } }).text);
  assert.ok(none.error);
});

test('FOLDER_<K> δέχεται σύνδεσμο ή σκέτο ID', function () {
  const env = makeEnv({ props: { FOLDER_A: 'https://drive.google.com/drive/folders/1AbC_d-9?usp=drive_link', FOLDER_B: '1XyZ', FOLDER_C: 'https://drive.google.com/open?id=1Q-w' } });
  assert.strictEqual(env.ctx.folderId_('A'), '1AbC_d-9');
  assert.strictEqual(env.ctx.folderId_('B'), '1XyZ');
  assert.strictEqual(env.ctx.folderId_('C'), '1Q-w');
});

test('διπλότυπα: μόνο αφαίρεση από τον φάκελο (ποτέ σβήσιμο αρχείων άλλων), εκτός ΕΓΚΡΙΣΗ, email μόνο στον πελάτη', function () {
  const F = 'application/vnd.google-apps.folder';
  const tree = {
    ROOT: [
      { id: 'a1', name: 'IMG_1.jpg', md5Checksum: 'm1', size: '10', createdTime: '2026-11-01T00:00:00Z', ownedByMe: false },
      { id: 'a2', name: 'IMG_1 (1).jpg', md5Checksum: 'm1', size: '10', createdTime: '2026-11-20T00:00:00Z', ownedByMe: false },
      { id: 'G', name: 'ΕΓΚΡΙΣΗ', mimeType: F },
      { id: 'U', name: 'ΧΡΗΣΙΜΟΠΟΙΗΜΕΝΑ', mimeType: F },
    ],
    G: [{ id: 'g1', name: 'x.pdf', md5Checksum: 'm2', size: '5', createdTime: '2026-11-02T00:00:00Z', ownedByMe: true },
        { id: 'g2', name: 'x copy.pdf', md5Checksum: 'm2', size: '5', createdTime: '2026-11-03T00:00:00Z', ownedByMe: true }],
    U: [{ id: 'u1', name: 'IMG_9.jpg', md5Checksum: 'm9', size: '7', createdTime: '2026-10-01T00:00:00Z', ownedByMe: false }],
  };
  tree.ROOT.push({ id: 'a3', name: 'IMG_9.jpg', md5Checksum: 'm9', size: '7', createdTime: '2026-11-22T00:00:00Z', ownedByMe: false });
  const env = makeEnv({ props: { CLIENTS: 'ORE', FOLDER_ORE: 'ROOT', NOTIFY_TO_ORE: 'center@example.com' }, driveTree: tree });
  env.ctx.splitBigVideos = function () { return {}; };
  env.ctx.dedupeMaterial();
  const patches = env.calls.filter(function (c) { return c.method === 'patch'; });
  assert.strictEqual(patches.length, 2);
  assert.ok(patches.every(function (c) { return /removeParents=/.test(c.url) && !/trashed/.test(c.payload); }));
  assert.ok(patches.some(function (c) { return /files\/a2\?removeParents=ROOT/.test(c.url); }));
  assert.ok(patches.some(function (c) { return /files\/a3\?removeParents=ROOT/.test(c.url); }), 'το ξανανεβασμένο χρησιμοποιημένο φεύγει');
  assert.strictEqual(env.mails.length, 1);
  assert.strictEqual(env.mails[0].to, 'center@example.com');
});

test('dryRunReelFb: ανεβαίνει μόνο ως πρόχειρο (DRAFT) και σβήνεται· καμία δημοσίευση, καμία σημείωση', function () {
  const env = makeEnv({ props: BASE_PROPS, queues: { [OLD_Q]: lsQueue() }, now: '2026-11-30T12:00:00+02:00' });
  env.ctx.dryRunReelFb();
  const reelCalls = graphPosts(env).filter(function (c) { return /video_reels$/.test(c.url); });
  assert.strictEqual(reelCalls.length, 2);
  assert.strictEqual(reelCalls[1].payload.video_state, 'DRAFT');
  assert.ok(!graphPosts(env).some(function (c) { return c.payload && c.payload.video_state === 'PUBLISHED'; }));
  assert.ok(graphPosts(env).some(function (c) { return c.payload && c.payload.method === 'delete'; }));
  assert.deepStrictEqual(statusKeys(env), []);
  assert.strictEqual(env.mails.length, 0);
  const up = env.calls.filter(function (c) { return /rupload/.test(c.url); })[0];
  assert.strictEqual(up.headers.file_url, M + 'r.mp4');
});


// ------------------------------------------------------------------ έγκριση (Approval.gs)
const GH_C = 'https://api.github.com/repos/okpublisher/publisher-work/contents/';
function iter(a) { let i = 0; return { hasNext: () => i < a.length, next: () => a[i++] }; }
function driveMock(seed) {
  const nodes = {}; let n = 0;
  function mk(id, name, parent, folder) { nodes[id] = { id: id, name: name, parents: parent ? [parent] : [], folder: folder }; return api(id); }
  function kids(id, folder) { return Object.keys(nodes).map(function (k) { return nodes[k]; }).filter(function (x) { return x.parents.indexOf(id) >= 0 && x.folder === folder; }); }
  function api(id) {
    const x = nodes[id];
    if (!x) throw new Error('Δεν υπάρχει: ' + id);
    const base = { getId: () => x.id, getName: () => x.name, getUrl: () => 'https://drive.example/' + x.id };
    if (x.folder) {
      return Object.assign(base, {
        getFoldersByName: function (nm) { return iter(kids(id, true).filter(function (c) { return c.name === nm; }).map(function (c) { return api(c.id); })); },
        createFolder: function (nm) { return mk('F' + (++n), nm, id, true); },
        createFile: function (blob) { return mk('D' + (++n), blob.name, id, false); },
        getFiles: function () { return iter(kids(id, false).map(function (c) { return api(c.id); })); },
      });
    }
    return Object.assign(base, {
      getParents: function () { return iter(x.parents.map(api)); },
      moveTo: function (f) { x.parents = [f.getId()]; return api(id); },
    });
  }
  (seed || []).forEach(function (s) { mk(s[0], s[1], s[2], s[3]); });
  return { nodes: nodes, path: function (id) { const out = []; let x = nodes[id]; while (x) { out.unshift(x.name); x = nodes[x.parents[0]]; } return out.join('/'); },
    DriveApp: { getFolderById: api, getFileById: api } };
}
function msg(id, thread, from, subject, text, t, extra) {
  return Object.assign({ id: id, threadId: thread, internalDate: String(new Date(t).getTime()), labelIds: ['INBOX'],
    payload: { mimeType: 'multipart/alternative', headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject },
      { name: 'Message-ID', value: '<' + id + '@mail>' }],
    parts: [{ mimeType: 'text/plain', body: { data: Buffer.from(text).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') } }] } }, extra || {});
}
function approvalEnv(o) {
  o = o || {};
  const gh = Object.assign({}, o.gh || {}), puts = [], sent = [];
  const mails = Object.assign({}, o.mails || {});
  const dm = driveMock(o.drive || [['ROOT', 'ΥΛΙΚΟ', null, true]]);
  let sn = 0;
  function extraFetch(url, opt, resp) {
    const method = (opt && opt.method) || 'get', h = (opt && opt.headers) || {};
    if (url === 'https://api.github.com/repos/okpublisher/publisher-work') return resp(200, { full_name: 'okpublisher/publisher-work', permissions: { push: true } });
    if (url.indexOf(GH_C) === 0) {
      const path = decodeURIComponent(url.slice(GH_C.length).replace(/\?ref=main$/, ''));
      if (method === 'put') {
        const b = JSON.parse(opt.payload);
        if (gh[path] !== undefined && !b.sha) return resp(422, { message: 'sha wasn\'t supplied' });
        gh[path] = Buffer.from(b.content, 'base64').toString('utf8'); puts.push({ path: path, message: b.message });
        return resp(201, { content: { path: path } });
      }
      if (gh[path] !== undefined) {
        if (h.Accept === 'application/vnd.github.raw') return resp(200, Buffer.isBuffer(gh[path]) ? gh[path] : (typeof gh[path] === 'string' ? gh[path] : JSON.stringify(gh[path])));
        return resp(200, { sha: 'sha-' + path, path: path });
      }
      const kids = {};
      Object.keys(gh).forEach(function (k) { if (k.indexOf(path + '/') === 0) { const rest = k.slice(path.length + 1); const nm = rest.split('/')[0]; kids[nm] = rest.indexOf('/') >= 0 ? 'dir' : 'file'; } });
      if (Object.keys(kids).length) return resp(200, Object.keys(kids).map(function (nm) { return { name: nm, path: path + '/' + nm, type: kids[nm] }; }));
      return resp(404, { message: 'Not Found' });
    }
    if (url.indexOf('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send') === 0) {
      const body = String(opt.payload);
      const meta = JSON.parse(body.split('Content-Type: application/json; charset=UTF-8\r\n\r\n')[1].split('\r\n')[0]);
      const raw = body.split('Content-Type: message/rfc822\r\n\r\n')[1];
      const id = 'S' + (++sn), th = meta.threadId || ('T' + id);
      const to = (raw.match(/^To: (.*)$/m) || [])[1];
      sent.push({ id: id, threadId: th, raw: raw, to: to, meta: meta });
      mails[id] = msg(id, th, 'OK Publisher <okp@example.com>', 'x', 'x', env.nowMs, { labelIds: ['SENT'] });
      return resp(200, { id: id, threadId: th });
    }
    if (url.indexOf('https://gmail.googleapis.com/gmail/v1/users/me') === 0) {
      const p = url.slice('https://gmail.googleapis.com/gmail/v1/users/me'.length);
      if (p === '/profile') return resp(200, { emailAddress: 'okp@example.com' });
      let m = p.match(/^\/messages\?maxResults=\d+&q=(.*)$/);
      if (m) {
        const q = decodeURIComponent(m[1]);
        const addrs = (q.match(/from:\(([^)]*)\)/) || [])[1].split(' OR ');
        const ids = Object.keys(mails).filter(function (k) { const f = (mails[k].payload.headers.find(function (x) { return x.name === 'From'; }) || {}).value || '';
          return addrs.some(function (a) { return f.toLowerCase().indexOf(a) >= 0; }); })
          .sort(function (a, b) { return Number(mails[b].internalDate) - Number(mails[a].internalDate); });
        return resp(200, { messages: ids.map(function (i) { return { id: i }; }) });
      }
      m = p.match(/^\/messages\/([^?]+)/);
      if (m) return mails[m[1]] ? resp(200, mails[m[1]]) : resp(404, {});
      m = p.match(/^\/threads\/([^?]+)/);
      if (m) {
        const th = decodeURIComponent(m[1]);
        const ms = Object.keys(mails).map(function (k) { return mails[k]; }).filter(function (x) { return x.threadId === th; })
          .sort(function (a, b) { return Number(a.internalDate) - Number(b.internalDate); });
        return ms.length ? resp(200, { id: th, messages: ms }) : resp(404, {});
      }
    }
    return null;
  }
  const env = makeEnv({ props: Object.assign({ CLIENTS: 'ORE', NOTIFY_TO_ORE: 'center@example.com', FOLDER_ORE: 'ROOT', GITHUB_TOKEN: 'ghp_x',
    NAME_ORE: 'Learning & Sensory Ωραιόκαστρο' }, o.props || {}), now: o.now || '2026-12-20T12:00:00+02:00', extraFetch: extraFetch, DriveApp: dm.DriveApp,
    graph: o.graph });
  env.gh = gh; env.puts = puts; env.sent = sent; env.gmail = mails; env.drive = dm;
  return env;
}
const ORE_CFG = JSON.stringify({ approver_to: 'center@example.com', approvers: ['center@example.com', 'person@example.com'] });
function result(env, K, id) { return env.gh['clients/' + K + '/outbox/' + id + '.result.json'] && JSON.parse(env.gh['clients/' + K + '/outbox/' + id + '.result.json']); }
function mimePart(raw, type) {
  const m = raw.split('Content-Type: ' + type + '; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1];
  return m ? Buffer.from(m.split('\r\n--')[0].replace(/\r\n/g, ''), 'base64').toString('utf8') : '';
}

test('έγκριση: email πακέτου ΜΟΝΟ στο email του πελάτη, με PDF, ανέβασμα στο ΕΓΚΡΙΣΗ/<μήνας>, αποτέλεσμα στο repo, ποτέ δεύτερη αποστολή', function () {
  const env = approvalEnv({ gh: {
    'clients/ORE/config.json': ORE_CFG,
    'clients/ORE/batches/2027-01/preview/1_Posts_και_Reels.pdf': Buffer.from('%PDF-1.4 δοκιμή'),
    'clients/ORE/outbox/2027-01-01-send.json': JSON.stringify({ type: 'email', to: 'someone-else@example.com',
      subject: 'Learning & Sensory — Πρόγραμμα social Ιανουάριος 2027 για έγκριση', html: '<p>Φάκελος: <a href="{{DRIVE_FOLDER_URL}}">εδώ</a></p>',
      attach: ['clients/ORE/batches/2027-01/preview/1_Posts_και_Reels.pdf'], drive_folder: 'ΕΓΚΡΙΣΗ/2027-01',
      drive_upload: [{ path: 'clients/ORE/batches/2027-01/preview/1_Posts_και_Reels.pdf', name: '1_Posts_και_Reels.pdf' }] }),
  } });
  env.ctx.approvalCycle();
  assert.strictEqual(env.sent.length, 1);
  assert.strictEqual(env.sent[0].to, 'center@example.com', 'μόνο στο NOTIFY_TO, όχι σε ό,τι γράφει το αίτημα');
  assert.ok(/Content-Disposition: attachment/.test(env.sent[0].raw));
  assert.ok(env.sent[0].raw.indexOf(Buffer.from('%PDF-1.4 δοκιμή').toString('base64').slice(0, 20)) > 0);
  assert.ok(/^Subject: =\?UTF-8\?B\?/m.test(env.sent[0].raw));
  const r = result(env, 'ORE', '2027-01-01-send');
  assert.ok(r && r.ok, JSON.stringify(r));
  assert.strictEqual(r.thread_id, env.sent[0].threadId);
  assert.strictEqual(env.drive.path(r.drive_folder_id), 'ΥΛΙΚΟ/ΕΓΚΡΙΣΗ/2027-01');
  assert.ok(mimePart(env.sent[0].raw, 'text/html').indexOf('https://drive.example/' + r.drive_folder_id) > 0, 'σύνδεσμος φακέλου στο email');
  assert.ok(r.drive_files['1_Posts_και_Reels.pdf']);
  env.nowMs += 15 * 60000; env.ctx.approvalCycle();
  assert.strictEqual(env.sent.length, 1, 'δεύτερος κύκλος: τίποτα ξανά');
  assert.ok(!Object.keys(env.props).some(function (k) { return /^OUTBOX_/.test(k); }));
});

test('αιτήματα: not_before → περιμένει χωρίς να γράψει τίποτα και τρέχει μόλις έρθει η ώρα· άκυρη ώρα → σφάλμα', function () {
  const env = approvalEnv({ gh: {
    'clients/ORE/config.json': ORE_CFG,
    'clients/ORE/outbox/a-later.json': JSON.stringify({ type: 'email', subject: 'Συνεχίζουμε;', text: 't', not_before: '2026-12-20T14:00:00+02:00' }),
    'clients/ORE/outbox/b-bad.json': JSON.stringify({ type: 'email', subject: 's', text: 't', not_before: '2026-12-21 10:00' }),
  } });
  env.ctx.approvalCycle();
  assert.strictEqual(env.sent.length, 0);
  assert.strictEqual(result(env, 'ORE', 'a-later'), undefined, 'κανένα αποτέλεσμα όσο περιμένει');
  const bad = result(env, 'ORE', 'b-bad');
  assert.ok(bad && !bad.ok && /not_before/.test(bad.error), JSON.stringify(bad));
  assert.ok(!Object.keys(env.props).some(function (k) { return /^OUTBOX_ORE_a-later/.test(k); }));
  env.nowMs += 60 * 60000; env.ctx.approvalCycle();
  assert.strictEqual(env.sent.length, 0, '13:00: ακόμα νωρίς');
  env.nowMs += 75 * 60000; env.ctx.approvalCycle();
  assert.strictEqual(env.sent.length, 1, '14:15: στάλθηκε');
  assert.ok(result(env, 'ORE', 'a-later').ok);
  env.nowMs += 15 * 60000; env.ctx.approvalCycle();
  assert.strictEqual(env.sent.length, 1, 'μία φορά');
});

test('έγκριση: απάντηση μέσα στο thread πάει ΜΟΝΟ στο κέντρο, ακόμα κι αν απάντησε το προσωπικό email', function () {
  const mails = {
    m1: msg('m1', 'T1', 'OK Publisher <okp@example.com>', 'Πρόγραμμα Ιανουάριος 2027', 'πακέτο', '2026-12-20T10:00:00+02:00', { labelIds: ['SENT'] }),
    m2: msg('m2', 'T1', 'Λ. <person@example.com>', 'Re: Πρόγραμμα Ιανουάριος 2027', '#3 άλλη φωτογραφία', '2026-12-20T11:00:00+02:00'),
  };
  const env = approvalEnv({ mails: mails, gh: { 'clients/ORE/config.json': ORE_CFG,
    'clients/ORE/outbox/2027-01-02-reply.json': JSON.stringify({ type: 'email', thread_id: 'T1', in_reply_to: '<m2@mail>', text: 'Έγινε η αλλαγή στο #3.' }) },
  props: { MAILSEEN_ORE: JSON.stringify(['m2']) } });
  env.ctx.approvalCycle();
  assert.strictEqual(env.sent.length, 1);
  const s = env.sent[0];
  assert.strictEqual(s.to, 'center@example.com');
  assert.strictEqual(s.meta.threadId, 'T1');
  assert.ok(/^In-Reply-To: <m2@mail>$/m.test(s.raw));
  assert.ok(s.raw.indexOf('person@example.com') < 0, 'ποτέ στο προσωπικό');
  assert.strictEqual(mimePart(s.raw, 'text/plain'), 'Έγινε η αλλαγή στο #3.');
  assert.ok(/=\?UTF-8\?B\?/.test(s.raw.match(/^Subject: (.*)$/m)[1]));
  assert.strictEqual(Buffer.from(s.raw.match(/^Subject: =\?UTF-8\?B\?(.*)\?=$/m)[1], 'base64').toString('utf8'), 'Re: Πρόγραμμα Ιανουάριος 2027');
});

test('έγκριση: απαντήσεις μόνο από τις διευθύνσεις έγκρισης γράφονται στο inbox (χωρίς το παλιό κείμενο), μία φορά', function () {
  const mails = {
    a1: msg('a1', 'T1', 'Κέντρο <center@example.com>', 'Re: Πρόγραμμα', 'ΟΚ, όλα τέλεια 👍\n\nΣτις Κυρ 20 Δεκ 2026 στις 10:00 π.μ., ο χρήστης OK Publisher\n<okp@example.com> έγραψε:\n> πακέτο', '2026-12-20T11:30:00+02:00'),
    a2: msg('a2', 'T9', 'Άγνωστος <spam@example.com>', 'Προσφορά', 'κάτι', '2026-12-20T11:40:00+02:00'),
    a3: msg('a3', 'T1', 'person@example.com', 'Re: Πρόγραμμα', 'On Sun, Dec 20, 2026 at 10:00 AM OK Publisher <okp@example.com> wrote:\n> x', '2026-12-20T11:50:00+02:00'),
  };
  const env = approvalEnv({ mails: mails, gh: { 'clients/ORE/config.json': ORE_CFG } });
  env.ctx.approvalCycle();
  const files = Object.keys(env.gh).filter(function (k) { return /^clients\/ORE\/inbox\//.test(k); }).sort();
  assert.strictEqual(files.length, 2, files.join(','));
  const r1 = JSON.parse(env.gh[files[0]]);
  assert.strictEqual(r1.from, 'center@example.com');
  assert.strictEqual(r1.text, 'ΟΚ, όλα τέλεια 👍');
  assert.strictEqual(r1.thread_id, 'T1');
  assert.ok(/^clients\/ORE\/inbox\/2026-12-20T1130_a1\.json$/.test(files[0]), files[0]);
  assert.strictEqual(JSON.parse(env.gh[files[1]]).text, '');
  env.nowMs += 15 * 60000; env.ctx.approvalCycle();
  assert.strictEqual(Object.keys(env.gh).filter(function (k) { return /^clients\/ORE\/inbox\//.test(k); }).length, 2, 'όχι δεύτερη φορά');
});

test('έγκριση: μετακίνηση πηγών μόνο από τον φάκελο υλικού / REELS ΕΤΟΙΜΑ, μόνο σε ΧΡΗΣΙΜΟΠΟΙΗΜΕΝΑ/ΑΠΟΡΡΙΦΘΗΚΑΝ, χωρίς σβήσιμο', function () {
  const env = approvalEnv({ drive: [['ROOT', 'ΥΛΙΚΟ', null, true], ['RR', 'REELS ΕΤΟΙΜΑ', 'ROOT', true], ['OTHER', 'Άλλος', null, true],
    ['f1', 'IMG_1.jpg', 'ROOT', false], ['f2', 'reel.mp4', 'RR', false], ['f3', 'ξένο.jpg', 'OTHER', false]],
  gh: { 'clients/ORE/outbox/2027-01-03-move.json': JSON.stringify({ type: 'move_sources', to: 'ΧΡΗΣΙΜΟΠΟΙΗΜΕΝΑ/2027-01', files: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }] }),
    'clients/ORE/outbox/2027-01-04-move.json': JSON.stringify({ type: 'move_sources', to: 'ΕΓΚΡΙΣΗ/x', files: [{ id: 'f1' }] }) } });
  env.ctx.approvalCycle();
  const r = result(env, 'ORE', '2027-01-03-move');
  assert.deepStrictEqual(r.moved, ['f1', 'f2']);
  assert.strictEqual(r.errors.length, 1);
  assert.ok(!r.ok);
  assert.strictEqual(env.drive.path('f1'), 'ΥΛΙΚΟ/ΧΡΗΣΙΜΟΠΟΙΗΜΕΝΑ/2027-01/IMG_1.jpg');
  assert.strictEqual(env.drive.path('f3'), 'Άλλος/ξένο.jpg');
  const r2 = result(env, 'ORE', '2027-01-04-move');
  assert.ok(!r2.ok && /Μη επιτρεπτός φάκελος/.test(r2.error));
  assert.ok(env.mails.some(function (m) { return m.to === 'system@example.com'; }), 'σφάλματα → inbox του okpublisher');
  assert.ok(!env.mails.some(function (m) { return m.to === 'center@example.com'; }));
});

test('έγκριση: αρχεία άλλου πελάτη, φάκελοι έξω από τον πελάτη και άγνωστα αιτήματα απορρίπτονται χωρίς αποστολή', function () {
  const env = approvalEnv({ gh: { 'clients/KAL/secret.pdf': 'x',
    'clients/ORE/outbox/a.json': JSON.stringify({ type: 'email', subject: 's', text: 't', attach: ['clients/KAL/secret.pdf'] }),
    'clients/ORE/outbox/b.json': JSON.stringify({ type: 'email', subject: 's', text: 't', drive_folder: '../ΕΓΚΡΙΣΗ' }),
    'clients/ORE/outbox/c.json': JSON.stringify({ type: 'delete_everything' }),
    'clients/ORE/outbox/d.json': JSON.stringify({ type: 'email', subject: 's', text: 't', attach: ['clients/ORE/../KAL/secret.pdf'] }),
    'clients/ORE/outbox/e.json': 'όχι json' } });
  env.ctx.approvalCycle();
  assert.strictEqual(env.sent.length, 0);
  ['a', 'b', 'c', 'd', 'e'].forEach(function (id) { const r = result(env, 'ORE', id); assert.ok(r && !r.ok && r.error, id + ': ' + JSON.stringify(r)); });
});

test('έγκριση: αίτημα που κόπηκε στη μέση ΔΕΝ ξανατρέχει (όχι δεύτερο email)· αναφορά στο okpublisher', function () {
  const env = approvalEnv({ gh: { 'clients/ORE/outbox/x.json': JSON.stringify({ type: 'email', subject: 's', text: 't' }) },
    props: { OUTBOX_ORE_x: JSON.stringify({ id: 'x', started_at: '2026-12-20T11:50:00Z' }) } });
  env.ctx.approvalCycle();
  assert.strictEqual(env.sent.length, 0);
  const r = result(env, 'ORE', 'x');
  assert.strictEqual(r.status, 'unknown');
  assert.ok(env.mails.some(function (m) { return m.to === 'system@example.com' && /έγκριση/.test(m.subject); }));
  assert.ok(!env.props.OUTBOX_ORE_x);
});

test('έγκριση: notify πάει μόνο στο email του πελάτη· TEST_CLIENTS μόνο στην έγκριση, ποτέ στη δημοσίευση', function () {
  const env = approvalEnv({ props: { TEST_CLIENTS: 'TST', NOTIFY_TO_TST: 'okp@example.com', FOLDER_TST: 'ROOT' },
    gh: { 'clients/TST/outbox/n.json': JSON.stringify({ type: 'notify', subject: 'Το reel δεν πέρασε τον έλεγχο', text: 'Δεν δημοσιεύεται.' }) },
    queues: {} });
  env.ctx.approvalCycle();
  assert.ok(result(env, 'TST', 'n').ok);
  assert.deepStrictEqual(env.mails.map(function (m) { return m.to; }), ['okp@example.com']);
  assert.strictEqual(JSON.stringify(env.ctx.clients_()), '["ORE"]');
  assert.strictEqual(JSON.stringify(env.ctx.approvalClients_()), '["ORE","TST"]');
});

test('έγκριση: όταν εγκρίνων είναι ο ίδιος ο λογαριασμός, μετράνε μόνο απαντήσεις στα δικά μας threads (όχι φόρμα/άλλα email)', function () {
  const env = approvalEnv({ props: { TEST_CLIENTS: 'TST', NOTIFY_TO_TST: 'system@example.com', FOLDER_TST: 'ROOT', NAME_TST: 'Δοκιμή' },
    gh: { 'clients/TST/outbox/n.json': JSON.stringify({ type: 'email', subject: 'Πρόγραμμα για έγκριση', text: 'Δείτε το πρόγραμμα.' }) },
    mails: {
      F1: msg('F1', 'TF1', 'okpublisher.gr <system@example.com>', '[okpublisher.gr] Νέο ενδιαφέρον: Καφέ', 'Όνομα: Χ', '2026-12-20T11:00:00+02:00'),
      F2: msg('F2', 'TF1', 'Petros <system@example.com>', 'Re: [okpublisher.gr] Νέο ενδιαφέρον: Καφέ', 'Ευχαριστούμε, σας καλώ αύριο', '2026-12-20T11:10:00+02:00'),
      F3: msg('F3', 'TF3', 'Petros <system@example.com>', 'Νέα διεύθυνση για το πρόγραμμα', 'ok', '2026-12-20T11:20:00+02:00'),
    } });
  env.ctx.approvalCycle();                       // στέλνει το email του πακέτου (νέο thread) και διαβάζει τα εισερχόμενα
  const th = result(env, 'TST', 'n').thread_id;
  assert.ok(th);
  assert.deepStrictEqual(Object.keys(env.gh).filter(function (k) { return k.indexOf('clients/TST/inbox/') === 0; }), []);
  env.gmail.R1 = msg('R1', th, 'Petros <system@example.com>', 'Re: Πρόγραμμα για έγκριση', 'ΟΚ', '2026-12-20T12:30:00+02:00');
  env.nowMs = new Date('2026-12-20T12:31:00+02:00').getTime();
  env.ctx.approvalCycle();
  const inbox = Object.keys(env.gh).filter(function (k) { return k.indexOf('clients/TST/inbox/') === 0; });
  assert.strictEqual(inbox.length, 1, inbox.join(','));
  assert.strictEqual(JSON.parse(env.gh[inbox[0]]).text, 'ΟΚ');
});

test('checkApproval: μόνο έλεγχος, καμία αλλαγή', function () {
  const env = approvalEnv({ gh: { 'clients/ORE/config.json': ORE_CFG } });
  const out = env.ctx.checkApproval();
  assert.ok(/GitHub: OK .*γράφει/.test(out[0]), out[0]);
  assert.ok(/Gmail: OK/.test(out[1]));
  assert.ok(/\[ORE\].*εγκρίνοντες: 2/.test(out[2]), out[2]);
  assert.strictEqual(env.puts.length + env.sent.length + env.mails.length, 0);
});

// ------------------------------------------------------------------ στατιστικά, αυτόματες ώρες, μηνιαία αναφορά
const MEDIA_STATS = {
  MP1: { reach: 500, views: 900, likes: 40, comments: 5, shares: 3, saved: 7, total_interactions: 55 },
  MP2: { reach: 1200, views: 3000, likes: 80, comments: 10, shares: 12, saved: 20, total_interactions: 122 },
  MP3: { reach: 300, views: 400, likes: 15, comments: 2, shares: 1, saved: 2, total_interactions: 20 },
  MS1: { reach: 100, views: 130, replies: 0, total_interactions: 2 },
  MS2: { reach: 140, views: 160, replies: 1, total_interactions: 3 },
};
function onlineFollowers(days, endDate) {
  const values = [];
  for (let i = days; i >= 1; i--) {
    const end = new Date(new Date(endDate).getTime() - (i - 1) * 864e5);
    const v = {};
    for (let h = 0; h < 24; h++) v[String(h)] = 50;
    v['11'] = 300; v['12'] = 250; v['0'] = 200;
    values.push({ value: v, end_time: end.toISOString().slice(0, 10) + 'T08:00:00+0000' });
  }
  values.push({ value: {}, end_time: 'x' });
  return { data: [{ name: 'online_followers', period: 'lifetime', values: values }] };
}
function insightsGraph(o) {
  o = o || {};
  return function (url, opt, resp) {
    if ((opt && opt.method) && opt.method !== 'get') return null;
    const u = decodeURIComponent(url), q = u.split('?')[1] || '', path = u.split('?')[0].replace('https://graph.facebook.com/', '');
    const metric = (q.match(/metric=([^&]*)/) || [])[1] || '';
    if (path === 'IG1' && /fields=followers_count/.test(q)) return resp(200, { followers_count: o.followers === undefined ? 870 : o.followers, id: 'IG1' });
    if (path === 'PAGE1' && /fields=followers_count/.test(q)) return resp(200, { followers_count: 930, fan_count: 925, id: 'PAGE1' });
    if (path === 'IG1/insights') {
      if (o.accountFail) return resp(400, { error: { message: 'Unsupported', code: 100 } });
      if (metric === 'online_followers') return resp(200, o.online || onlineFollowers(10, '2026-12-15'));
      if (metric === 'profile_links_taps') return resp(200, { data: [{ name: 'profile_links_taps', period: 'day', total_value: { value: 12,
        breakdowns: [{ dimension_keys: ['contact_button_type'], results: [{ dimension_values: ['CALL'], value: 8 }, { dimension_values: ['DIRECTION'], value: 4 }] }] } }] });
      return resp(200, { data: metric.split(',').map(function (m) { return { name: m, period: 'day', total_value: { value: { reach: 3240, views: 12500, accounts_engaged: 210, total_interactions: 410 }[m] } }; }) });
    }
    const mm = path.match(/^(M[PS]\d)\/insights$/);
    if (mm) {
      if ((o.mediaErr || {})[mm[1]]) return resp(400, { error: { message: 'Not enough viewers', code: 10 } });
      const st = MEDIA_STATS[mm[1]] || {};
      return resp(200, { data: metric.split(',').filter(function (m) { return st[m] !== undefined; }).map(function (m) { return { name: m, period: 'lifetime', values: [{ value: st[m] }] }; }) });
    }
    return null;
  };
}
function decHistory(env, extra) {
  const sh = env.ctx.sheet_('Ιστορικό', ['Χρόνος', 'Πελάτης', 'ID', 'Τύπος', 'Κατάσταση', 'Λεπτομέρειες']);
  const rows = [
    ['2026-11-28T22:01:00+02:00', 'ORE', 'ORE-2026-11-28-post', 'IMAGE', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://instagram.com/p/nov', 'MP9'],
    ['2026-12-01T10:01:00+02:00', 'ORE', 'ORE-2026-12-01-story', 'STORY', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'MS1', 'MS1'],
    ['2026-12-01T22:01:00+02:00', 'ORE', 'ORE-2026-12-01-post', 'CAROUSEL', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://instagram.com/p/a1', 'MP1'],
    ['2026-12-01T22:02:00+02:00', 'ORE', 'ORE-2026-12-01-post', 'CAROUSEL', 'Facebook: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://www.facebook.com/F1', ''],
    ['2026-12-04T22:01:00+02:00', 'ORE', 'ORE-2026-12-04-post', 'REEL', 'Instagram: ΣΦΑΛΜΑ 1/3', 'mock', ''],
    ['2026-12-04T22:11:00+02:00', 'ORE', 'ORE-2026-12-04-post', 'REEL', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://instagram.com/p/r1', 'MP2'],
    ['2026-12-04T22:13:00+02:00', 'ORE', 'ORE-2026-12-04-post', 'REEL', 'Facebook: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'VP1', ''],
    ['2026-12-04T22:21:00+02:00', 'ORE', 'ORE-2026-12-04-reelstory', 'STORY', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'MS2', 'MS2'],
    ['2026-12-06T22:01:00+02:00', 'ORE', 'ORE-2026-12-06-post', 'IMAGE', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://instagram.com/p/i1', 'MP3'],
    ['2026-12-06T22:01:00+02:00', 'KAL', 'KAL-2026-12-06-post', 'IMAGE', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://instagram.com/p/k1', 'MK1'],
  ].concat(extra || []);
  rows.forEach(function (r) {
    sh.appendRow([new Date(r[0]), r[1], r[2], r[3], r[4], r[5]]);
    if (r[6] && /^Instagram: ΔΗΜ/.test(r[4])) env.props['done_' + r[2]] = JSON.stringify({ at: r[0], link: r[5], media: r[6] });
  });
}
function insightsEnv(o) {
  o = o || {};
  const env = approvalEnv({ now: o.now, graph: insightsGraph(o.graph),
    gh: Object.assign({ 'clients/ORE/config.json': JSON.stringify({ approver_to: 'center@example.com', approvers: ['center@example.com', 'person@example.com'],
      times: o.times || 'auto', post_time: '22:00', story_time: '10:00' }) }, o.gh || {}),
    props: Object.assign({ TOKEN_ORE: 'tokORE', IG_USER_ORE: 'IG1', FB_PAGE_ORE: 'PAGE1', START_AFTER: '2026-11-24T13:00:00+02:00',
      FOLLOWERS_ORE: JSON.stringify({ month: '2026-11', ig: 854, fb: 922 }),
      BEST_TIMES_ORE: JSON.stringify({ mode: 'auto', post_time: '21:00', story_time: '10:00', peak_time: '21:00' }) }, o.props || {}) });
  decHistory(env, o.history);
  if (o.stories !== false) {
    const st = env.ctx.sheet_('Stories', ['Δημοσίευση', 'Πελάτης', 'ID', 'Media', 'Εμβέλεια', 'Προβολές', 'Αλληλεπιδράσεις', 'Απαντήσεις', 'Μέτρηση', 'Σημείωση']);
    st.appendRow([new Date('2026-12-01T10:01:00+02:00'), 'ORE', 'ORE-2026-12-01-story', 'MS1', 100, 130, 2, 0, new Date(), '']);
    st.appendRow([new Date('2026-12-04T22:21:00+02:00'), 'ORE', 'ORE-2026-12-04-reelstory', 'MS2', 140, 160, 3, 1, new Date(), '']);
  }
  return env;
}
function graphGets(env, re) { return env.calls.filter(function (c) { return c.url.indexOf('graph.facebook.com') >= 0 && re.test(decodeURIComponent(c.url)); }); }

test('αναφορά: την 1η μετά τις 09:00, ΕΝΑ ξεχωριστό email ΜΟΝΟ στο email του πελάτη, σωστά νούμερα, αρχείο στο repo, ποτέ δεύτερη φορά', function () {
  const env = insightsEnv({ now: '2027-01-01T09:30:00+02:00' });
  env.ctx.insightsCycle();
  assert.strictEqual(env.sent.length, 1);
  assert.strictEqual(env.sent[0].to, 'center@example.com');
  assert.ok(!env.sent[0].meta.threadId, 'νέο thread, όχι μέσα στην έγκριση');
  const raw = env.sent[0].raw, text = mimePart(raw, 'text/plain'), html = mimePart(raw, 'text/html');
  assert.ok(/Αναφορά Δεκεμβρίου 2026/.test(text), text);
  assert.ok(text.indexOf('Instagram: 3 posts (1 reel, 1 carousel, 1 εικόνα) και 2 stories') >= 0, text);
  assert.ok(text.indexOf('Facebook: 2 posts και 0 stories') >= 0, text);
  assert.ok(text.indexOf('3.240 λογαριασμοί είδαν') >= 0 && text.indexOf('12.500 προβολές') >= 0 && text.indexOf('410 αλληλεπιδράσεις') >= 0, text);
  assert.ok(text.indexOf('12 πατήματα') >= 0, text);
  assert.ok(text.indexOf('Instagram 854 → 870 (+16) · Facebook 922 → 930 (+8)') >= 0, text);
  assert.ok(text.indexOf('1. 4/12 Reel: 1.200 λογαριασμοί, 122 αλληλεπιδράσεις — https://instagram.com/p/r1') >= 0, text);
  assert.ok(text.indexOf('2 stories, κατά μέσο όρο 120 λογαριασμοί') >= 0, text);
  assert.ok(text.indexOf('posts βγαίνουν στις 21:00 και τα stories στις 10:00') >= 0, text);
  assert.ok(text.indexOf('τελευταίες 30 ημέρες') >= 0, 'Δεκέμβριος = 31 ημέρες');
  assert.ok(text.indexOf('KAL') < 0 && text.indexOf('nov') < 0, 'μόνο ο πελάτης και ο μήνας');
  assert.ok(/<a href="https:\/\/instagram.com\/p\/r1">/.test(html), html);
  const rep = JSON.parse(env.gh['clients/ORE/reports/2026-12.json']);
  assert.strictEqual(rep.counts.posts, 3); assert.strictEqual(rep.counts.stories, 2); assert.strictEqual(rep.errors.length, 0);
  assert.strictEqual(env.props.REPORT_SENT_ORE, '2026-12');
  assert.strictEqual(JSON.parse(env.props.FOLLOWERS_ORE).ig, 870);
  assert.ok(!env.props.REPORT_SENDING_ORE);
  assert.strictEqual(env.mails.length, 0, 'κανένα email συστήματος');
  env.nowMs = new Date('2027-01-01T15:30:00+02:00').getTime();
  env.ctx.insightsCycle();
  assert.strictEqual(env.sent.length, 1, 'ποτέ δεύτερη αναφορά');
});

test('αναφορά: όχι πριν τις 09:00, όχι για μήνα πριν από το START_AFTER, όχι με REPORT_<K>=false', function () {
  let env = insightsEnv({ now: '2027-01-01T08:10:00+02:00' });
  env.ctx.insightsCycle();
  assert.strictEqual(env.sent.length, 0);
  env = insightsEnv({ now: '2026-12-01T10:00:00+02:00' });
  env.ctx.insightsCycle();
  assert.strictEqual(env.sent.length, 0, 'ο Νοέμβριος δεν καλύφθηκε ολόκληρος');
  assert.ok(/^2026-11/.test(env.props.REPORT_SENT_ORE));
  env.nowMs = new Date('2027-01-01T10:00:00+02:00').getTime();
  env.ctx.insightsCycle();
  assert.strictEqual(env.sent.length, 1, 'ο Δεκέμβριος κανονικά');
  env = insightsEnv({ now: '2027-01-01T10:00:00+02:00', props: { REPORT_ORE: 'false' } });
  env.ctx.insightsCycle();
  assert.strictEqual(env.sent.length + env.mails.length, 0);
});

test('αναφορά που κόπηκε στη μέση ΔΕΝ ξαναστέλνεται· ειδοποίηση μόνο στο okpublisher', function () {
  const env = insightsEnv({ now: '2027-01-01T10:00:00+02:00', props: { REPORT_SENDING_ORE: '2026-12' } });
  env.ctx.insightsCycle();
  assert.strictEqual(env.sent.length, 0);
  assert.deepStrictEqual(env.mails.map(function (m) { return m.to; }), ['system@example.com']);
  env.ctx.insightsCycle();
  assert.strictEqual(env.sent.length + env.mails.length - 1, 0);
});

test('αναφορά: αν λείψουν τα σύνολα λογαριασμού, φεύγει χωρίς αυτά· τα σφάλματα μόνο στο okpublisher', function () {
  const env = insightsEnv({ now: '2027-01-02T12:00:00+02:00', graph: { accountFail: true } });
  env.ctx.insightsCycle();
  assert.strictEqual(env.sent.length, 1);
  const text = mimePart(env.sent[0].raw, 'text/plain');
  assert.ok(text.indexOf('λογαριασμοί είδαν') < 0 && text.indexOf('Graph') < 0 && text.indexOf('Unsupported') < 0, text);
  assert.ok(text.indexOf('197 αλληλεπιδράσεις στα posts') >= 0, text);
  assert.deepStrictEqual(env.mails.map(function (m) { return m.to; }), ['system@example.com']);
});

test('αναφορά με ώρες του πελάτη (manual): λέει τις ώρες του, χωρίς αλλαγή', function () {
  const env = insightsEnv({ now: '2027-01-01T10:00:00+02:00', times: 'manual' });
  env.ctx.insightsCycle();
  const text = mimePart(env.sent[0].raw, 'text/plain');
  assert.ok(text.indexOf('στις ώρες που έχουν οριστεί (posts 22:00, stories 10:00)') >= 0, text);
});

test('αυτόματες ώρες: στις 15, από online_followers σε ώρα Ελλάδας, στο repo· καμία αποστολή, μία φορά τον μήνα', function () {
  const env = insightsEnv({ now: '2026-12-15T07:00:00+02:00', stories: false });
  env.ctx.insightsCycle();
  const bt = JSON.parse(env.gh['clients/ORE/best_times.json']);
  assert.strictEqual(bt.mode, 'auto');
  assert.strictEqual(bt.post_time, '21:00');
  assert.strictEqual(bt.story_time, '10:00');
  assert.strictEqual(bt.peak_time, '21:00');
  assert.strictEqual(bt.days, 10);
  assert.strictEqual(env.props.BEST_TIMES_AT_ORE, '2026-12');
  assert.strictEqual(env.sent.length + env.mails.length, 0);
  const n = env.puts.filter(function (p) { return p.path === 'clients/ORE/best_times.json'; }).length;
  env.nowMs += 6 * 36e5;
  env.ctx.insightsCycle();
  assert.strictEqual(env.puts.filter(function (p) { return p.path === 'clients/ORE/best_times.json'; }).length, n);
});

test('αυτόματες ώρες: κάτω από 100 ακόλουθους → προεπιλογές, χωρίς online_followers· πριν τις 15 τίποτα', function () {
  let env = insightsEnv({ now: '2026-12-10T07:00:00+02:00', stories: false });
  env.ctx.insightsCycle();
  assert.ok(!env.gh['clients/ORE/best_times.json']);
  env = insightsEnv({ now: '2026-12-16T07:00:00+02:00', stories: false, graph: { followers: 60 } });
  env.ctx.insightsCycle();
  const bt = JSON.parse(env.gh['clients/ORE/best_times.json']);
  assert.strictEqual(bt.mode, 'default');
  assert.ok(/100/.test(bt.reason));
  assert.strictEqual(graphGets(env, /online_followers/).length, 0);
});

test('stories: στατιστικά μέσα στο 24ωρο στο φύλλο «Stories»· <5 προβολές σημειώνεται· η καλή μέτρηση δεν χάνεται', function () {
  const gopt = { mediaErr: { MS3: true } };
  const env = insightsEnv({ now: '2026-12-02T09:00:00+02:00', stories: false,
    history: [['2026-12-02T08:01:00+02:00', 'ORE', 'ORE-2026-12-02-story', 'STORY', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'MS3', 'MS3']],
    graph: gopt });
  env.ctx.insightsCycle();
  const rows = env.sheets.Stories.rows.slice(1);
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0][2], 'ORE-2026-12-01-story'); assert.strictEqual(rows[0][4], 100);
  assert.strictEqual(rows[1][9], 'λιγότερες από 5 προβολές');
  // 3 ώρες μετά: το πρώτο story είναι ακόμα στο παράθυρο αλλά το Instagram δεν δίνει πια στοιχεία → μένει η μέτρηση 100
  gopt.mediaErr.MS1 = true;
  env.nowMs += 3 * 36e5;
  env.ctx.insightsCycle();
  assert.ok(graphGets(env, /MS1\/insights/).length >= 2, 'ξαναζητήθηκε');
  assert.strictEqual(env.sheets.Stories.rows[1][4], 100);
  assert.strictEqual(env.sent.length, 0);
});

test('previewReport / previewCurrentMonth: η αναφορά μόνο στο repo, κανένα email', function () {
  let env = insightsEnv({ now: '2027-01-01T07:00:00+02:00' });
  env.ctx.previewReport();
  assert.strictEqual(env.sent.length + env.mails.length, 0);
  let p = JSON.parse(env.gh['clients/ORE/reports/2026-12.preview.json']);
  assert.ok(/Αναφορά Δεκεμβρίου 2026/.test(p.subject));
  assert.ok(!env.props.REPORT_SENT_ORE && !env.props.REPORT_SENDING_ORE);
  env = insightsEnv({ now: '2026-12-03T12:00:00+02:00' });
  env.ctx.previewCurrentMonth();
  assert.strictEqual(env.sent.length + env.mails.length, 0);
  p = JSON.parse(env.gh['clients/ORE/reports/2026-12.preview.json']);
  assert.strictEqual(p.data.counts.posts, 1, 'μόνο ό,τι βγήκε έως τώρα');
  assert.ok(p.text.indexOf('Instagram: 1 post (1 carousel) και 1 story') >= 0, p.text);
});

test('checkInsights: μόνο έλεγχος, καμία αλλαγή', function () {
  const env = insightsEnv({ now: '2026-12-20T12:00:00+02:00' });
  const before = JSON.stringify(env.props);
  const out = env.ctx.checkInsights();
  assert.ok(/\[ORE\].*ακόλουθοι IG: 870.*insights: OK.*online_followers: OK/.test(out[0]), out[0]);
  assert.strictEqual(env.puts.length + env.sent.length + env.mails.length, 0);
  assert.strictEqual(JSON.stringify(env.props), before);
});

// ------------------------------------------------------------------ πληρωμές Viva (Billing.gs)
// Ψεύτικη Viva: token, παραγγελίες, έλεγχος πληρωμής ανά παραγγελία, μηνιαία χρέωση.
function vivaFake() {
  const v = { orders: [], charges: [], paid: {}, chargeFail: false, n: 0 };
  v.fetch = function (url, o, resp) {
    if (!/vivapayments\.com/.test(url)) return null;
    if (/\/connect\/token$/.test(url)) return resp(200, { access_token: 'VT', expires_in: 3600 });
    if (/\/checkout\/v2\/orders$/.test(url) && o.method === 'post') {
      const b = JSON.parse(o.payload); v.orders.push(b); return resp(200, { orderCode: 9000000000000000 + (++v.n) });
    }
    let m = url.match(/\/api\/transactions\/\?ordercode=(\d+)/);
    if (m) return resp(200, v.paid[m[1]] ? { Transactions: [{ TransactionId: v.paid[m[1]], StatusId: 'F', Amount: 186 }], ErrorCode: 0 } : { Transactions: [], ErrorCode: 0 });
    if (/\/api\/transactions\/\?date=/.test(url)) return resp(200, { Transactions: [], ErrorCode: 0 });
    m = url.match(/\/api\/transactions\/([^/?]+)$/);
    if (m && o.method === 'post') {
      v.charges.push({ tx: decodeURIComponent(m[1]), body: JSON.parse(o.payload), auth: o.headers.Authorization });
      return v.chargeFail ? resp(200, { StatusId: 'E', ErrorCode: 10051, ErrorText: 'Insufficient funds', Success: false })
        : resp(200, { StatusId: 'F', TransactionId: 'R' + (++v.n), ErrorCode: 0, Success: true });
    }
    return resp(404, { message: 'unknown viva call' });
  };
  return v;
}
const VIVA_PROPS = { VIVA_CLIENT_ID: 'cid', VIVA_CLIENT_SECRET: 'csec', VIVA_MERCHANT_ID: 'mid', VIVA_API_KEY: 'mkey' };
function billEnv(now, extra, queue) {
  const v = vivaFake();
  const props = Object.assign({}, BASE_PROPS, VIVA_PROPS, { QUEUE_URL_ORE: 'https://example.com/q.json' }, extra || {});
  const env = makeEnv({ props: props, now: now, queues: { 'https://example.com/q.json': queue || { version: 1, items: [] } }, extraFetch: v.fetch });
  env.viva = v;
  env.at = function (t) { env.nowMs = new Date(t).getTime(); };
  env.state = function () { return JSON.parse(env.props.BILLING_ORE); };
  env.req = function (r) { const res = {}; env.ctx.doRequest_('ORE', r, res); return res; };
  return env;
}
function lastOrderCode(env) { return String(9000000000000000 + env.viva.n); }
const PAID_FEB = { plan: 'Βασικό', amount: 18600, start: '2027-02', stop_after: null, tx: 'TX1', months: { '2027-02': { st: 'paid', tx: 'TX1' } } };

test('πληρωμές: billing_start → παραγγελία με αποθήκευση κάρτας, σύνδεσμος ΜΟΝΟ στο email του πελάτη', function () {
  const env = billEnv('2027-01-28T12:00:00+02:00');
  const res = env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02' });
  assert.strictEqual(env.viva.orders.length, 1);
  const o = env.viva.orders[0];
  assert.strictEqual(o.amount, 18600);
  assert.strictEqual(o.allowRecurring, true);
  assert.strictEqual(o.customer.email, 'center@example.com');
  assert.ok(o.paymentTimeout >= 86400);
  assert.ok(/^https:\/\/demo\.vivapayments\.com\/web\/checkout\?ref=\d+/.test(res.link));
  assert.strictEqual(env.mails.length, 1);
  assert.strictEqual(env.mails[0].to, 'center@example.com');
  assert.ok(env.mails[0].body.indexOf(res.link) >= 0 && /186,00/.test(env.mails[0].body));
  assert.strictEqual(env.state().months['2027-02'].st, 'pending');
  assert.ok(env.sheets['Πληρωμές'] && env.sheets['Πληρωμές'].rows.length >= 2);
});

test('πληρωμές: νέος πελάτης (free_month) → «Καλώς ήρθατε», 2ος μήνας με το σετάρισμα, 1ος δώρο, επόμενη χρέωση στον 3ο', function () {
  const env = billEnv('2026-12-10T12:00:00+02:00');
  const res = env.req({ type: 'billing_start', plan: 'Μεσαίο', amount_eur: 310, start: '2027-02', free_month: '2027-01' });
  assert.strictEqual(env.viva.orders.length, 1);
  assert.strictEqual(env.viva.orders[0].amount, 31000);
  const m = env.mails[0];
  assert.strictEqual(m.to, 'center@example.com');
  assert.ok(/Καλώς ήρθατε: πληρωμή για τον Φεβρουάριο 2027/.test(m.subject), m.subject);
  assert.ok(m.body.indexOf('Ο Ιανουάριος 2027 είναι δώρο μας. Για να ξεκινήσει, πληρώνετε τώρα τον Φεβρουάριο 2027') >= 0, m.body);
  assert.ok(m.body.indexOf(res.link) >= 0 && /310,00/.test(m.body));
  assert.ok(/Η επόμενη χρέωση, για τον Μάρτιο 2027, γίνεται αυτόματα την 1η του μήνα/.test(m.body));
  assert.ok(/Μετά τον Φεβρουάριο 2027 η συνδρομή σταματά όποτε θέλετε/.test(m.body));
  assert.ok(!/συνεχίζουμε μαζί/.test(m.body));
  assert.strictEqual(env.state().free_month, '2027-01');
  // πληρωμή → επιβεβαίωση με «δώρο»· τον Ιανουάριο καμία χρέωση, τον Φεβρουάριο καμία (πληρωμένος), τον Μάρτιο αυτόματα
  env.viva.paid[lastOrderCode(env)] = 'TX9';
  env.at('2026-12-10T13:00:00+02:00'); env.ctx.billingCycle();
  const c = env.mails[env.mails.length - 1];
  assert.ok(/Λάβαμε την πληρωμή για τον Φεβρουάριο 2027/.test(c.subject));
  assert.ok(/Ο Ιανουάριος 2027 είναι δώρο μας: ξεκινάμε να τον ετοιμάζουμε\. Η επόμενη χρέωση, για τον Μάρτιο 2027/.test(c.body), c.body);
  env.at('2027-01-01T10:00:00+02:00'); env.ctx.billingCycle();
  env.at('2027-02-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0);
  env.at('2027-03-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.deepStrictEqual([env.viva.charges.length, env.viva.charges[0].tx, env.viva.charges[0].body.amount], [1, 'TX9', 31000]);
});

test('πληρωμές: άκυρος free_month (όχι πριν από τον start) → σφάλμα, τίποτα στη Viva', function () {
  const env = billEnv('2026-12-10T12:00:00+02:00');
  assert.throws(function () { env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02', free_month: '2027-02' }); }, /free_month/);
  assert.throws(function () { env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02', free_month: 'Ιαν' }); }, /free_month/);
  assert.strictEqual(env.viva.orders.length, 0);
  assert.strictEqual(env.mails.length, 0);
});

test('πληρωμές: επιβεβαίωση χωρίς «επόμενη χρέωση» όταν η συνδρομή λήγει εκεί· σωστή αλλαγή χρονιάς', function () {
  const env = billEnv('2027-11-20T12:00:00+02:00');
  env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-12' });
  assert.ok(/Η επόμενη χρέωση, για τον Ιανουάριο 2028/.test(env.mails[0].body), env.mails[0].body);
  env.req({ type: 'billing_stop', after: '2027-12' });
  env.viva.paid[lastOrderCode(env)] = 'TX5';
  env.at('2027-11-20T13:00:00+02:00'); env.ctx.billingCycle();
  const c = env.mails[env.mails.length - 1];
  assert.ok(/Λάβαμε την πληρωμή για τον Δεκέμβριο 2027/.test(c.subject));
  assert.ok(!/επόμενη χρέωση/.test(c.body), c.body);
});

const EXEC = 'https://script.google.com/macros/s/AKfyTEST/exec';
// τα email εκτός από το παλιό «Σύνδεσμος διαχειριστικού» (δεν στέλνεται πια· μένει για ασφάλεια)
function noAdmLink(env) { return env.mails.filter(function (m) { return !/Σύνδεσμος διαχειριστικού/.test(m.subject); }); }

test('web app: την πρώτη φορά που ανοίγει γράφει τη διεύθυνσή του (/exec) στο WEBAPP_URL· όχι /dev ή κενό', function () {
  const env = billEnv('2027-02-10T10:00:00+02:00');
  env.ctx.ScriptApp.getService = function () { return { getUrl: function () { return 'https://script.google.com/macros/s/AKfyDEV/dev'; } }; };
  env.ctx.doGet({ parameter: {} });
  assert.strictEqual(env.props.WEBAPP_URL, undefined);
  env.ctx.ScriptApp.getService = function () { return { getUrl: function () { return EXEC; } }; };
  env.ctx.doGet({ parameter: {} });
  assert.strictEqual(env.props.WEBAPP_URL, EXEC);
  env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-03' });
  assert.ok(noAdmLink(env)[0].body.indexOf('Διακοπή συνδρομής: ' + EXEC + '?a=stop&c=ORE&k=') >= 0, 'το email παίρνει τη διεύθυνση');
});
function stopKey(env) { return env.props.BILLING_KEY_ORE; }

test('διακοπή: κουμπί «Διακοπή συνδρομής» στα email πληρωμής (κείμενο + html), όχι στο email της δωρεάν εβδομάδας', function () {
  const env = billEnv('2027-01-28T12:00:00+02:00', { WEBAPP_URL: EXEC });
  env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02' });
  const m = env.mails[0];
  const url = EXEC + '?a=stop&c=ORE&k=' + stopKey(env);
  assert.ok(stopKey(env) && stopKey(env).length >= 20, 'κλειδί πελάτη');
  assert.ok(m.body.indexOf('Διακοπή συνδρομής: ' + url) >= 0, m.body);
  assert.ok(m.htmlBody.indexOf('href="' + url.replace(/&/g, '&amp;') + '"') >= 0 && />Διακοπή συνδρομής<\/a>/.test(m.htmlBody), m.htmlBody);
  assert.ok(/<a href="https:\/\/demo\.vivapayments\.com/.test(m.htmlBody), 'ο σύνδεσμος πληρωμής πατιέται');
  env.viva.paid[lastOrderCode(env)] = 'TX1';
  env.at('2027-01-28T13:00:00+02:00'); env.ctx.billingCycle();
  assert.ok(env.mails[1].body.indexOf('Διακοπή συνδρομής: ' + url) >= 0, 'και στην επιβεβαίωση πληρωμής');
  const t = billEnv('2027-01-17T10:00:00+02:00', { UPLOAD_URL: EXEC });
  t.req({ type: 'billing_start', plan: 'Μεσαίο', amount_eur: 310, start: '2027-02', trial: true });
  assert.ok(!/Διακοπή συνδρομής/.test(t.mails[0].body) && !t.mails[0].htmlBody, 'όχι στη δωρεάν εβδομάδα');
});

test('διακοπή: χωρίς διεύθυνση web app → «απαντήστε σε αυτό το email» αντί για σύνδεσμο', function () {
  const env = billEnv('2027-01-28T12:00:00+02:00');
  env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02' });
  assert.ok(/Για διακοπή της συνδρομής, απαντήστε σε αυτό το email έως τις 15 του μήνα/.test(env.mails[0].body));
  assert.ok(!/a=stop/.test(env.mails[0].body));
});

test('διακοπή: η σελίδα δεν σταματά τίποτα μόνη της· λάθος κλειδί → «δεν ισχύει»· χωρίς πληρωμή → «δεν βρέθηκε»', function () {
  const env = billEnv('2027-02-10T10:00:00+02:00', { UPLOAD_URL: EXEC, BILLING_ORE: JSON.stringify(PAID_FEB), BILLING_KEY_ORE: 'k123456789012345678901234' });
  const page = env.ctx.doGet({ parameter: { a: 'stop', c: 'ore', k: 'k123456789012345678901234' } });
  assert.ok(/Συνδρομή: <b>Βασικό<\/b> · €186,00/.test(page.html), page.html);
  assert.ok(/συνεχίζονται ως και τον <b>Φεβρουάριο 2027<\/b>/.test(page.html), 'έως τις 15 → μετά τον τρέχοντα μήνα');
  assert.ok(/<button id="b">Διακοπή συνδρομής<\/button>/.test(page.html) && /billingStopWeb\("ore","k123456789012345678901234"\)/.test(page.html));
  assert.strictEqual(page.title, 'Διακοπή συνδρομής · okpublisher');
  assert.strictEqual(env.state().stop_after, null, 'το άνοιγμα δεν αλλάζει τίποτα');
  assert.strictEqual(noAdmLink(env).length, 0);
  assert.ok(/δεν ισχύει/.test(env.ctx.doGet({ parameter: { a: 'stop', c: 'ORE', k: 'λάθος' } }).html));
  assert.ok(/δεν ισχύει/.test(env.ctx.doGet({ parameter: { a: 'stop', c: 'ORE' } }).html));
  const e2 = billEnv('2027-02-10T10:00:00+02:00', { BILLING_KEY_ORE: 'k123456789012345678901234' });
  assert.ok(/Δεν βρέθηκε ενεργή συνδρομή/.test(e2.ctx.doGet({ parameter: { a: 'stop', c: 'ORE', k: 'k123456789012345678901234' } }).html));
  // το doGet της συντόμευσης δεν άλλαξε
  assert.deepStrictEqual(JSON.parse(env.ctx.doGet({ parameter: {} }).text), { error: 'Λάθος κλειδί', service: 'okpublisher' });
});

test('διακοπή: το κουμπί → λύση (έως τις 15: μετά τον τρέχοντα μήνα), email στον πελάτη + στο okpublisher, μία φορά', function () {
  const env = billEnv('2027-02-10T10:00:00+02:00', { UPLOAD_URL: EXEC, BILLING_ORE: JSON.stringify(PAID_FEB), BILLING_KEY_ORE: 'k123456789012345678901234' });
  const r = env.ctx.billingStopWeb('ORE', 'k123456789012345678901234');
  assert.ok(/Έγινε\./.test(r) && /μετά τον <b>Φεβρουάριο 2027<\/b>/.test(r), r);
  assert.strictEqual(env.state().stop_after, '2027-02');
  const toClient = env.mails.filter(function (m) { return m.to === 'center@example.com'; });
  const toSystem = env.mails.filter(function (m) { return m.to === 'system@example.com'; });
  assert.strictEqual(toClient.length, 1);
  assert.ok(/Η συνδρομή σας σταματά μετά τον Φεβρουάριο 2027/.test(toClient[0].subject));
  assert.strictEqual(toSystem.length, 1);
  assert.ok(/Διακοπή συνδρομής: ORE/.test(toSystem[0].subject));
  assert.ok(env.sheets['Πληρωμές'].rows.some(function (row) { return row.indexOf('λύση (κουμπί)') >= 0; }));
  const again = env.ctx.billingStopWeb('ORE', 'k123456789012345678901234');
  assert.ok(/σταματά ήδη μετά τον <b>Φεβρουάριο 2027/.test(again));
  assert.strictEqual(env.mails.length, 2, 'δεύτερο πάτημα: κανένα νέο email');
  env.at('2027-03-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0, 'καμία χρέωση τον Μάρτιο');
  assert.ok(/Δεν βρέθηκε ενεργή συνδρομή/.test(env.ctx.billingStopWeb('ORE', 'λάθος')));
});

test('διακοπή: μετά τις 15 → μετά τον επόμενο μήνα· πληρωμένος μήνας που δεν ξεκίνησε παραδίδεται', function () {
  let env = billEnv('2027-02-20T10:00:00+02:00', { BILLING_ORE: JSON.stringify(PAID_FEB), BILLING_KEY_ORE: 'k123456789012345678901234' });
  env.ctx.billingStopWeb('ORE', 'k123456789012345678901234');
  assert.strictEqual(env.state().stop_after, '2027-03');
  env.at('2027-03-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 1, 'ο Μάρτιος χρεώνεται (λύση μετά τις 15)');
  env.at('2027-04-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 1, 'ο Απρίλιος όχι');
  // πλήρωσε τον Φεβρουάριο (1ο μήνα) στις 18/1 και διακόπτει στις 20/1 → ο Φεβρουάριος παραδίδεται
  env = billEnv('2027-01-20T10:00:00+02:00', { BILLING_ORE: JSON.stringify(PAID_FEB), BILLING_KEY_ORE: 'k123456789012345678901234' });
  env.ctx.billingStopWeb('ORE', 'k123456789012345678901234');
  assert.strictEqual(env.state().stop_after, '2027-02');
});

test('web app: appsscript.json με «webapp» (εκτέλεση ως ο ιδιοκτήτης, πρόσβαση οποιοσδήποτε) — αλλιώς η νέα έκδοση σπάει το /exec', function () {
  const m = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'appsscript.json'), 'utf8'));
  assert.deepStrictEqual(m.webapp, { executeAs: 'USER_DEPLOYING', access: 'ANYONE_ANONYMOUS' });
});

test('πληρωμές: η πληρωμή με τον σύνδεσμο βρίσκεται μόνη της· αυτόματη χρέωση την 1η από τις 09:00, μία φορά', function () {
  const env = billEnv('2027-01-28T12:00:00+02:00');
  env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02' });
  env.viva.paid[lastOrderCode(env)] = 'TX1';
  env.at('2027-01-29T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.state().tx, 'TX1');
  assert.strictEqual(env.state().months['2027-02'].st, 'paid');
  assert.ok(/Λάβαμε την πληρωμή για τον Φεβρουάριο 2027/.test(env.mails[env.mails.length - 1].subject), 'επιβεβαίωση με email');
  env.at('2027-01-29T11:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.mails.filter(function (m) { return /Λάβαμε την πληρωμή/.test(m.subject); }).length, 1, 'μία επιβεβαίωση μόνο');
  env.at('2027-02-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0, 'ο Φεβρουάριος είναι ήδη πληρωμένος');
  env.at('2027-03-01T08:30:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0, 'πριν τις 09:00 καμία χρέωση');
  env.at('2027-03-01T09:05:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 1);
  assert.deepStrictEqual([env.viva.charges[0].tx, env.viva.charges[0].body.amount], ['TX1', 18600]);
  assert.ok(/^Basic /.test(env.viva.charges[0].auth));
  assert.strictEqual(env.state().months['2027-03'].st, 'paid');
  assert.ok(env.mails.some(function (m) { return /Χρεώθηκε η συνδρομή για τον Μάρτιο 2027/.test(m.subject) && m.to === 'center@example.com'; }));
  env.at('2027-03-01T10:05:00+02:00'); env.ctx.billingCycle();
  env.at('2027-03-20T10:05:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 1, 'ποτέ δεύτερη χρέωση για τον ίδιο μήνα');
});

test('πληρωμές: χρέωση που δεν περνά → σύνδεσμος, υπενθύμιση στις 8, παύση στις 16 χωρίς δημοσιεύσεις, επανεκκίνηση με την πληρωμή', function () {
  const queue = { version: 1, items: [{ id: 'ORE-2027-03-16-post', account: 'ORE', type: 'IMAGE', publish_at: '2027-03-16T10:00:00+02:00', images: ['https://example.com/i.jpg'], caption: 'x' }] };
  const env = billEnv('2027-03-01T09:30:00+02:00', { BILLING_ORE: JSON.stringify(PAID_FEB) }, queue);
  env.viva.chargeFail = true;
  env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 1);
  assert.strictEqual(env.viva.orders.length, 1);
  assert.strictEqual(env.state().months['2027-03'].st, 'pending');
  assert.ok(/δεν πέρασε/.test(env.mails[0].subject) && env.mails[0].to === 'center@example.com');
  env.at('2027-03-05T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.mails.length, 1, 'καμία ειδοποίηση πριν τις 8');
  env.at('2027-03-08T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.mails.length, 2);
  assert.ok(/Υπενθύμιση/.test(env.mails[1].subject));
  assert.strictEqual(env.viva.orders.length, 2, 'νέος σύνδεσμος (ο παλιός λήγει)');
  env.at('2027-03-09T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.mails.length, 2, 'μία υπενθύμιση μόνο');
  env.at('2027-03-16T10:05:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.props.BILLING_PAUSED_ORE, 'true');
  assert.ok(/σταμάτησαν προσωρινά/.test(env.mails[2].subject));
  env.ctx.run();
  assert.strictEqual(graphPosts(env).length, 0, 'σε παύση δεν δημοσιεύεται τίποτα');
  assert.strictEqual(env.viva.charges.length, 1, 'καμία δεύτερη αυτόματη χρέωση');
  env.viva.paid[lastOrderCode(env)] = 'TX2';
  env.at('2027-03-16T11:00:00+02:00'); env.ctx.billingCycle();
  assert.ok(!('BILLING_PAUSED_ORE' in env.props));
  assert.strictEqual(env.state().tx, 'TX2');
  assert.ok(/συνεχίζονται/.test(env.mails[env.mails.length - 1].subject));
  env.ctx.run();
  assert.ok(graphPosts(env).length > 0, 'μετά την πληρωμή οι δημοσιεύσεις συνεχίζονται');
  assert.ok(env.mails.every(function (m) { return m.to === 'center@example.com'; }), 'όλα τα email μόνο στον πελάτη');
});

test('πληρωμές: η χειροκίνητη παύση (PAUSED_<K>) δεν αναιρείται από την πληρωμή', function () {
  const st = JSON.parse(JSON.stringify(PAID_FEB));
  st.months['2027-03'] = { st: 'pending', order: '9000000000000777', order_at: '2027-03-16T10:00:00+02:00', paused: '2027-03-16T10:00:00+02:00' };
  const env = billEnv('2027-03-17T10:00:00+02:00', { BILLING_ORE: JSON.stringify(st), BILLING_PAUSED_ORE: 'true', PAUSED_ORE: 'true' });
  env.viva.paid['9000000000000777'] = 'TX3';
  env.ctx.billingCycle();
  assert.ok(!('BILLING_PAUSED_ORE' in env.props));
  assert.strictEqual(env.props.PAUSED_ORE, 'true');
});

test('πληρωμές: billing_stop → καμία χρέωση μετά τον τελευταίο μήνα', function () {
  const env = billEnv('2027-02-10T10:00:00+02:00', { BILLING_ORE: JSON.stringify(PAID_FEB) });
  env.req({ type: 'billing_stop', after: '2027-02' });
  assert.strictEqual(env.mails.length, 1, 'email επιβεβαίωσης διακοπής');
  assert.strictEqual(env.mails[0].to, 'center@example.com');
  assert.ok(/Η συνδρομή σας σταματά μετά τον Φεβρουάριο 2027/.test(env.mails[0].subject), env.mails[0].subject);
  assert.ok(/δεν θα γίνει καμία άλλη χρέωση/.test(env.mails[0].body));
  env.at('2027-03-01T10:00:00+02:00'); env.ctx.billingCycle();
  env.at('2027-04-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0);
  assert.strictEqual(env.mails.length, 1);
});

test('πληρωμές: billing_stop με quiet → χωρίς email στον πελάτη', function () {
  const env = billEnv('2027-02-10T10:00:00+02:00', { BILLING_ORE: JSON.stringify(PAID_FEB) });
  env.req({ type: 'billing_stop', after: '2027-02', quiet: true });
  assert.strictEqual(env.mails.length, 0);
  assert.strictEqual(env.state().stop_after, '2027-02');
});

test('πληρωμές: μετά τη δωρεάν εβδομάδα (trial) → «Συνεχίζουμε;» με σύνδεσμο για τον 1ο μήνα, μετά αυτόματα', function () {
  const env = billEnv('2027-01-17T10:00:00+02:00');
  const res = env.req({ type: 'billing_start', plan: 'Μεσαίο', amount_eur: 310, start: '2027-02', trial: true });
  const m = env.mails[0];
  assert.strictEqual(env.mails.length, 1);
  assert.strictEqual(m.to, 'center@example.com');
  assert.ok(/Πώς σας φάνηκε η δωρεάν εβδομάδα; Συνεχίζουμε;/.test(m.subject), m.subject);
  assert.ok(m.body.indexOf('πληρώνετε τον Φεβρουάριο 2027 και ξεκινάμε την 1η του μήνα') >= 0, m.body);
  assert.ok(m.body.indexOf(res.link) >= 0 && /310,00/.test(m.body));
  assert.ok(/Η επόμενη χρέωση, για τον Μάρτιο 2027/.test(m.body));
  assert.ok(/Αν δεν συνεχίσουμε, δεν χρειάζεται να κάνετε τίποτα/.test(m.body));
  assert.ok(!/Καλώς ήρθατε|συνεχίζουμε μαζί/.test(m.body));
  env.viva.paid[lastOrderCode(env)] = 'TX7';
  env.at('2027-01-18T10:00:00+02:00'); env.ctx.billingCycle();
  assert.ok(/Λάβαμε την πληρωμή για τον Φεβρουάριο 2027/.test(env.mails[env.mails.length - 1].subject));
  env.at('2027-02-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0, 'ο Φεβρουάριος πληρώθηκε');
  env.at('2027-03-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.deepStrictEqual([env.viva.charges.length, env.viva.charges[0].tx], [1, 'TX7']);
});

test('πληρωμές: απλήρωτος προηγούμενος μήνας → ο νέος μήνας δεν χρεώνεται', function () {
  const st = JSON.parse(JSON.stringify(PAID_FEB));
  st.months['2027-02'] = { st: 'pending', order: '9000000000000555', order_at: '2027-02-01T10:00:00+02:00', reminded: 'x', paused: 'x' };
  const env = billEnv('2027-03-01T10:00:00+02:00', { BILLING_ORE: JSON.stringify(st), BILLING_PAUSED_ORE: 'true' });
  env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0);
  assert.ok(!env.state().months['2027-03']);
});

test('πληρωμές: χρέωση που κόπηκε στη μέση δεν ξαναγίνεται (email μόνο στο okpublisher)', function () {
  const st = JSON.parse(JSON.stringify(PAID_FEB));
  st.months['2027-03'] = { st: 'charging', at: '2027-03-01T09:00:00+02:00' };
  const env = billEnv('2027-03-01T11:00:00+02:00', { BILLING_ORE: JSON.stringify(st) });
  env.ctx.billingCycle();
  env.at('2027-03-01T12:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0);
  assert.strictEqual(env.mails.length, 1, 'ένα email την ημέρα, όχι κάθε ώρα');
  assert.strictEqual(env.mails[0].to, 'system@example.com');
});

test('πληρωμές: χωρίς κλειδιά Viva → καμία χρέωση, τίποτα «στη μέση», email στο okpublisher', function () {
  const env = billEnv('2027-03-01T10:00:00+02:00', { BILLING_ORE: JSON.stringify(PAID_FEB), VIVA_API_KEY: '' });
  env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0);
  assert.ok(!env.state().months['2027-03']);
  assert.strictEqual(env.mails.length, 1);
  assert.strictEqual(env.mails[0].to, 'system@example.com');
  assert.ok(/VIVA_API_KEY/.test(env.mails[0].body));
});

test('πληρωμές: άκυρο billing_start → σφάλμα, τίποτα στη Viva, κανένα email', function () {
  const env = billEnv('2027-01-28T12:00:00+02:00');
  assert.throws(function () { env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 0, start: '2027-02' }); }, /ποσό/);
  assert.throws(function () { env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186 }); }, /πρώτος μήνας/);
  env.props.BILLING_ORE = JSON.stringify(PAID_FEB);
  assert.throws(function () { env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-03' }); }, /ενεργή συνδρομή/);
  assert.strictEqual(env.viva.orders.length, 0);
  assert.strictEqual(env.mails.length, 0);
});

test('πληρωμές: δοκιμαστικός πελάτης TST (TEST_CLIENTS) · demoChargeNow μόνο στη demo', function () {
  const st = JSON.parse(JSON.stringify(PAID_FEB));
  const env = billEnv('2027-02-10T10:00:00+02:00', { TEST_CLIENTS: 'TST', NOTIFY_TO_TST: 'test@example.com', BILLING_TST: JSON.stringify(st) });
  const c = env.ctx.demoChargeNow();
  assert.ok(c.ok);
  assert.strictEqual(env.viva.charges.length, 1);
  assert.strictEqual(env.viva.charges[0].tx, 'TX1');
  assert.ok(!JSON.parse(env.props.BILLING_TST).months['demo'], 'οι μήνες του πελάτη δεν αλλάζουν');
  env.props.VIVA_ENV = 'live';
  assert.throws(function () { env.ctx.demoChargeNow(); }, /μόνο με VIVA_ENV=demo/);
  assert.strictEqual(env.viva.charges.length, 1);
  env.props.VIVA_ENV = 'demo';
  env.at('2027-03-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.ok(env.viva.charges.some(function (x) { return x.body.merchantTrns === 'okp TST 2027-03'; }), 'ο TST χρεώνεται κι αυτός από τον κύκλο');
});

test('πληρωμές: η Viva αρνείται την παραγγελία → καμία κατάσταση, κανένα email· νέο billing_start καθαρίζει ό,τι απλήρωτο', function () {
  const env = billEnv('2026-11-25T18:00:00+02:00');
  const ok = env.viva.fetch;
  env.viva.fetch = function (url, o, resp) {
    if (/\/checkout\/v2\/orders$/.test(url)) return resp(403, { status: 403, message: 'no source with code 7901' });
    return ok(url, o, resp);
  };
  env.ctx.UrlFetchApp.fetch = (function (orig) { return function (u, o) { const r = env.viva.fetch(u, o || {}, function (c, b) { return { getResponseCode: () => c, getContentText: () => JSON.stringify(b) }; }); return r || orig(u, o); }; })(env.ctx.UrlFetchApp.fetch);
  assert.throws(function () { env.req({ type: 'billing_start', plan: 'Δοκιμή', amount_eur: 1, start: '2026-12' }); }, /403/);
  assert.ok(!('BILLING_ORE' in env.props), 'τίποτα μισό');
  assert.strictEqual(env.mails.length, 0);
  // παλιά «μισή» κατάσταση (από την προηγούμενη έκδοση): το νέο billing_start την καθαρίζει
  env.viva.fetch = ok;
  env.props.BILLING_ORE = JSON.stringify({ plan: 'Δοκιμή', amount: 100, start: '2026-11', tx: null, months: { '2026-11': { st: 'pending' } } });
  env.props.BILLING_PAUSED_ORE = 'true';
  env.req({ type: 'billing_start', plan: 'Δοκιμή', amount_eur: 1, start: '2026-12' });
  assert.deepStrictEqual(Object.keys(env.state().months), ['2026-12']);
  assert.ok(env.state().months['2026-12'].order);
  assert.ok(!('BILLING_PAUSED_ORE' in env.props));
});

test('πληρωμές: VIVA_ENV=live → πραγματικοί διακομιστές της Viva', function () {
  const env = billEnv('2027-01-28T12:00:00+02:00', { VIVA_ENV: 'live' });
  const seen = [];
  const orig = env.ctx.UrlFetchApp.fetch;
  env.ctx.UrlFetchApp.fetch = function (u, o) { seen.push(u); return orig(u.replace('://accounts.', '://demo-accounts.').replace('://api.', '://demo-api.').replace('://www.', '://demo.'), o); };
  const res = env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02' });
  assert.ok(seen.indexOf('https://accounts.vivapayments.com/connect/token') >= 0);
  assert.ok(seen.indexOf('https://api.vivapayments.com/checkout/v2/orders') >= 0);
  assert.ok(/^https:\/\/www\.vivapayments\.com\/web\/checkout\?ref=/.test(res.link));
});

// Σύγκριση με τον παλιό LS Publisher: για την ίδια ουρά, οι ίδιες ακριβώς κλήσεις στο Meta (εκτός από το token).
if (OLD_DIR) {
  test('ίδιες κλήσεις Meta με τον παλιό LS Publisher (carousel, story, reel, reel-story, εικόνα)', function () {
    const moments = ['2026-12-01T10:02:00+02:00', '2026-12-01T22:02:00+02:00', '2026-12-04T22:02:00+02:00', '2026-12-04T22:17:00+02:00', '2026-12-06T22:02:00+02:00'];
    function seq(env) {
      return graphPosts(env).map(function (c) {
        const pl = Object.assign({}, c.payload); delete pl.access_token;
        return c.url.replace(/IG1|PAGE1/g, 'X') + ' ' + JSON.stringify(pl);
      });
    }
    const oldEnv = makeEnv({ dir: OLD_DIR, props: { TOKEN_LS: 'tokLS', IG_USER_LS: 'IG1', FB_PAGE_LS: 'PAGE1' }, queues: { [OLD_Q]: lsQueue() }, now: moments[0] });
    const newEnv = makeEnv({ props: Object.assign({}, BASE_PROPS, { START_AFTER: '2026-11-30T00:00:00+02:00' }), queues: { [OLD_Q]: lsQueue() }, now: moments[0] });
    moments.forEach(function (m) {
      oldEnv.nowMs = newEnv.nowMs = new Date(m).getTime();
      oldEnv.ctx.run(); newEnv.ctx.run();
    });
    assert.deepStrictEqual(seq(newEnv), seq(oldEnv));
    assert.deepStrictEqual(statusKeys(newEnv), statusKeys(oldEnv).filter(function (k) { return k !== 'QEND_WARNED'; }));
    assert.ok(seq(newEnv).length >= 10);
  });
}

// ------------------------------------------------------------------ κωδικός πληρωμής + διαγραφή δοκιμαστικού πελάτη
test('κωδικός πληρωμής: κάθε πληρωμή PAY-0001, PAY-0002… με πελάτη, πακέτο και μήνα (καρτέλα, email, κατάσταση)', function () {
  const env = billEnv('2027-01-28T12:00:00+02:00');
  env.req({ type: 'billing_start', plan: 'Μεσαίο', amount_eur: 310, start: '2027-02', code: 'OK-0007' });
  env.viva.paid[lastOrderCode(env)] = 'TX9';
  env.at('2027-01-28T13:00:00+02:00'); env.ctx.billingCycle();
  let st = env.state();
  assert.deepStrictEqual([st.code, st.months['2027-02'].pay, st.months['2027-02'].plan, st.months['2027-02'].amount], ['OK-0007', 'PAY-0001', 'Μεσαίο', 31000]);
  const m1 = env.mails[env.mails.length - 1];
  assert.ok(/Κωδικός πληρωμής: PAY-0001 · Πελάτης: OK-0007 · Πακέτο: Μεσαίο · Μήνας: Φεβρουάριος 2027\./.test(m1.body), m1.body);
  env.at('2027-03-01T10:00:00+02:00'); env.ctx.billingCycle();
  st = env.state();
  assert.strictEqual(st.months['2027-03'].pay, 'PAY-0002');
  assert.ok(/Κωδικός πληρωμής: PAY-0002 · Πελάτης: OK-0007 · Πακέτο: Μεσαίο · Μήνας: Μάρτιος 2027\./.test(env.mails[env.mails.length - 1].body));
  const sh = env.sheets['Πληρωμές'];
  assert.deepStrictEqual(sh.rows[0].slice(7), ['Κωδικός πληρωμής', 'Κωδικός πελάτη', 'Όνομα πελάτη', 'Πακέτο']);
  const paid = sh.rows.filter(function (r) { return r[5] === 'πληρώθηκε'; });
  assert.deepStrictEqual(paid.map(function (r) { return [r[1], r[2], r[3], r[7], r[8], r[9], r[10]]; }),
    [['ORE', '2027-02', 310, 'PAY-0001', 'OK-0007', 'Learning & Sensory Ωραιόκαστρο', 'Μεσαίο'], ['ORE', '2027-03', 310, 'PAY-0002', 'OK-0007', 'Learning & Sensory Ωραιόκαστρο', 'Μεσαίο']]);
  assert.ok(sh.rows.filter(function (r) { return r[5] !== 'πληρώθηκε' && r !== sh.rows[0]; }).every(function (r) { return r[7] === ''; }), 'κωδικός μόνο στις πληρωμές');
  assert.strictEqual(env.props.PAY_SEQ, '2');
});

test('κωδικός πληρωμής: παλιά καρτέλα «Πληρωμές» → οι νέες στήλες μπαίνουν στο τέλος της επικεφαλίδας', function () {
  const env = billEnv('2027-02-10T12:00:00+02:00', { BILLING_ORE: JSON.stringify(PAID_FEB) });
  const sh = env.ctx.SpreadsheetApp.getActive().insertSheet('Πληρωμές');
  sh.getRange(1, 1, 1, 7).setValues([['Χρόνος', 'Πελάτης', 'Μήνας', 'Ποσό €', 'Ενέργεια', 'Αποτέλεσμα', 'Κωδικός']]);
  sh.appendRow(['t', 'ORE', '2027-02', 186, 'πληρωμή με σύνδεσμο', 'πληρώθηκε', 'TX1']);
  env.req({ type: 'billing_stop', after: '2027-03' });
  assert.strictEqual(sh.rows[0].length, 11);
  assert.strictEqual(sh.rows[0][7], 'Κωδικός πληρωμής');
  assert.strictEqual(sh.rows[1][6], 'TX1', 'οι παλιές γραμμές δεν άλλαξαν');
});

test('δοκιμαστικός πελάτης: test_client_remove σβήνει ρυθμίσεις, συνδρομή και γραμμές πληρωμών — μόνο του TST', function () {
  const env = billEnv('2026-11-26T18:00:00+02:00', { TEST_CLIENTS: 'TST', BILLING_TEST_CLIENT: 'TST', NAME_TST: 'Δοκιμή okpublisher',
    NOTIFY_TO_TST: 'okp@example.com', BILLING_TST: '{"plan":"Βασικό","amount":100}', BILLING_KEY_TST: 'k', BILLING_PAUSED_TST: 'false',
    BILLING_ORE: JSON.stringify(PAID_FEB), BILLING_KEY_ORE: 'ok' });
  const sh = env.ctx.SpreadsheetApp.getActive().insertSheet('Πληρωμές');
  sh.getRange(1, 1, 1, 7).setValues([['Χρόνος', 'Πελάτης', 'Μήνας', 'Ποσό €', 'Ενέργεια', 'Αποτέλεσμα', 'Κωδικός']]);
  sh.appendRow(['t1', 'TST', '2026-12', 1, 'πληρωμή με σύνδεσμο', 'πληρώθηκε', 'x']);
  sh.appendRow(['t2', 'ORE', '2027-02', 186, 'πληρωμή με σύνδεσμο', 'πληρώθηκε', 'y']);
  sh.appendRow(['t3', 'TST', 'demo', 1, 'δοκιμαστική χρέωση', 'πέρασε', 'z']);
  assert.throws(function () { env.ctx.doRequest_('ORE', { type: 'test_client_remove' }, {}); }, /μόνο για δοκιμαστικό/, 'πραγματικός πελάτης: ποτέ');
  const res = {};
  env.ctx.doRequest_('TST', { type: 'test_client_remove' }, res);
  assert.deepStrictEqual(Array.from(res.removed_settings), ['BILLING_KEY_TST', 'BILLING_PAUSED_TST', 'BILLING_TEST_CLIENT', 'BILLING_TST', 'NAME_TST', 'NOTIFY_TO_TST']);
  assert.strictEqual(res.removed_payment_rows, 2);
  assert.ok(Object.keys(env.props).every(function (k) { return !/_TST$/.test(k); }));
  assert.strictEqual(env.props.TEST_CLIENTS, '');
  assert.ok(env.props.BILLING_ORE && env.props.BILLING_KEY_ORE && env.props.NAME_ORE, 'ο ORE δεν άγγιξε');
  const left = sh.rows.slice(1).filter(function (r) { return r.length && r[0] !== ''; });
  assert.deepStrictEqual(left.map(function (r) { return r[1]; }), ['ORE']);
  assert.ok(/Δοκιμαστικός πελάτης TST: σβήστηκε/.test(env.mails[env.mails.length - 1].subject));
  assert.throws(function () { env.ctx.doRequest_('TST', { type: 'test_client_remove' }, {}); }, /μόνο για δοκιμαστικό/, 'δεύτερη φορά: δεν υπάρχει πια');
});

// ------------------------------------------------------------------ δωρεάν πελάτες + όνομα στη Viva
test('Viva: «OK Publisher» στη σελίδα πληρωμής (dynamicDescriptor)· αν η Viva το αρνηθεί → ξανά χωρίς, ο σύνδεσμος βγαίνει', function () {
  let env = billEnv('2027-01-28T12:00:00+02:00');
  env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02' });
  assert.strictEqual(env.viva.orders[0].dynamicDescriptor, 'OK Publisher');
  env = billEnv('2027-01-28T12:00:00+02:00');
  const orig = env.ctx.UrlFetchApp.fetch;
  let refused = 0;
  env.ctx.UrlFetchApp.fetch = function (url, o) {
    if (/checkout\/v2\/orders/.test(url) && JSON.parse(o.payload).dynamicDescriptor) { refused++; return { getResponseCode: () => 400, getContentText: () => '{"message":"descriptor"}' }; }
    return orig(url, o);
  };
  const res = env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02' });
  assert.strictEqual(refused, 1);
  assert.ok(/checkout\?ref=/.test(res.link));
  assert.ok(!('dynamicDescriptor' in env.viva.orders[0]));
});

test('δωρεάν πελάτες: στις 15 του τελευταίου δωρεάν μήνα email «λήγει» (μία φορά), μετά «έληξε» αν δεν πληρώνει· χωρίς λήξη τίποτα', function () {
  const env = admEnv({}, { gh: {
    'clients': [{ name: 'ORE', type: 'dir' }, { name: 'GFT', type: 'dir' }, { name: 'PAI', type: 'dir' }],
    'clients/ORE/config.json': { key: 'ORE', code: 'OK-0001', billing: { type: 'free' } },
    'clients/GFT/config.json': { key: 'GFT', code: 'OK-0005', name: 'Φίλος', package: 'Μεσαίο', billing: { type: 'free', until: '2027-03' } },
    'clients/PAI/config.json': { key: 'PAI', code: 'OK-0006', name: 'Πληρώνει', billing: { type: 'free', until: '2027-03' } },
  } });
  env.props.BILLING_PAI = JSON.stringify({ plan: 'Βασικό', amount: 18600, start: '2027-04', tx: 'T', months: { '2027-04': { st: 'paid' } } });
  const sys = function () { return env.mails.filter(function (m) { return /^\[okpublisher\] Δωρεάν/.test(m.subject); }); };
  const at = function (t) { env.nowMs = new Date(t).getTime(); env.ctx.billingCycle(); };
  at('2027-03-14T10:00:00+02:00');
  assert.strictEqual(sys().length, 0, 'πριν τις 15');
  at('2027-03-15T08:00:00+02:00');
  assert.strictEqual(sys().length, 0, 'πριν τις 09:00');
  at('2027-03-15T10:00:00+02:00');
  assert.strictEqual(sys().length, 1);
  assert.ok(/Δωρεάν έως Μάρτιο 2027: OK-0005 · Φίλος \(GFT\)/.test(sys()[0].subject), sys()[0].subject);
  assert.ok(/πακέτο Μεσαίο/.test(sys()[0].body) && /σύνδεσμο πληρωμής για τον Απρίλιο 2027/.test(sys()[0].body));
  assert.strictEqual(sys()[0].to, 'system@example.com');
  at('2027-03-15T11:00:00+02:00'); at('2027-03-16T10:00:00+02:00');
  assert.strictEqual(sys().length, 1, 'μία φορά');
  at('2027-04-02T10:00:00+02:00');
  assert.strictEqual(sys().length, 2);
  assert.ok(/Δωρεάν: έληξε για OK-0005 · Φίλος \(GFT\)/.test(sys()[1].subject));
  at('2027-04-03T10:00:00+02:00');
  assert.strictEqual(sys().length, 2);
  assert.ok(!sys().some(function (m) { return /PAI|ORE/.test(m.subject); }), 'όποιος πληρώνει ή δεν έχει λήξη: τίποτα');
  const tok = env.loginAs('system@example.com');
  const d = api(env, { act: 'data', token: tok }).data;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.clients.find(function (c) { return c.key === 'GFT'; }).free)), { until: '2027-03' });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.clients.find(function (c) { return c.key === 'ORE'; }).free)), { until: '' });
});

// ------------------------------------------------------------------ αλλαγή πακέτου (Billing.gs, όροι v7 Α.3)
function planEnv(now, st) {
  const env = billEnv(now, { BILLING_ORE: JSON.stringify(st || PAID_FEB), BILLING_KEY_ORE: 'pk123', WEBAPP_URL: EXEC, GITHUB_TOKEN: 'ghtok' });
  env.ghPuts = [];
  const prev = env.ctx.UrlFetchApp.fetch;
  env.ctx.UrlFetchApp.fetch = function (url, o) {
    if (url.indexOf('https://api.github.com/repos/okpublisher/publisher-work/contents/') === 0 && o && o.method === 'put') {
      env.ghPuts.push({ path: decodeURIComponent(url.split('/contents/')[1]), body: JSON.parse(Buffer.from(JSON.parse(o.payload).content, 'base64').toString('utf8')) });
      return { getResponseCode: () => 201, getContentText: () => '{}' };
    }
    return prev(url, o);
  };
  env.page = function (k) { return env.ctx.doGet({ parameter: { a: 'plan', c: 'ORE', k: k || 'pk123' } }).html; };
  env.web = function (plan) { return env.ctx.billingPlanWeb('ORE', 'pk123', plan); };
  env.mine = function () { return noAdmLink(env).filter(function (m) { return m.to === 'center@example.com'; }); };
  env.sys = function () { return noAdmLink(env).filter(function (m) { return m.to === 'system@example.com'; }); };
  return env;
}

test('αλλαγή πακέτου: η σελίδα — λάθος κλειδί, χωρίς συνδρομή, απλήρωτο, κανονικά με τα 3 πακέτα και τον μήνα έναρξης', function () {
  let env = planEnv('2027-02-10T12:00:00+02:00');
  assert.ok(/δεν ισχύει/.test(env.page('λάθος')));
  const h = env.page();
  assert.ok(/Βασικό<\/b> · €150 \+ ΦΠΑ τον μήνα <i>\(τρέχον\)<\/i>/.test(h), h);
  assert.ok(/Μεσαίο/.test(h) && /Καθημερινό/.test(h) && /7 posts και 7 stories/.test(h));
  assert.ok(/ισχύει από τον <b>Μάρτιο 2027<\/b>/.test(h), 'έως τις 19 → ο επόμενος μήνας');
  assert.strictEqual(env.mails.filter(function (m) { return !/Σύνδεσμος διαχειριστικού/.test(m.subject); }).length, 0, 'το άνοιγμα δεν αλλάζει τίποτα');
  assert.ok(/ισχύει από τον <b>Απρίλιο 2027<\/b>/.test(planEnv('2027-02-20T08:00:00+02:00').page()), 'μετά τις 19 → ο μεθεπόμενος');
  env = planEnv('2027-02-10T12:00:00+02:00', Object.assign({}, PAID_FEB, { tx: null, months: { '2027-02': { st: 'pending' } } }));
  assert.ok(/Δεν βρέθηκε ενεργή συνδρομή/.test(env.page()));
  env = planEnv('2027-03-03T12:00:00+02:00', Object.assign({}, PAID_FEB, { months: { '2027-02': { st: 'paid' }, '2027-03': { st: 'pending' } } }));
  assert.ok(/πληρωμή σε εκκρεμότητα/.test(env.page()));
  assert.ok(/Δεν γίνεται αλλαγή/.test(env.web('Μεσαίο')));
  env = planEnv('2027-02-10T12:00:00+02:00', Object.assign({}, PAID_FEB, { stop_after: '2027-02' }));
  assert.ok(/σταματά μετά τον <b>Φεβρουάριο 2027/.test(env.page()));
});

test('αλλαγή πακέτου: αναβάθμιση → προγραμματίζεται, email σε πελάτη και okpublisher, σημείωση στο publisher-work, ισχύει την 1η', function () {
  const env = planEnv('2027-02-10T12:00:00+02:00');
  const r = env.web('Μεσαίο');
  assert.ok(/Από τον <b>Μάρτιο 2027<\/b> το πακέτο σας γίνεται <b>Μεσαίο<\/b> \(€310,00/.test(r), r);
  const st = env.state();
  assert.deepStrictEqual([st.plan, st.amount, st.change.plan, st.change.amount, st.change.from], ['Βασικό', 18600, 'Μεσαίο', 31000, '2027-03']);
  const m = env.mine();
  assert.strictEqual(m.length, 1);
  assert.ok(/Αλλαγή πακέτου σε Μεσαίο από τον Μάρτιο 2027/.test(m[0].subject));
  assert.ok(/4 posts και 4 stories την εβδομάδα\), €310,00/.test(m[0].body));
  assert.ok(m[0].body.indexOf('Αλλαγή πακέτου: ' + EXEC + '?a=plan&c=ORE&k=pk123') >= 0, 'κουμπί και στο email');
  assert.ok(/Αλλαγή πακέτου<\/a>/.test(m[0].htmlBody) && /Διακοπή συνδρομής<\/a>/.test(m[0].htmlBody));
  assert.ok(/Αλλαγή πακέτου: ORE/.test(env.sys()[0].subject));
  assert.ok(/Βασικό → Μεσαίο από τον Μάρτιο 2027/.test(env.sys()[0].body));
  assert.strictEqual(env.ghPuts.length, 1);
  assert.strictEqual(env.ghPuts[0].path, 'clients/ORE/package_change.json');
  assert.deepStrictEqual([env.ghPuts[0].body.plan, env.ghPuts[0].body.previous, env.ghPuts[0].body.from, env.ghPuts[0].body.status, env.ghPuts[0].body.week],
    ['Μεσαίο', 'Βασικό', '2027-03', 'scheduled', 4]);
  // τον Φεβρουάριο τίποτα· 1η Μαρτίου: χρέωση με το νέο ποσό, το νέο πακέτο γίνεται το τρέχον
  env.at('2027-02-28T12:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.state().plan, 'Βασικό');
  env.at('2027-03-01T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 1);
  assert.strictEqual(env.viva.charges[0].body.amount, 31000);
  const after = env.state();
  assert.deepStrictEqual([after.plan, after.amount, 'change' in after, after.plan_changed.previous], ['Μεσαίο', 31000, false, 'Βασικό']);
  const c = env.mine().pop();
  assert.ok(/Χρεώθηκε η συνδρομή για τον Μάρτιο 2027/.test(c.subject) && /Μεσαίο, €310,00/.test(c.body), c.body);
  assert.ok(env.sheets['Πληρωμές'].rows.some(function (r) { return r[4] === 'αλλαγή πακέτου: ισχύει'; }));
});

test('αλλαγή πακέτου: υποβάθμιση μετά τις 19 → από τον μεθεπόμενο· ποτέ για προπληρωμένο μήνα· ίδιο πακέτο = ακύρωση', function () {
  const top = { plan: 'Καθημερινό', amount: 49600, start: '2027-02', stop_after: null, tx: 'TX1',
    months: { '2027-02': { st: 'paid' }, '2027-03': { st: 'paid' } } };
  const env = planEnv('2027-02-25T12:00:00+02:00', top);
  env.web('Βασικό');
  assert.strictEqual(env.state().change.from, '2027-04', 'μετά τις 19 → μεθεπόμενος');
  const env2 = planEnv('2027-02-05T12:00:00+02:00', top);
  env2.web('Βασικό');
  assert.strictEqual(env2.state().change.from, '2027-04', 'ο Μάρτιος έχει ήδη πληρωθεί με το παλιό πακέτο');
  assert.ok(/Αυτό είναι ήδη το πακέτο σας/.test(planEnv('2027-02-05T12:00:00+02:00', top).web('Καθημερινό')));
  const r = env.web('Καθημερινό');
  assert.ok(/Μένετε στο <b>Καθημερινό<\/b>/.test(r));
  assert.ok(!('change' in env.state()));
  assert.ok(/Μένετε στο πακέτο Καθημερινό/.test(env.mine().pop().subject));
  assert.strictEqual(env.ghPuts.pop().body.status, 'cancelled');
  assert.throws(function () { env.web('Χρυσό'); }, /Άγνωστο πακέτο/);
});

test('αλλαγή πακέτου: {{PLAN_CHANGE_LINE}} στο email έγκρισης — σύνδεσμος μόνο με ενεργή συνδρομή', function () {
  const env = planEnv('2027-02-10T12:00:00+02:00');
  assert.ok(env.ctx.planChangeLine_('ORE', false).indexOf('Αλλαγή πακέτου: ' + EXEC + '?a=plan&c=ORE&k=pk123') >= 0);
  assert.ok(/<a href="https:\/\/script\.google\.com[^"]+a=plan/.test(env.ctx.planChangeLine_('ORE', true)));
  const none = planEnv('2027-02-10T12:00:00+02:00', Object.assign({}, PAID_FEB, { tx: null }));
  assert.strictEqual(none.ctx.planChangeLine_('ORE', true), '');
  const ended = planEnv('2027-03-10T12:00:00+02:00', Object.assign({}, PAID_FEB, { stop_after: '2027-02' }));
  assert.strictEqual(ended.ctx.planChangeLine_('ORE', false), '');
});

// ------------------------------------------------------------------ διαχειριστικό (Admin.gs) + έλεγχος «μόνο από τον editor»
const ADM_EXEC = 'https://script.google.com/macros/s/TESTDEPLOY/exec';
const ADM_GH = 'https://api.github.com/repos/okpublisher/publisher-work/contents/';
const LEADS_CSV = 'Χρόνος,Όνομα,Επιχείρηση,Email,Τηλέφωνο,Πακέτο,Instagram/Facebook,Μήνυμα,Γλώσσα,Κατάσταση,Πηγή,Νέα\r\n' +
  '26/11/2026 2:11:38 μ.μ.,Δοκιμή,Φούρνος,A@Example.com,690,,,,el,απαντήθηκε,απευθείας,όχι\r\n' +
  '26/11/2026 2:48:33 μ.μ.,Μαρία,"Καφέ ""Νερόμυλοι""",b@example.com,693,Μεσαίο,@nero,"γραμμή 1\nγραμμή 2, με κόμμα",el,νέο,απευθείας,ναι\r\n';
const SETUPS_CSV = 'Χρόνος,Επιχείρηση,Υπεύθυνος,Email εγκρίσεων,Πακέτο,Τι κάνει,Κατάσταση,ΑΦΜ,Έλεγχος τιμολόγησης,Δωρεάν εβδομάδα,Κωδικός πελάτη\r\n' +
  '26/11/2026 4:00:00 μ.μ.,Φούρνος Δοκιμή,Γιώργος,owner@shop.gr,Βασικό · 2 posts,Ψωμί,νέο,123456783,ΟΚ,ναι,OK-0002\r\n';
function admEnv(extraProps, opts) {
  opts = opts || {};
  const gh = Object.assign({
    'admin/config.json': { leads_sheet: 'LEADSSHEETID0123456789abcdef', leads_gid: 11, setups_gid: 22 },
    'clients': [{ name: 'ORE', type: 'dir' }, { name: 'TST', type: 'dir' }, { name: 'README.md', type: 'file' }],
    'clients/ORE/config.json': { key: 'ORE', code: 'OK-0001', name: 'Learning ORE', package: 'Βασικό', status: 'σημείωση', accounts: { instagram: '@ls', facebook_page: 'LS' } },
    'clients/ORE/state.json': { packages: [{ month: '2026-12', status: 'queued', round: 2 }] },
    'clients/TST/config.json': { key: 'TST', name: 'Δοκιμή' },
  }, opts.gh || {});
  let uuid = 0;
  const env = makeEnv({
    props: Object.assign({}, BASE_PROPS, { WEBAPP_URL: ADM_EXEC, GITHUB_TOKEN: 'ghtok', TEST_CLIENTS: 'TST', VIVA_API_KEY: 'vivasecret',
      BILLING_ORE: JSON.stringify({ plan: 'Βασικό', amount: 18600, start: '2026-12', tx: 'TX1', stop_after: null,
        months: { '2026-12': { st: 'paid', order: '9999' } } }), BILLING_KEY_ORE: 'billkey123' }, extraProps || {}),
    now: '2026-11-26T18:00:00+02:00',
    extraFetch: function (url, o, resp) {
      if (url.indexOf(ADM_GH) === 0) {
        const path = decodeURIComponent(url.slice(ADM_GH.length).replace(/\?.*$/, ''));
        if (o && o.method === 'put') {
          const txt = Buffer.from(JSON.parse(o.payload).content, 'base64').toString('utf8');
          try { gh[path] = JSON.parse(txt); } catch (e) { gh[path] = txt; }   // και μη-JSON αρχεία (π.χ. λογότυπο)
          return resp(201, {});
        }
        return path in gh ? resp(200, gh[path]) : resp(404, { message: 'Not Found' });
      }
      if (url.indexOf('https://docs.google.com/spreadsheets/d/LEADSSHEETID0123456789abcdef/export?format=csv&gid=') === 0) {
        if (opts.csvFail) return resp(403, '<html>no</html>', { 'Content-Type': 'text/html' });
        return resp(200, /gid=11$/.test(url) ? (opts.leadsCsv || LEADS_CSV) : (opts.setupsCsv || SETUPS_CSV), { 'Content-Type': 'text/csv' });
      }
      if (opts.web && url in opts.web) { const w = opts.web[url]; env.webHits = (env.webHits || []).concat([url]); return resp(w[0], w[1], { 'Content-Type': w[2] || 'text/html' }); }
      if (opts.viva) return opts.viva.fetch(url, o, resp);
      return null;
    },
  });
  env.viva = opts.viva;
  env.ghStore = gh;
  env.ctx.Utilities.getUuid = function () { uuid++; return ('0000000' + uuid).slice(-8) + '-aaaa-4bbb-8ccc-' + ('00000000000' + uuid * 7).slice(-12); };
  const ss = env.ctx.SpreadsheetApp.getActive();
  const q = ss.insertSheet('Ουρά');
  q.rows.push(['Πελάτης', 'Ώρα δημοσίευσης', 'Τύπος', 'Λεζάντα', 'Αρχεία', 'Instagram', 'Link Instagram', 'Facebook', 'Link Facebook', 'ID', '', 'Τελευταίος κύκλος', new Date('2026-11-26T17:55:00+02:00')]);
  q.rows.push(['ORE', new Date('2026-11-26T20:00:00+02:00'), 'IMAGE', 'Λεζάντα', 1, 'Σε αναμονή', '', 'Σε αναμονή', '', 'ORE-1']);
  q.rows.push(['ORE', new Date('2026-11-25T20:00:00+02:00'), 'STORY', '', 1, 'Σφάλμα (3)', '', 'Δημοσιεύτηκε', 'https://fb/x', 'ORE-0']);
  const h = ss.insertSheet('Ιστορικό');
  h.rows.push(['Χρόνος', 'Πελάτης', 'ID', 'Τύπος', 'Κατάσταση', 'Λεπτομέρειες']);
  h.rows.push([new Date('2026-11-25T20:01:00+02:00'), 'ORE', 'ORE-0', 'STORY', 'Σφάλμα IG', 'mock']);
  const pay = ss.insertSheet('Πληρωμές');
  pay.rows.push(['Χρόνος', 'Πελάτης', 'Μήνας', 'Ποσό €', 'Ενέργεια', 'Αποτέλεσμα', 'Κωδικός']);
  pay.rows.push([new Date('2026-11-20T10:00:00+02:00'), 'ORE', '2026-12', 186, 'πληρωμή', 'πληρώθηκε', '9999', 'PAY-0001', 'OK-0001', 'Learning ORE', 'Βασικό']);
  env.loginAs = function (email) {
    env.cache = {};   // χωρίς όριο αιτημάτων στις δοκιμές
    api(env, { act: 'login', email: email });
    const m = lastLoginMail(env, email);
    if (!m) return null;
    return api(env, { act: 'pin', email: email, pin: /Κωδικός (\d{6})/.exec(m.subject)[1] }).token;
  };
  return env;
}

test('ασφάλεια: οι συναρτήσεις «με το χέρι» αρνούνται όταν καλούνται ανώνυμα από σελίδα του web app', function () {
  const env = makeEnv({ props: BASE_PROPS, activeUser: '' });
  ['pause', 'resume', 'setup', 'sendUploadLink', 'checkSetup', 'setupBilling', 'demoChargeNow', 'previewCurrentMonth', 'dryRun', 'findInstagramIds']
    .forEach(function (fn) { assert.throws(function () { env.ctx[fn](); }, /μόνο από τον editor/, fn); });
  assert.ok(!('PAUSED' in env.props), 'η pause() δεν άλλαξε τίποτα');
  assert.strictEqual(env.mails.length, 0);
  env.activeUser = 'okpublisher@example.com';                       // από τον editor
  env.ctx.pause();
  assert.strictEqual(env.props.PAUSED, 'true');
  env.activeUser = '';
  env.ctx.run();                                                     // οι κύκλοι των triggers δουλεύουν κανονικά
});

function api(env, o) { return JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ a: 'admin' }, o)) }, parameter: {} }).text); }
function lastLoginMail(env, email) { return env.mails.filter(function (x) { return x.to === email && /διαχειριστικό okpublisher/.test(x.subject) && /Κωδικός/.test(x.subject); }).pop(); }

test('διαχειριστικό: σύνδεση με κωδικό 6 ψηφίων ή σύνδεσμο στο okpublisher.gr/admin· ίδια απάντηση για όλους· όριο', function () {
  const env = admEnv();
  const r0 = api(env, { act: 'login', email: 'stranger@example.com' });
  assert.ok(r0.ok && /Αν το email έχει πρόσβαση/.test(r0.message));
  assert.strictEqual(env.mails.length, 0, 'σε άγνωστο email δεν φεύγει τίποτα');
  assert.strictEqual(api(env, { act: 'login', email: 'System@Example.com' }).message, r0.message, 'ίδια απάντηση');
  const m = lastLoginMail(env, 'system@example.com');
  assert.ok(m, 'ο λογαριασμός του script είναι πάντα admin');
  const pin = /Κωδικός (\d{6})/.exec(m.subject)[1];
  assert.ok(m.body.indexOf('Ο κωδικός σας: ' + pin) === 0);
  assert.ok(/https:\/\/okpublisher\.gr\/admin\/#t=[a-f0-9]{64}/.test(m.body), m.body);
  assert.ok(m.body.indexOf('script.google.com') < 0, 'η διεύθυνση του script δεν μπαίνει στο email');
  api(env, { act: 'login', email: 'system@example.com' }); api(env, { act: 'login', email: 'system@example.com' });
  api(env, { act: 'login', email: 'system@example.com' });
  assert.strictEqual(env.mails.length, 3, '3 ανά email / 15′');
});

test('διαχειριστικό: κωδικός — λάθος ως 5 φορές, μετά άκυρος· σωστός μία φορά· ο σύνδεσμος ακυρώνει τον κωδικό', function () {
  const env = admEnv();
  api(env, { act: 'login', email: 'system@example.com' });
  const pin = /Κωδικός (\d{6})/.exec(lastLoginMail(env, 'system@example.com').subject)[1];
  const wrong = pin === '000000' ? '111111' : '000000';
  for (let i = 0; i < 4; i++) assert.ok(/Λάθος/.test(api(env, { act: 'pin', email: 'system@example.com', pin: wrong }).error));
  const ok = api(env, { act: 'pin', email: 'system@example.com', pin: ' ' + pin.slice(0, 3) + ' ' + pin.slice(3) });
  assert.ok(ok.ok && /^[a-f0-9]{64}$/.test(ok.token), '5η προσπάθεια σωστή, με κενά');
  assert.ok(!api(env, { act: 'pin', email: 'system@example.com', pin: pin }).ok, 'μία φορά');
  assert.ok(api(env, { act: 'data', token: ok.token }).ok);
  // 5 λάθη → ο σωστός δεν περνά πια
  env.nowMs += 16 * 60000;
  api(env, { act: 'login', email: 'system@example.com' });
  const pin2 = /Κωδικός (\d{6})/.exec(lastLoginMail(env, 'system@example.com').subject)[1];
  const w2 = pin2 === '000000' ? '111111' : '000000';
  for (let i = 0; i < 5; i++) api(env, { act: 'pin', email: 'system@example.com', pin: w2 });
  assert.ok(!api(env, { act: 'pin', email: 'system@example.com', pin: pin2 }).ok, 'κλείδωσε μετά από 5');
  // σύνδεσμος: μία φορά, και ακυρώνει τον κωδικό του ίδιου email
  env.nowMs += 16 * 60000;
  api(env, { act: 'login', email: 'system@example.com' });
  const mm = lastLoginMail(env, 'system@example.com');
  const code = /#t=([a-f0-9]+)/.exec(mm.body)[1], pin3 = /Κωδικός (\d{6})/.exec(mm.subject)[1];
  assert.ok(api(env, { act: 'link', code: code }).ok);
  assert.ok(!api(env, { act: 'link', code: code }).ok);
  assert.ok(!api(env, { act: 'pin', email: 'system@example.com', pin: pin3 }).ok);
});

test('διαχειριστικό: συνεδρία 30 ημερών, έξοδος, ληγμένος κωδικός', function () {
  const env = admEnv();
  const tok = env.loginAs('system@example.com');
  assert.ok(env.props.ADMIN_SESSIONS.indexOf(tok) < 0, 'αποθηκεύεται μόνο το hash');
  assert.strictEqual(api(env, { act: 'data', token: tok }).data.me.role, 'admin');
  api(env, { act: 'login', email: 'system@example.com' });
  const pin = /Κωδικός (\d{6})/.exec(lastLoginMail(env, 'system@example.com').subject)[1];
  env.nowMs += 16 * 60000;
  assert.ok(!api(env, { act: 'pin', email: 'system@example.com', pin: pin }).ok, 'έληξε');
  env.nowMs += 29 * 86400000;
  assert.ok(api(env, { act: 'data', token: tok }).ok);
  api(env, { act: 'logout', token: tok });
  const r = api(env, { act: 'data', token: tok });
  assert.ok(!r.ok && r.login);
  assert.ok(api(env, { act: 'data', token: 'nope' }).login);
  const tok2 = env.loginAs('system@example.com');
  env.nowMs += 31 * 86400000;
  assert.ok(api(env, { act: 'data', token: tok2 }).login, 'μετά από 30 ημέρες');
  assert.ok(!api(env, { act: 'κάτι' }).ok);
});

test('διαχειριστικό: ο admin βλέπει πελάτες (με κωδικό), επαφές, σεταρίσματα, ουρά, πληρωμές — ποτέ tokens/κλειδιά', function () {
  const env = admEnv();
  const tok = env.loginAs('system@example.com');
  const raw = env.ctx.doPost({ postData: { contents: JSON.stringify({ a: 'admin', act: 'data', token: tok }) }, parameter: {} }).text;
  ['tokORE', 'ghtok', 'vivasecret', 'billkey123', 'TX1', '9999', 'LEADSSHEETID', 'TESTDEPLOY'].forEach(function (s) { assert.ok(raw.indexOf(s) < 0, 'διαρροή: ' + s); });
  const d = JSON.parse(raw).data;
  assert.deepStrictEqual(d.errors, []);
  const ore = d.clients.find(function (c) { return c.key === 'ORE'; });
  assert.strictEqual(ore.code, 'OK-0001');
  assert.strictEqual(ore.name, 'Learning & Sensory Ωραιόκαστρο');
  assert.ok(ore.live && !ore.test);
  assert.strictEqual(ore.billing.amount_eur, 186);
  assert.strictEqual(ore.billing.next, '2027-01');
  assert.strictEqual(ore.approval.status, 'queued');
  assert.ok(d.clients.find(function (c) { return c.key === 'TST'; }).test);
  assert.strictEqual(d.leads.length, 2);
  assert.strictEqual(d.leads[0].business, 'Καφέ "Νερόμυλοι"', 'πιο πρόσφατη πρώτη, εισαγωγικά CSV');
  assert.strictEqual(d.leads[0].message, 'γραμμή 1\nγραμμή 2, με κόμμα');
  assert.strictEqual(d.leads[1].email, 'a@example.com');
  assert.strictEqual(d.setups[0].code, 'OK-0002');
  assert.strictEqual(d.setups[0].afm, '123456783');
  assert.strictEqual(d.queue.length, 2);
  assert.strictEqual(d.heartbeat, new Date('2026-11-26T17:55:00+02:00').toISOString());
  assert.strictEqual(d.history[0].status, 'Σφάλμα IG');
  assert.strictEqual(d.payments[0].amount, 186);
  assert.deepStrictEqual([d.payments[0].pay, d.payments[0].code, d.payments[0].plan], ['PAY-0001', 'OK-0001', 'Βασικό']);
  assert.ok(d.users.some(function (u) { return u.owner && u.role === 'admin'; }));
  const csv = env.calls.filter(function (c) { return /docs\.google\.com/.test(c.url); });
  assert.ok(csv.length === 2 && csv.every(function (c) { return c.headers.Authorization === 'Bearer oauth'; }));
  api(env, { act: 'data', token: tok });
  assert.strictEqual(env.calls.filter(function (c) { return /docs\.google\.com/.test(c.url); }).length, 2, 'cache 1′');
});

test('διαχειριστικό: αν το Sheet των επαφών δεν διαβάζεται, τα υπόλοιπα δείχνονται κανονικά με σημείωση', function () {
  const env = admEnv({}, { csvFail: true });
  const d = api(env, { act: 'data', token: env.loginAs('system@example.com') }).data;
  assert.ok(/Επαφές/.test(d.errors[0]));
  assert.strictEqual(d.leads.length, 0);
  assert.ok(d.clients.length >= 2);
});

test('διαχειριστικό: πωλητής — email καλωσορίσματος, μόνο ό,τι του ανατέθηκε, χωρίς πληρωμές/χρήστες/ΑΦΜ, δεν αλλάζει τίποτα', function () {
  const env = admEnv();
  const adm = env.loginAs('system@example.com');
  assert.ok(api(env, { act: 'save_user', token: adm, email: 'Sales@Example.com', name: 'Νίκος', role: 'sales' }).ok);
  const w = env.mails.filter(function (m) { return m.to === 'sales@example.com'; });
  assert.ok(w.length === 1 && /Πρόσβαση στο διαχειριστικό/.test(w[0].subject) && w[0].body.indexOf('https://okpublisher.gr/admin/') >= 0);
  api(env, { act: 'save_user', token: adm, email: 'sales@example.com', name: 'Νίκος Π.', role: 'sales' });
  assert.strictEqual(env.mails.filter(function (m) { return m.to === 'sales@example.com'; }).length, 1, 'μόνο στον νέο χρήστη');
  const sal = env.loginAs('sales@example.com');
  let d = api(env, { act: 'data', token: sal }).data;
  assert.strictEqual(d.me.role, 'sales');
  assert.deepStrictEqual([d.leads.length, d.setups.length, d.clients.length, d.queue.length], [0, 0, 0, 0]);
  assert.ok(!('payments' in d) && !('users' in d));
  api(env, { act: 'assign', token: adm, key: 'lead:b@example.com', email: 'sales@example.com' });
  api(env, { act: 'assign', token: adm, key: 'setup:OK-0002', email: 'sales@example.com' });
  api(env, { act: 'assign', token: adm, key: 'client:ORE', email: 'sales@example.com' });
  env.cache = {};
  d = api(env, { act: 'data', token: sal }).data;
  assert.deepStrictEqual(d.leads.map(function (l) { return l.email; }), ['b@example.com']);
  assert.strictEqual(d.setups.length, 1);
  assert.ok(!('afm' in d.setups[0]));
  assert.deepStrictEqual(d.clients.map(function (c) { return c.key; }), ['ORE']);
  assert.ok(!('note' in d.clients[0]));
  assert.strictEqual(d.queue.length, 2);
  assert.ok(/Μόνο για διαχειριστές/.test(api(env, { act: 'save_user', token: sal, email: 'x@example.com', role: 'admin' }).error));
  assert.ok(/Μόνο για διαχειριστές/.test(api(env, { act: 'assign', token: sal, key: 'lead:a@example.com', email: 'sales@example.com' }).error));
  const adminView = api(env, { act: 'data', token: adm }).data;
  assert.strictEqual(adminView.leads.find(function (l) { return l.email === 'b@example.com'; }).seller, 'sales@example.com');
  api(env, { act: 'delete_user', token: adm, email: 'sales@example.com' });
  assert.ok(api(env, { act: 'data', token: sal }).login, 'αφαιρέθηκε → έξω');
  assert.strictEqual(env.props.ADMIN_ASSIGN, '{}', 'οι αναθέσεις του φεύγουν');
});

test('διαχειριστικό: ο λογαριασμός okpublisher και ο εαυτός σου δεν αφαιρούνται· άκυρα στοιχεία απορρίπτονται', function () {
  const env = admEnv();
  const adm = env.loginAs('system@example.com');
  const E = function (o) { return api(env, Object.assign({ token: adm }, o)).error || ''; };
  assert.ok(/δεν αφαιρείται/.test(E({ act: 'delete_user', email: 'system@example.com' })));
  assert.ok(/πάντα διαχειριστής/.test(E({ act: 'save_user', email: 'system@example.com', name: 'x', role: 'sales' })));
  assert.ok(/Μη έγκυρο email/.test(E({ act: 'save_user', email: 'όχι-email', role: 'sales' })));
  assert.ok(/Άγνωστος ρόλος/.test(E({ act: 'save_user', email: 'a@b.gr', role: 'root' })));
  api(env, { act: 'save_user', token: adm, email: 'boss@example.com', name: 'Πέτρος', role: 'admin' });
  const boss = env.loginAs('boss@example.com');
  const B = function (o) { return api(env, Object.assign({ token: boss }, o)).error || ''; };
  assert.ok(/τον εαυτό σας/.test(B({ act: 'delete_user', email: 'boss@example.com' })));
  assert.ok(/από τον εαυτό σας/.test(B({ act: 'save_user', email: 'boss@example.com', name: 'Π', role: 'sales' })));
  assert.ok(/δεν υπάρχει/.test(B({ act: 'assign', key: 'lead:x@y.gr', email: 'nobody@example.com' })));
  assert.ok(/Άκυρη/.test(B({ act: 'assign', key: 'bad key', email: '' })));
  assert.strictEqual(api(env, { act: 'data', token: boss }).data.me.name, 'Πέτρος');
});

test('διαχειριστικό: καμία δημόσια συνάρτηση (google.script.run)· η παλιά σελίδα (?a=admin) δείχνει τη νέα διεύθυνση· το upload δουλεύει όπως πριν', function () {
  const env = admEnv();
  const pub = Object.keys(env.ctx).filter(function (k) { return /^adm|^admin/.test(k) && typeof env.ctx[k] === 'function' && !/_$/.test(k); });
  assert.deepStrictEqual(pub, []);
  const src = require('fs').readFileSync(require('path').join(DIR, 'Admin.gs'), 'utf8');
  assert.ok(!/^function [a-zA-Z0-9]*[^_]\(/m.test(src), 'όλες οι συναρτήσεις του Admin.gs τελειώνουν σε _');
  const moved = env.ctx.doGet({ parameter: { a: 'admin', t: 'ab'.repeat(32) } });
  assert.ok(/μεταφέρθηκε/.test(moved.html) && moved.html.indexOf('https://okpublisher.gr/admin/') >= 0);
  assert.ok(env.ctx.doGet({ parameter: { a: 'stop', c: 'ORE', k: 'x' } }).html.indexOf('Διακοπή συνδρομής') >= 0, 'η «Διακοπή» όπως πριν');
  assert.ok(/Λάθος κλειδί/.test(env.ctx.doPost({ postData: { contents: JSON.stringify({ name: 'x.jpg' }) }, parameter: { c: 'ORE', key: 'λάθος' } }).text));
});

test('διεύθυνση web app: γράφεται μία φορά στο admin/webapp.json του publisher-work', function () {
  const env = admEnv();
  env.ctx.doGet({ parameter: {} }); env.ctx.doGet({ parameter: {} });
  const puts = env.calls.filter(function (c) { return c.method === 'put' && /admin\/webapp\.json/.test(c.url); });
  assert.strictEqual(puts.length, 1);
  assert.strictEqual(JSON.parse(Buffer.from(JSON.parse(puts[0].payload).content, 'base64').toString('utf8')).url, ADM_EXEC);
  assert.ok(!env.mails.some(function (m) { return /Σύνδεσμος διαχειριστικού/.test(m.subject); }));
});

// ------------------------------------------------------------------ ενέργειες διαχειριστή ανά πελάτη
function actEnv() {
  const v = vivaFake();
  const env = admEnv(Object.assign({}, VIVA_PROPS, { CLIENTS: 'ORE,OKP', NOTIFY_TO_OKP: 'okp-client@example.com', NAME_OKP: 'okpublisher' }), { viva: v, gh: {
    'clients': [{ name: 'ORE', type: 'dir' }, { name: 'OKP', type: 'dir' }],
    'clients/OKP/config.json': { key: 'OKP', code: 'OK-0000', name: 'okpublisher', package: 'Βασικό', post_days: ['Τρίτη', 'Πέμπτη'], billing: { type: 'free' } },
  } });
  env.tok = env.loginAs('system@example.com');
  env.act = function (o) { return api(env, Object.assign({ token: env.tok }, o)); };
  env.gh = function (path) {
    const c = env.calls.filter(function (x) { return x.method === 'put' && decodeURIComponent(x.url).indexOf('/contents/' + path) > 0; }).pop();
    return c ? JSON.parse(Buffer.from(JSON.parse(c.payload).content, 'base64').toString('utf8')) : null;
  };
  return env;
}

test('διαχειριστικό: πακέτο σε πελάτη χωρίς συνδρομή → package_change.json από τον επόμενο κατάλληλο μήνα· ξανά το ίδιο = ακύρωση', function () {
  const env = actEnv();   // 26/11 → μετά τις 19 → από τον Ιανουάριο
  const r = env.act({ act: 'client_plan', client: 'OKP', plan: 'Καθημερινό' });
  assert.ok(r.ok && /Καθημερινό \(7\+7 την εβδομάδα\) από τον Ιανουάριο 2027/.test(r.message), r.message || r.error);
  const pc = env.gh('clients/OKP/package_change.json');
  assert.deepStrictEqual([pc.plan, pc.previous, pc.from, pc.status, pc.week, pc.by], ['Καθημερινό', 'Βασικό', '2027-01', 'scheduled', 7, 'system@example.com']);
  assert.ok(env.mails.some(function (m) { return /Αλλαγή πακέτου: OKP/.test(m.subject) && /Βασικό → Καθημερινό από τον Ιανουάριο 2027/.test(m.body); }));
  assert.ok(!env.mails.some(function (m) { return m.to === 'okp-client@example.com'; }), 'χωρίς συνδρομή: κανένα email στον πελάτη');
  const d = env.act({ act: 'data' }).data;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.clients.find(function (c) { return c.key === 'OKP'; }).pkg_change)), { plan: 'Καθημερινό', from: '2027-01' });
  const r2 = env.act({ act: 'client_plan', client: 'OKP', plan: 'Βασικό' });
  assert.ok(/ακυρώθηκε/.test(r2.message));
  assert.strictEqual(env.gh('clients/OKP/package_change.json').status, 'cancelled');
  assert.ok(/Διάλεξε πακέτο/.test(env.act({ act: 'client_plan', client: 'OKP', plan: 'Χρυσό' }).error));
});

test('διαχειριστικό: πακέτο σε πελάτη με συνδρομή → όπως η «Αλλαγή πακέτου» (email στον πελάτη, χρέωση με το νέο ποσό)', function () {
  const env = actEnv();
  const r = env.act({ act: 'client_plan', client: 'ORE', plan: 'Μεσαίο' });
  assert.ok(/Μεσαίο από τον Ιανουάριο 2027 \(€310,00 με ΦΠΑ\)/.test(r.message), r.message || r.error);
  const st = JSON.parse(env.props.BILLING_ORE);
  assert.deepStrictEqual([st.change.plan, st.change.amount, st.change.from], ['Μεσαίο', 31000, '2027-01']);
  const m = env.mails.filter(function (x) { return x.to === 'center@example.com'; }).pop();
  assert.ok(/Αλλαγή πακέτου σε Μεσαίο από τον Ιανουάριο 2027/.test(m.subject));
  assert.ok(env.mails.some(function (x) { return /Αλλαγή πακέτου: ORE/.test(x.subject) && /διαχειριστικό: system@example\.com/.test(x.body); }));
});

test('διαχειριστικό: δωρεάν έως μήνα / χωρίς λήξη στο config.json· όχι με ενεργή συνδρομή· όχι σε περασμένο μήνα', function () {
  const env = actEnv();
  env.props.FREE_REMINDED_OKP = '2026-12';
  const r = env.act({ act: 'client_free', client: 'OKP', until: '2027-02' });
  assert.ok(/Δωρεάν έως και τον Φεβρουάριο 2027/.test(r.message), r.message || r.error);
  const cfg = env.gh('clients/OKP/config.json');
  assert.deepStrictEqual(cfg.billing, { type: 'free', until: '2027-02' });
  assert.strictEqual(cfg.post_days.length, 2, 'τα υπόλοιπα πεδία μένουν');
  assert.ok(!('FREE_REMINDED_OKP' in env.props), 'νέα λήξη → νέα υπενθύμιση');
  env.act({ act: 'client_free', client: 'OKP', until: '' });
  assert.deepStrictEqual(env.gh('clients/OKP/config.json').billing, { type: 'free' });
  assert.ok(/ενεργή συνδρομή/.test(env.act({ act: 'client_free', client: 'ORE', until: '' }).error));
  assert.ok(/Άκυρος μήνας/.test(env.act({ act: 'client_free', client: 'OKP', until: '2026-10' }).error));
  assert.ok(/Άγνωστος πελάτης|Δεν βρέθηκε/.test(env.act({ act: 'client_free', client: '../x', until: '' }).error));
});

test('διαχειριστικό: «Χρέωση» → email με σύνδεσμο (οποιαδήποτε μέρα)· η συνδρομή ξεκινά τη μέρα της πληρωμής, config «paid» τότε', function () {
  const env = actEnv();
  env.nowMs = new Date('2026-11-26T18:00:00+02:00').getTime();
  const r = env.act({ act: 'client_charge', client: 'OKP', plan: 'Μεσαίο' });
  assert.ok(/Στάλθηκε email με σύνδεσμο πληρωμής: Μεσαίο, €310,00 με ΦΠΑ\. Ξεκινά τη μέρα που θα πληρώσει/.test(r.message) && /λήγει 9\/12\/2026/.test(r.message), r.message || r.error);
  assert.deepStrictEqual(env.viva.orders.map(function (o) { return o.amount; }), [31000], 'ένας σύνδεσμος, για το πακέτο που διάλεξες');
  const toC = function () { return env.mails.filter(function (x) { return x.to === 'okp-client@example.com'; }); };
  let m = toC().pop();
  assert.ok(/Πληρωμή συνδρομής: ξεκινάμε μόλις πληρώσετε/.test(m.subject) && /checkout\?ref=/.test(m.body) && /ισχύει ως τις 9\/12/.test(m.body), m.body);
  assert.ok(!/Καθημερινό/.test(m.body) && !/αφαιρούμε την πρόσβασή μας/.test(m.body));
  assert.ok(!env.gh('clients/OKP/config.json'), 'το config δεν αλλάζει πριν την πληρωμή');
  let st = JSON.parse(env.props.BILLING_OKP);
  assert.deepStrictEqual([st.offer.kind, st.offer.chosen, st.code, st.start], ['charge', 'Μεσαίο', 'OK-0000', null]);
  const n = toC().length;
  env.nowMs = new Date('2026-11-28T11:00:00+02:00').getTime(); env.ctx.billingCycle();
  assert.strictEqual(toC().length, n, '3η μέρα τίποτα');
  env.nowMs = new Date('2026-11-29T11:00:00+02:00').getTime(); env.ctx.billingCycle();
  assert.ok(/Υπενθύμιση πληρωμής/.test(toC().pop().subject), '4η μέρα');
  env.viva.paid[String(9000000000000001)] = 'TXC';
  env.nowMs = new Date('2026-12-02T13:00:00+02:00').getTime(); env.ctx.billingCycle();
  st = JSON.parse(env.props.BILLING_OKP);
  assert.deepStrictEqual([st.plan, st.start, st.day, st.months['2026-12'].st, !!st.offer], ['Μεσαίο', '2026-12', 2, 'paid', false]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify([env.gh('clients/OKP/config.json').billing, env.gh('clients/OKP/config.json').package])),
    [{ type: 'paid', day: 2, start: '2026-12-02' }, 'Μεσαίο']);
  m = toC().pop();
  assert.ok(/Ξεκινάμε/.test(m.subject) && /2\/12\/2026–1\/1\/2027|2\/12–1\/1\/2027/.test(m.body) && /στις 2\/1\/2027/.test(m.body), m.body);
  assert.ok(env.mails.some(function (x) { return /^\[okpublisher\] Πλήρωσε: OKP/.test(x.subject); }));
  assert.ok(/έχει ήδη συνδρομή/.test(env.act({ act: 'client_charge', client: 'OKP', plan: 'Βασικό' }).error));
});

test('διαχειριστικό: «Χρέωση» χωρίς πληρωμή → 4η, 8η μέρα, λήγει μετά τη 14η (email στον πελάτη + okpublisher), δωρεάν μένει δωρεάν', function () {
  const env = actEnv();
  env.nowMs = new Date('2026-11-26T18:00:00+02:00').getTime();
  env.act({ act: 'client_free', client: 'OKP', until: '2027-04' });
  const r = env.act({ act: 'client_charge', client: 'OKP', plan: 'Βασικό' });
  assert.ok(/Είναι δωρεάν έως Απρίλιο 2027: με την πληρωμή τα δωρεάν σταματούν/.test(r.message), r.message || r.error);
  const toC = function () { return env.mails.filter(function (x) { return x.to === 'okp-client@example.com'; }).map(function (x) { return x.subject; }); };
  ['2026-11-29T11:00:00+02:00', '2026-12-03T11:00:00+02:00', '2026-12-09T11:00:00+02:00', '2026-12-10T11:00:00+02:00', '2026-12-12T11:00:00+02:00'].forEach(function (t) {
    env.nowMs = new Date(t).getTime(); env.ctx.billingCycle();
  });
  const subs = toC();
  assert.ok(subs.some(function (x) { return /Υπενθύμιση πληρωμής/.test(x); }) && subs.some(function (x) { return /Τελευταία υπενθύμιση πληρωμής/.test(x); }));
  assert.strictEqual(subs.filter(function (x) { return /Ο σύνδεσμος πληρωμής έληξε/.test(x); }).length, 1);
  assert.ok(env.mails.some(function (x) { return /Δεν πλήρωσε τη «Χρέωση»: OKP/.test(x.subject); }));
  assert.deepStrictEqual(env.gh('clients/OKP/config.json').billing, { type: 'free', until: '2027-04' }, 'μένει δωρεάν');
  assert.ok(!env.props.BILLING_PAUSED_OKP);
});

test('διαχειριστικό: «Χρέωση» και μετά «Δωρεάν» → ο σύνδεσμος κλείνει· αν πληρωθεί ακόμα → ξεκινά + email στο okpublisher', function () {
  const env = actEnv();
  env.act({ act: 'client_charge', client: 'OKP', plan: 'Βασικό' });
  const f = env.act({ act: 'client_free', client: 'OKP', until: '' });
  assert.ok(/Έκλεισαν οι σύνδεσμοι πληρωμής/.test(f.message), f.message || f.error);
  assert.ok(JSON.parse(env.props.BILLING_OKP).offer.cancelled);
  const n = env.mails.length;
  env.nowMs += 5 * 86400000; env.ctx.billingCycle();
  assert.strictEqual(env.mails.length, n, 'καμία υπενθύμιση μετά το «Δωρεάν»');
  env.viva.paid[String(9000000000000000 + env.viva.n)] = 'TXLATE';
  env.ctx.billingCycle();
  const st = JSON.parse(env.props.BILLING_OKP);
  assert.ok(st.start && st.tx === 'TXLATE' && !st.offer);
  assert.ok(env.mails.some(function (m) { return /Πληρώθηκε σύνδεσμος που είχε κλείσει: OKP/.test(m.subject) && /ακυρωμένο/.test(m.body); }));
});

test('διαχειριστικό: διακοπή συνδρομής (όροι Α.8, email στον πελάτη)· πωλητής: καμία ενέργεια', function () {
  const env = actEnv();
  const r = env.act({ act: 'client_stop', client: 'ORE' });
  assert.ok(/σταματά μετά τον Δεκέμβριο 2026/.test(r.message), r.message || r.error);
  assert.strictEqual(JSON.parse(env.props.BILLING_ORE).stop_after, '2026-12');
  assert.ok(env.mails.some(function (x) { return x.to === 'center@example.com' && /σταματά μετά τον Δεκέμβριο 2026/.test(x.subject); }));
  assert.ok(/σταματά ήδη/.test(env.act({ act: 'client_stop', client: 'ORE' }).message));
  assert.ok(/Δεν υπάρχει ενεργή συνδρομή/.test(env.act({ act: 'client_stop', client: 'OKP' }).error));
  env.act({ act: 'save_user', email: 'sales@example.com', name: 'Ν', role: 'sales' });
  const sal = env.loginAs('sales@example.com');
  ['client_plan', 'client_free', 'client_charge', 'client_stop'].forEach(function (a) {
    assert.ok(/Μόνο για διαχειριστές/.test(api(env, { act: a, token: sal, client: 'OKP', plan: 'Βασικό', until: '' }).error), a);
  });
});

test('διαχειριστικό: «Χωρίς έγκριση» ↔ «με email» στο config.json (approval: none)· φαίνεται στα δεδομένα', function () {
  const env = actEnv();
  const r = env.act({ act: 'client_approval', client: 'OKP', mode: 'none' });
  assert.ok(/Χωρίς έγκριση: το πρόγραμμα μπαίνει κατευθείαν στην ουρά/.test(r.message), r.message || r.error);
  assert.strictEqual(env.gh('clients/OKP/config.json').approval, 'none');
  assert.strictEqual(env.gh('clients/OKP/config.json').code, 'OK-0000', 'τα υπόλοιπα πεδία μένουν');
  assert.strictEqual(env.act({ act: 'data' }).data.clients.find(function (c) { return c.key === 'OKP'; }).no_approval, true);
  assert.ok(/ήδη χωρίς έγκριση/.test(env.act({ act: 'client_approval', client: 'OKP', mode: 'none' }).message));
  env.act({ act: 'client_approval', client: 'OKP', mode: 'email' });
  assert.ok(!('approval' in env.gh('clients/OKP/config.json')));
  assert.ok(/Διάλεξε/.test(env.act({ act: 'client_approval', client: 'OKP', mode: 'x' }).error));
  assert.ok(env.mails.some(function (m) { return /Έγκριση: OK-0000/.test(m.subject); }));
});

test('διαχειριστικό: ομάδα (αλυσίδα) σε πελάτη και σε σετάρισμα· νέα ομάδα από όνομα· μόνο διαχειριστής', function () {
  const env = actEnv(), gh = env.ghStore;
  gh['groups'] = [{ name: 'learning-sensory', type: 'dir' }, { name: 'README.md', type: 'file' }];
  gh['groups/learning-sensory/group.json'] = { key: 'learning-sensory', name: 'Learning & Sensory', members: ['ORE'], planned_members: ['KAL', 'NEA'], brand: { colors: { primary: '#FFDD00' } }, music: { set: 'kids' } };
  let d = env.act({ act: 'data' }).data;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.groups)), [{ key: 'learning-sensory', name: 'Learning & Sensory', brand: true }]);
  // πελάτης → υπάρχουσα ομάδα
  let r = env.act({ act: 'client_group', client: 'OKP', group: 'learning-sensory' });
  assert.ok(/Στην ομάδα Learning & Sensory: παίρνει το κοινό brand από την επόμενη παραγωγή\.$/.test(r.message), r.message || r.error);
  assert.strictEqual(env.gh('clients/OKP/config.json').group, 'learning-sensory');
  assert.strictEqual(env.gh('clients/OKP/config.json').code, 'OK-0000', 'τα υπόλοιπα πεδία μένουν');
  const gj = env.gh('groups/learning-sensory/group.json');
  assert.deepStrictEqual([gj.members, gj.planned_members, gj.music.set, gj.brand.colors.primary], [['ORE', 'OKP'], ['KAL', 'NEA'], 'kids', '#FFDD00']);
  assert.ok(/ήδη στην ομάδα/.test(env.act({ act: 'client_group', client: 'OKP', group: 'learning-sensory' }).message));
  assert.ok(/Άγνωστη ομάδα/.test(env.act({ act: 'client_group', client: 'OKP', group: 'xyz' }).error));
  assert.strictEqual(env.act({ act: 'data' }).data.clients.find(function (c) { return c.key === 'OKP'; }).group, 'learning-sensory');
  assert.ok(env.mails.some(function (m) { return /Ομάδα: OK-0000/.test(m.subject); }));
  // νέα ομάδα με ελληνικό όνομα → λατινικό κλειδί, βγαίνει από την παλιά
  r = env.act({ act: 'client_group', client: 'OKP', group: '+', name: '  Φούρνοι  Γειτονιάς ' });
  assert.ok(/Στην ομάδα Φούρνοι Γειτονιάς: .*δεν έχει ακόμα brand/.test(r.message), r.message || r.error);
  const ng = env.gh('groups/fournoi-geitonias/group.json');
  assert.deepStrictEqual([ng.key, ng.name, ng.members, ng.brand], ['fournoi-geitonias', 'Φούρνοι Γειτονιάς', ['OKP'], null]);
  assert.strictEqual(env.gh('clients/OKP/config.json').group, 'fournoi-geitonias');
  assert.deepStrictEqual(env.gh('groups/learning-sensory/group.json').members, ['ORE'], 'βγήκε από την παλιά');
  assert.ok(/όνομα/.test(env.act({ act: 'client_group', client: 'OKP', group: '+', name: ' ' }).error));
  // ίδιο όνομα με υπάρχουσα → εκείνη (όχι διπλή)
  r = env.act({ act: 'client_group', client: 'OKP', group: '+', name: 'learning & sensory' });
  assert.ok(/Στην ομάδα Learning & Sensory/.test(r.message), r.message || r.error);
  // χωρίς ομάδα
  r = env.act({ act: 'client_group', client: 'OKP', group: '' });
  assert.ok(/Χωρίς ομάδα: δικό του brand/.test(r.message), r.message || r.error);
  assert.ok(!('group' in env.gh('clients/OKP/config.json')));
  // σετάρισμα (OK-0002, δεν έγινε ακόμα πελάτης) → setups/OK-0002/admin.json + στα δεδομένα
  r = env.act({ act: 'setup_group', code: 'OK-0002', group: 'learning-sensory' });
  assert.ok(/όταν στηθεί ο πελάτης/.test(r.message), r.message || r.error);
  const a = env.gh('setups/OK-0002/admin.json');
  assert.deepStrictEqual([a.code, a.group, a.group_name, a.by], ['OK-0002', 'learning-sensory', 'Learning & Sensory', 'system@example.com']);
  d = env.act({ act: 'data' }).data;
  assert.strictEqual(d.setups.find(function (s) { return s.code === 'OK-0002'; }).group, 'learning-sensory');
  assert.ok(/Άγνωστο σετάρισμα/.test(env.act({ act: 'setup_group', code: 'OK-0099', group: '' }).error));
  // σετάρισμα που έγινε πελάτης → αλλάζει τον πελάτη
  r = env.act({ act: 'setup_group', code: 'OK-0000', group: 'learning-sensory' });
  assert.ok(/από την επόμενη παραγωγή/.test(r.message), r.message || r.error);
  assert.strictEqual(env.gh('clients/OKP/config.json').group, 'learning-sensory');
  // πωλητής: καμία αλλαγή, αλλά βλέπει το όνομα της ομάδας
  env.act({ act: 'save_user', email: 'sales@example.com', name: 'Ν', role: 'sales' });
  const sal = env.loginAs('sales@example.com');
  assert.ok(/Μόνο για διαχειριστές/.test(api(env, { act: 'client_group', token: sal, client: 'OKP', group: '' }).error));
  assert.ok(/Μόνο για διαχειριστές/.test(api(env, { act: 'setup_group', token: sal, code: 'OK-0002', group: '' }).error));
  assert.strictEqual(api(env, { act: 'data', token: sal }).data.groups.length, 1);
});

test('διαχειριστικό: κλειδί ομάδας από όνομα (λατινικά, παύλες)', function () {
  const env = actEnv();
  assert.deepStrictEqual(['Learning & Sensory', 'Φούρνος Γειτονιάς', 'Ψητοπωλεία «Η Γωνιά»', 'ΑΪ-Δρόμος 2'].map(env.ctx.admSlug_),
    ['learning-sensory', 'fournos-geitonias', 'psitopoleia-i-gonia', 'ai-dromos-2']);
});

test('διαχειριστικό: η κάρτα πελάτη έχει ημέρες/έγκριση/δωρεάν και τα βλέπει και ο πωλητής του· το cache αλλάζει όνομα με τα πεδία', function () {
  const env = actEnv();
  env.act({ act: 'client_approval', client: 'OKP', mode: 'none' });
  env.act({ act: 'save_user', email: 'sales@example.com', name: 'Νίκος', role: 'sales' });
  env.act({ act: 'assign', key: 'client:OKP', email: 'sales@example.com' });
  const sal = env.loginAs('sales@example.com');
  const c = api(env, { act: 'data', token: sal }).data.clients.find(function (x) { return x.key === 'OKP'; });
  assert.ok(c, 'ο πωλητής βλέπει τον πελάτη του');
  assert.deepStrictEqual(JSON.parse(JSON.stringify([c.no_approval, c.free, c.package, c.days.posts, c.days.stories])), [true, { until: '' }, 'Βασικό', ['Τρίτη', 'Πέμπτη'], []]);
  assert.ok('adm:clients:3' in env.cache && !('adm:clients:2' in env.cache), 'νέο κλειδί cache');
});

// ------------------------------------------------------------------ agencies (Agency.gs, από 27/11/2026)
function agencyEnv() {
  const env = actEnv();
  env.ghStore['clients'] = [{ name: 'ORE', type: 'dir' }, { name: 'OKP', type: 'dir' }, { name: 'NEW', type: 'dir' }];
  env.ghStore['clients/NEW/config.json'] = { key: 'NEW', code: 'OK-0005', name: 'Νέος', package: 'Μεσαίο' };
  env.props.CLIENTS = 'ORE,OKP,NEW';
  env.act({ act: 'save_user', email: 'studio@agency.example', name: 'Studio X', role: 'agency', pct: '20' });
  env.users = function () { return JSON.parse(env.props.ADMIN_USERS); };
  env.ag = env.users()['studio@agency.example'];
  env.KA = 'AG' + env.ag.ref.toUpperCase();
  env.ast = function () { return JSON.parse(env.props['BILLING_' + env.KA]); };
  env.at = function (t) { env.nowMs = new Date(t).getTime(); env.tok = env.loginAs('system@example.com'); };
  return env;
}

test('agency: νέος χρήστης «agency» με σύνδεσμο, έκπτωση 20%, email καλωσορίσματος με φόρμα και όρους', function () {
  const env = agencyEnv();
  assert.deepStrictEqual([env.ag.role, env.ag.disc, /^[a-z2-9]{5}$/.test(env.ag.ref)], ['agency', 20, true]);
  assert.strictEqual(env.props['NOTIFY_TO_' + env.KA], 'studio@agency.example');
  assert.strictEqual(env.props['NAME_' + env.KA], 'Studio X');
  const w = env.mails.filter(function (m) { return m.to === 'studio@agency.example' && /Καλώς ήρθατε/.test(m.subject); })[0];
  assert.ok(w && w.body.indexOf('setup.html?p=' + env.ag.ref) >= 0 && /έκπτωση 20%/.test(w.body) && /agency-terms\.html/.test(w.body), w && w.body);
  assert.ok(/Η έκπτωση είναι ποσοστό/.test(env.act({ act: 'save_user', email: 'studio@agency.example', name: 'Studio X', role: 'agency', pct: '80' }).error));
  env.act({ act: 'save_user', email: 'studio@agency.example', name: 'Studio X', role: 'agency', pct: '25' });
  assert.strictEqual(env.users()['studio@agency.example'].disc, 25, 'η έκπτωση αλλάζει');
  assert.strictEqual(env.users()['studio@agency.example'].ref, env.ag.ref, 'ίδιος σύνδεσμος');
  assert.ok(env.mails.some(function (m) { return m.to === 'studio@agency.example' && /από 20% σε 25%, από την επόμενη χρέωση/.test(m.body); }), 'email για την αλλαγή');
  // μικρότερη έκπτωση (ακριβότερο): ισχύει 30 μέρες μετά, με email
  env.act({ act: 'save_user', email: 'studio@agency.example', name: 'Studio X', role: 'agency', pct: '15' });
  const u2 = env.users()['studio@agency.example'];
  assert.deepStrictEqual([u2.disc, u2.discs.slice(-1)[0]], [25, { from: '2026-12-26', d: 15 }]);
  assert.ok(env.mails.some(function (m) { return m.to === 'studio@agency.example' && /από 25% σε 15% από τις 26\/12\/2026 \(30 μέρες/.test(m.body); }));
  assert.strictEqual(env.ctx.agencyDisc_(u2, '2026-12-26'), 15);
  env.act({ act: 'save_user', email: 'studio@agency.example', name: 'Studio X', role: 'agency', pct: '25' });
  assert.deepStrictEqual(env.users()['studio@agency.example'].discs.map(function (x) { return x.d; }), [20, 25], 'ακύρωση της μελλοντικής αλλαγής');
  const src = require('fs').readFileSync(require('path').join(DIR, 'Agency.gs'), 'utf8');
  assert.ok(!/^function [a-zA-Z0-9]*[^_]\(/m.test(src), 'όλες οι συναρτήσεις του Agency.gs τελειώνουν σε _');
});

test('agency: πελάτης → agency (email μόνο στην agency, χωρίς δική του χρέωση) → «Χρέωση» → πληρωμή → μέρα agency → αναλογικά → μηνιαία χρέωση με ανάλυση', function () {
  const env = agencyEnv(), KA = env.KA;
  let r = env.act({ act: 'client_agency', client: 'OKP', email: 'studio@agency.example' });
  assert.ok(/Πελάτης της Studio X: Βασικό −20% = €148,80 τον μήνα με ΦΠΑ\..*Ξεκινά μόλις πληρώσει η agency/.test(r.message), r.message || r.error);
  let cfg = env.gh('clients/OKP/config.json');
  assert.deepStrictEqual([cfg.agency, cfg.approver_to, cfg.approvers, cfg.billing], [env.ag.ref, 'studio@agency.example', ['studio@agency.example'], { type: 'agency', agency: env.ag.ref }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(cfg.pre_agency)), { notify_to: 'okp-client@example.com', approver_to: null, approvers: null, billing: { type: 'free' } });
  assert.deepStrictEqual([env.props.AGENCY_OKP, env.props.NOTIFY_TO_OKP], [KA, 'studio@agency.example']);
  assert.ok(/Πελάτης agency/.test(env.act({ act: 'client_free', client: 'OKP', until: '' }).error));
  assert.ok(/Πελάτης agency/.test(env.act({ act: 'client_charge', client: 'OKP', plan: 'Βασικό' }).error));
  assert.ok(/δική του ενεργή συνδρομή/.test(env.act({ act: 'client_agency', client: 'ORE', email: 'studio@agency.example' }).error));
  let d = env.act({ act: 'data' }).data;
  const c = d.clients.find(function (x) { return x.key === 'OKP'; });
  assert.deepStrictEqual([c.agency, c.agency_name], [KA, 'Studio X']);
  const u = d.users.find(function (x) { return x.email === 'studio@agency.example'; });
  assert.deepStrictEqual([u.agency.clients, u.agency.next_eur, u.agency.paying], [['OKP'], 148.8, false]);
  assert.ok(!d.sellers.some(function (x) { return x.email === 'studio@agency.example'; }), 'η agency δεν είναι στους πωλητές');

  // «Χρέωση»: ένας σύνδεσμος με το άθροισμα, email στην agency με ανάλυση και όρους
  r = env.act({ act: 'agency_charge', email: 'studio@agency.example' });
  assert.ok(/σύνδεσμος πληρωμής €148,80 τον μήνα \(1 πελάτης\)/.test(r.message), r.message || r.error);
  assert.strictEqual(env.viva.orders.pop().amount, 14880);
  const m1 = env.mails.filter(function (m) { return m.to === 'studio@agency.example' && /Πληρωμή συνεργασίας/.test(m.subject); }).pop();
  assert.ok(m1 && /Ανάλυση:\n• Νέος|OKP/.test(m1.body) && /Σύνολο: €148,80/.test(m1.body) && /agency-terms\.html/.test(m1.body), m1 && m1.body);
  assert.ok(!env.mails.some(function (m) { return m.to === 'okp-client@example.com'; }), 'τίποτα στον τελικό πελάτη');
  assert.ok(/πληρώνει ήδη|σύνδεσμο/.test(env.act({ act: 'agency_charge', email: 'studio@agency.example' }).message || ''), 'νέα «Χρέωση» = νέος σύνδεσμος');

  // πληρωμή → μέρα 26, config του πελάτη με μέρα/αρχή
  env.viva.paid[String(9000000000000000 + env.viva.n)] = 'TXA';
  env.ctx.billingCycle();
  let st = env.ast();
  assert.deepStrictEqual([st.start, st.day, st.tx, st.months['2026-11'].st, st.months['2026-11'].amount, !!st.offer], ['2026-11', 26, 'TXA', 'paid', 14880, false]);
  cfg = env.gh('clients/OKP/config.json');
  assert.deepStrictEqual(cfg.billing, { type: 'agency', agency: env.ag.ref, day: 26, start: '2026-11-26' });
  assert.ok(env.mails.some(function (m) { return m.to === 'studio@agency.example' && /Ξεκινάμε/.test(m.subject); }));
  assert.ok(env.mails.some(function (m) { return /Agency πλήρωσε: Studio X/.test(m.subject); }));

  // νέος πελάτης στις 6/12 (Μεσαίο): ξεκινά αμέσως, αναλογικά 20 από 30 μέρες στην επόμενη χρέωση
  env.at('2026-12-06T12:00:00+02:00');
  r = env.act({ act: 'client_agency', client: 'NEW', email: 'studio@agency.example' });
  assert.ok(/Μεσαίο −20% = €248,00.*Ξεκινά αμέσως· αναλογικά €165,33/.test(r.message), r.message || r.error);
  assert.deepStrictEqual(env.gh('clients/NEW/config.json').billing, { type: 'agency', agency: env.ag.ref, day: 26, start: '2026-11-26' });

  // 26/12: μία χρέωση = 148,80 + 248,00 + 165,33
  env.at('2026-12-26T10:00:00+02:00');
  env.ctx.billingCycle();
  st = env.ast();
  assert.deepStrictEqual([st.months['2026-12'].st, st.months['2026-12'].amount, st.plan, st.agency.extra.length], ['paid', 56213, 'Agency · 2 πελάτες', 0]);
  assert.strictEqual(env.viva.charges.pop().body.amount, 56213);
  const m2 = env.mails.filter(function (m) { return m.to === 'studio@agency.example' && /Χρεώθηκε/.test(m.subject); }).pop();
  assert.ok(m2 && /€562,13/.test(m2.body) && /Ανάλυση:/.test(m2.body) && /20 από 30 μέρες/.test(m2.body) && !/Αλλαγή πακέτου/.test(m2.body), m2 && m2.body);

  // απλήρωτη → παύση όλων των πελατών της
  env.viva.chargeFail = true;
  env.at('2027-01-26T10:00:00+02:00'); env.ctx.billingCycle();
  env.at('2027-02-10T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.props['BILLING_PAUSED_' + KA], 'true');
  assert.deepStrictEqual([env.ctx.billPaused_('OKP'), env.ctx.billPaused_('NEW'), env.ctx.billPaused_('ORE')], [true, true, false]);

  // έξοδος από την agency: επιστρέφουν email και χρέωση που είχε
  r = env.act({ act: 'client_agency', client: 'OKP', email: '' });
  assert.ok(/Βγήκε από την Studio X.*Επέστρεψε η χρέωση που είχε πριν \(δωρεάν\)/.test(r.message), r.message || r.error);
  cfg = env.gh('clients/OKP/config.json');
  assert.deepStrictEqual([cfg.agency, cfg.approver_to, cfg.pre_agency, cfg.billing], [undefined, undefined, undefined, { type: 'free' }]);
  assert.deepStrictEqual([env.props.AGENCY_OKP, env.props.NOTIFY_TO_OKP], [undefined, 'okp-client@example.com']);
  assert.deepStrictEqual(Object.keys(env.ast().agency.clients), ['NEW']);
  assert.ok(/πελάτες: πρώτα βγάλ/.test(env.act({ act: 'delete_user', email: 'studio@agency.example' }).error));
});

test('agency: βλέπει μόνο τους πελάτες της και τη χρέωσή της· πωλητής/agency δεν κάνουν ενέργειες· πακέτο πελάτη από την επόμενη χρέωση', function () {
  const env = agencyEnv();
  env.act({ act: 'client_agency', client: 'NEW', email: 'studio@agency.example' });
  let r = env.act({ act: 'client_plan', client: 'NEW', plan: 'Καθημερινό' });
  assert.ok(/Καθημερινό για τον .*: από την επόμενη χρέωση της Studio X \(€396,80/.test(r.message), r.message || r.error);
  assert.strictEqual(env.gh('clients/NEW/config.json').package, 'Καθημερινό');
  assert.strictEqual(env.ast().agency.clients.NEW.plan, 'Καθημερινό');
  const tok = env.loginAs('studio@agency.example');
  const d = api(env, { act: 'data', token: tok }).data;
  assert.deepStrictEqual(d.clients.map(function (c) { return c.key; }), ['NEW']);
  assert.deepStrictEqual([d.me.role, d.me.agency.next_eur, d.me.agency.clients, !!d.me.link, d.users, d.agencies], ['agency', 396.8, ['NEW'], true, undefined, []]);
  ['client_agency', 'agency_charge', 'agency_stop', 'client_plan'].forEach(function (a) {
    assert.ok(/Μόνο για διαχειριστές/.test(api(env, { act: a, token: tok, client: 'NEW', email: 'studio@agency.example', plan: 'Βασικό' }).error), a);
  });
  assert.strictEqual(env.ctx.admCommissions_([{ key: 'NEW', seller: 'studio@agency.example', name: 'Νέος' }], env.ctx.admUsers_()).length, 0, 'χωρίς προμήθεια');
});

test('agency: πελάτης που μπαίνει ενώ περιμένει ο σύνδεσμος πληρωμής → η 1η περίοδός του στην επόμενη χρέωση', function () {
  const env = agencyEnv();
  env.act({ act: 'client_agency', client: 'OKP', email: 'studio@agency.example' });
  env.act({ act: 'agency_charge', email: 'studio@agency.example' });
  const r = env.act({ act: 'client_agency', client: 'NEW', email: 'studio@agency.example' });
  assert.ok(/σύνδεσμο πληρωμής σε αναμονή με το παλιό ποσό/.test(r.message), r.message);
  env.viva.paid[String(9000000000000000 + env.viva.n)] = 'TXA';
  env.ctx.billingCycle();
  const st = env.ast();
  assert.deepStrictEqual([st.months['2026-11'].amount, st.agency.extra.map(function (x) { return [x.K, x.cents]; })], [14880, [['NEW', 24800]]]);
  assert.deepStrictEqual(env.gh('clients/NEW/config.json').billing, { type: 'agency', agency: env.ag.ref, day: 26, start: '2026-11-26' });
});

test('agency: νέος πελάτης με "agency" στο config.json (από τον Claude) → μέσα σε μία ώρα πελάτης της agency· admin/agencies.json', function () {
  const env = agencyEnv();
  env.ghStore['clients/NEW/config.json'] = Object.assign({}, env.ghStore['clients/NEW/config.json'], { agency: env.ag.ref });
  env.props.NOTIFY_TO_NEW = 'studio@agency.example';
  env.ctx.billingCycle();
  assert.deepStrictEqual([env.props.AGENCY_NEW, env.props.NOTIFY_TO_NEW], [env.KA, 'studio@agency.example']);
  const cfg = env.gh('clients/NEW/config.json');
  assert.deepStrictEqual([cfg.agency, cfg.approver_to, cfg.billing], [env.ag.ref, 'studio@agency.example', { type: 'agency', agency: env.ag.ref }]);
  assert.deepStrictEqual(Object.keys(env.ast().agency.clients), ['NEW']);
  const list = env.gh('admin/agencies.json').agencies;
  assert.deepStrictEqual(list.map(function (a) { return [a.ref, a.key, a.name, a.email, a.disc]; }), [[env.ag.ref, env.KA, 'Studio X', 'studio@agency.example', 20]]);
  assert.ok(env.mails.some(function (m) { return /Agency: OK-0005/.test(m.subject) && /αυτόματα από το config/.test(m.body); }));
  const n = env.calls.length;
  env.ctx.billingCycle();
  assert.ok(!env.calls.slice(n).some(function (c) { return c.method === 'put' && /agencies\.json|NEW\/config/.test(decodeURIComponent(c.url)); }), 'μία φορά');
});

test('agency: η μηνιαία αναφορά πελάτη agency χωρίς «OK Publisher»', function () {
  const env = agencyEnv();
  env.act({ act: 'client_agency', client: 'NEW', email: 'studio@agency.example' });
  const mr = { y: 2026, m: 11, key: '2026-11' };
  const base = { client: 'NEW', name: 'Νέος', month: '2026-11', counts: { by_type: {}, ig_posts: 3, ig_stories: 2, fb_posts: 0, fb_stories: 0 }, account: { days: 30 }, stories: { count: 0 }, top: [], followers: { now: 100, prev: 90 }, times: { mode: 'fixed', best: null } };
  let mail = env.ctx.reportMail_(base, mr);
  assert.ok(!/OK Publisher/.test(mail.text) && !/OK Publisher/.test(mail.html), mail.text);
  mail = env.ctx.reportMail_(Object.assign({}, base, { client: 'ORE' }), mr);
  assert.ok(/OK Publisher/.test(mail.text));
});

// ------------------------------------------------------------------ συστάσεις πελατών (Referral.gs, από 27/11/2026)
function refEnv(refCode) {
  const v = vivaFake();
  const csv = 'Χρόνος,Επιχείρηση,Υπεύθυνος,Email εγκρίσεων,Πακέτο,Τι κάνει,Κατάσταση,ΑΦΜ,Έλεγχος τιμολόγησης,Δωρεάν εβδομάδα,Κωδικός πελάτη,Σύσταση\r\n' +
    '26/11/2026 4:00:00 μ.μ.,Φούρνος,Γιώργος,okp-client@example.com,Βασικό,Ψωμί,νέο,123456783,ΟΚ,ναι,OK-0000,' + refCode + '\r\n';
  const env = admEnv(Object.assign({}, VIVA_PROPS, { CLIENTS: 'ORE,OKP', NOTIFY_TO_OKP: 'okp-client@example.com', NOTIFY_TO_ORE: 'center@example.com', REFCODE_ORE: 'orer2' }),
    { viva: v, setupsCsv: csv, gh: {
      'clients': [{ name: 'ORE', type: 'dir' }, { name: 'OKP', type: 'dir' }],
      'clients/OKP/config.json': { key: 'OKP', code: 'OK-0000', name: 'okpublisher', package: 'Βασικό', billing: { type: 'free' } },
    } });
  env.tok = env.loginAs('system@example.com');
  env.act = function (o) { return api(env, Object.assign({ token: env.tok }, o)); };
  env.at = function (t) { env.nowMs = new Date(t).getTime(); env.tok = env.loginAs('system@example.com'); };
  env.ore = function () { return JSON.parse(env.props.BILLING_ORE); };
  return env;
}
function payOffer(env) {
  env.act({ act: 'client_charge', client: 'OKP', plan: 'Βασικό' });
  env.viva.paid[String(9000000000000000 + env.viva.n)] = 'TXN';
  env.ctx.billingCycle();
}

test('σύσταση: πελάτης φέρνει νέο από τον σύνδεσμό του → €186 έκπτωση → η επόμενη χρέωσή του €0 (χωρίς κάρτα) → μετά κανονικά', function () {
  const env = refEnv('orer2');
  payOffer(env);
  assert.strictEqual(env.props.REFERRAL_CREDIT_ORE, '18600');
  assert.strictEqual(env.props.REFERRAL_DONE_OKP, 'ORE');
  const m1 = env.mails.filter(function (m) { return m.to === 'center@example.com' && /Ευχαριστούμε για τη σύσταση/.test(m.subject); })[0];
  assert.ok(m1 && /€186,00/.test(m1.body) && /okpublisher\.gr\/\?p=orer2/.test(m1.body) && !/Φούρνος/.test(m1.body), m1 && m1.body);
  assert.ok(env.mails.some(function (m) { return /Σύσταση: ORE ← OKP/.test(m.subject); }));
  // μία φορά μόνο
  env.ctx.referralAward_('OKP', JSON.parse(env.props.BILLING_OKP));
  assert.strictEqual(env.props.REFERRAL_CREDIT_ORE, '18600');
  // 1/1: χωρίς χρέωση κάρτας
  const oreCharges = function () { return env.viva.charges.filter(function (c) { return /okp ORE /.test(c.body.merchantTrns); }); };
  env.at('2027-01-01T10:00:00+02:00'); env.ctx.billingCycle();
  let st = env.ore();
  assert.deepStrictEqual([st.months['2027-01'].st, st.months['2027-01'].amount, st.months['2027-01'].credit, oreCharges().length, env.props.REFERRAL_CREDIT_ORE],
    ['paid', 0, 18600, 0, '0']);
  assert.ok(/^PAY-/.test(st.months['2027-01'].pay));
  assert.ok(env.mails.some(function (m) { return m.to === 'center@example.com' && /Αυτόν τον μήνα δεν χρεώνεστε/.test(m.subject); }));
  // 1/2: κανονική χρέωση
  env.at('2027-02-01T10:00:00+02:00'); env.ctx.billingCycle();
  st = env.ore();
  assert.deepStrictEqual([st.months['2027-02'].amount, oreCharges().pop().body.amount], [18600, 18600]);
  const pay = env.mails.filter(function (m) { return m.to === 'center@example.com' && /Χρεώθηκε/.test(m.subject); }).pop();
  assert.ok(pay && /Συστήστε μας: .*okpublisher\.gr\/\?p=orer2/.test(pay.body), pay && pay.body);
});

test('σύσταση: μεγαλύτερο πακέτο → χρεώνεται λιγότερο μία περίοδο και μετά κανονικά· σύνδεσμος πωλητή = όχι σύσταση', function () {
  const env = refEnv('orer2');
  const st0 = env.ore(); st0.amount = 31000; st0.plan = 'Μεσαίο'; env.props.BILLING_ORE = JSON.stringify(st0);
  payOffer(env);
  env.at('2027-01-01T10:00:00+02:00'); env.ctx.billingCycle();
  let st = env.ore();
  const oc = env.viva.charges.filter(function (c) { return /okp ORE /.test(c.body.merchantTrns); });
  assert.deepStrictEqual([st.months['2027-01'].amount, oc.pop().body.amount, st.amount_full], [12400, 12400, 31000]);
  const m = env.mails.filter(function (x) { return x.to === 'center@example.com' && /Χρεώθηκε/.test(x.subject); }).pop();
  assert.ok(/€124,00/.test(m.body) && /Έκπτωση σύστασης: −€186,00 \(κανονικά €310,00\)/.test(m.body), m.body);
  env.at('2027-02-01T10:00:00+02:00'); env.ctx.billingCycle();
  st = env.ore();
  assert.deepStrictEqual([st.months['2027-02'].amount, st.amount, !!st.amount_full], [31000, 31000, false]);
  // κωδικός πωλητή: καμία έκπτωση
  const env2 = refEnv('nik22');
  env2.props.ADMIN_USERS = JSON.stringify({ 'nikos@example.com': { role: 'sales', name: 'Νίκος', ref: 'nik22', pcts: [] } });
  env2.props.REFCODE_ORE = 'nik22';
  payOffer(env2);
  assert.ok(!env2.props.REFERRAL_CREDIT_ORE, 'όχι σύσταση');
});

test('σύσταση: το διαχειριστικό δείχνει τον σύνδεσμο, την έκπτωση σε αναμονή και από ποιον πελάτη ήρθε ένα σετάρισμα', function () {
  const env = refEnv('orer2');
  payOffer(env);
  const d = env.act({ act: 'data' }).data;
  const ore = d.clients.find(function (c) { return c.key === 'ORE'; }), okp = d.clients.find(function (c) { return c.key === 'OKP'; });
  assert.deepStrictEqual(JSON.parse(JSON.stringify([ore.referral.link, ore.referral.credit_eur, ore.referral.count, okp.referral.by])),
    ['https://okpublisher.gr/?p=orer2', 186, 1, 'ORE']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.setups[0].referred_by)), { key: 'ORE', name: env.ctx.clientName_('ORE') });
  assert.deepStrictEqual([d.setups[0].src.how, d.setups[0].seller, okp.src.how], ['referral', '', 'referral'], 'σύσταση = πρώτος σύνδεσμος, χωρίς πωλητή');
});

const SELL_USERS = JSON.stringify({ 'nikos@example.com': { role: 'sales', name: 'Νίκος', ref: 'nik22', pcts: [{ from: '0000-01', pct: 15 }] },
  'maria@example.com': { role: 'sales', name: 'Μαρία', ref: 'mar33' } });
function sellEnv() {
  const opts = {
    leadsCsv: 'Χρόνος,Όνομα,Επιχείρηση,Email,Τηλέφωνο,Πακέτο,Instagram/Facebook,Μήνυμα,Γλώσσα,Κατάσταση,Πηγή,Νέα,Σύσταση\r\n' +
      '26/11/2026 9:00:00 π.μ.,Α,Μόνος,a@x.gr,,,,,el,νέο,απευθείας,όχι,\r\n' +
      '26/11/2026 10:00:00 π.μ.,Β,Του Νίκου,b@x.gr,,,,,el,νέο,απευθείας,όχι,nik22\r\n' +
      '26/11/2026 11:00:00 π.μ.,Β,Του Νίκου ξανά,b@x.gr,,,,,el,νέο,απευθείας,όχι,MAR33\r\n' +
      '26/11/2026 12:00:00 μ.μ.,Γ,Της Μαρίας,c@x.gr,,,,,el,νέο,απευθείας,όχι,mar33\r\n' +
      '26/11/2026 12:30:00 μ.μ.,Δ,Άγνωστος κωδικός,d@x.gr,,,,,el,νέο,απευθείας,όχι,zzz99\r\n',
    setupsCsv: 'Χρόνος,Επιχείρηση,Υπεύθυνος,Email εγκρίσεων,Πακέτο,Τι κάνει,Κατάσταση,ΑΦΜ,Έλεγχος τιμολόγησης,Δωρεάν εβδομάδα,Κωδικός πελάτη,Σύσταση\r\n' +
      '26/11/2026 1:00:00 μ.μ.,Του Νίκου ΙΚΕ,Β,b@x.gr,Μεσαίο,x,νέο,111111111,ΟΚ,ναι,OK-0002,\r\n' +
      '26/11/2026 2:00:00 μ.μ.,Ίδιος ΑΦΜ,Ζ,z@x.gr,Μεσαίο,x,νέο,111111111,ΟΚ,όχι,OK-0002,mar33\r\n' +
      '26/11/2026 3:00:00 μ.μ.,Μόνος μετά με σύνδεσμο,Α,a@x.gr,Βασικό,x,νέο,222222222,ΟΚ,ναι,OK-0003,nik22\r\n',
    gh: { 'clients': [{ name: 'ORE', type: 'dir' }, { name: 'ABC', type: 'dir' }],
      'clients/ABC/config.json': { key: 'ABC', code: 'OK-0002', name: 'Του Νίκου ΙΚΕ', package: 'Μεσαίο' } },
  };
  const env = admEnv({ ADMIN_USERS: SELL_USERS, CLIENTS: 'ORE,ABC',
    BILLING_ABC: JSON.stringify({ plan: 'Μεσαίο', amount: 31000, start: '2026-10', tx: 'TX9', months: {
      '2026-10': { st: 'paid', pay: 'PAY-0004', amount: 31000 }, '2026-12': { st: 'paid', pay: 'PAY-0005', amount: 31000 }, '2027-01': { st: 'pending' } } }) }, opts);
  env.opts = opts;
  return env;
}

test('πωλητές: ο πρώτος σύνδεσμος κερδίζει (email → ΑΦΜ → κωδικός πελάτη, για πάντα)· μόνος = κανείς· «Πηγή» σε κάθε γραμμή', function () {
  const env = sellEnv();
  const d = api(env, { act: 'data', token: env.loginAs('system@example.com') }).data;
  const L = function (biz) { return d.leads.filter(function (l) { return l.business === biz; })[0]; };
  const S = function (biz) { return d.setups.filter(function (x) { return x.business === biz; })[0]; };
  assert.deepStrictEqual([L('Μόνος').seller, L('Μόνος').src.how], ['', 'none']);
  assert.deepStrictEqual([L('Του Νίκου').seller, L('Του Νίκου').src.how, L('Του Νίκου').src.name], ['nikos@example.com', 'link', 'Νίκος']);
  assert.strictEqual(L('Του Νίκου ξανά').seller, 'nikos@example.com', 'δεύτερος σύνδεσμος (Μαρίας) δεν τον παίρνει');
  assert.strictEqual(L('Της Μαρίας').seller, 'maria@example.com');
  assert.strictEqual(L('Άγνωστος κωδικός').seller, '');
  assert.strictEqual(S('Του Νίκου ΙΚΕ').seller, 'nikos@example.com', 'σετάρισμα χωρίς σύνδεσμο, ίδιο email');
  assert.strictEqual(S('Ίδιος ΑΦΜ').seller, 'nikos@example.com', 'ίδιος ΑΦΜ, άλλο email, σύνδεσμος Μαρίας μετά');
  assert.strictEqual(S('Μόνος μετά με σύνδεσμο').seller, 'nikos@example.com', 'ήρθε μόνος, μετά από σύνδεσμο → του πωλητή');
  assert.strictEqual(L('Μόνος').seller, '', 'η παλιά επαφή χωρίς σύνδεσμο δεν αλλάζει');
  const abc = d.clients.filter(function (c) { return c.key === 'ABC'; })[0];
  assert.deepStrictEqual([abc.seller, abc.src.how, abc.src.link], ['nikos@example.com', 'link', 'Νίκος']);
  assert.strictEqual(d.clients.filter(function (c) { return c.key === 'ORE'; })[0].src.how, 'none');
  assert.ok(d.leads.every(function (l) { return !('ref' in l) && !('auto' in l); }), 'ο κωδικός δεν βγαίνει στη σελίδα');
  const nk = d.users.filter(function (u) { return u.email === 'nikos@example.com'; })[0];
  assert.deepStrictEqual([nk.ref, nk.link, nk.pct], ['nik22', 'https://okpublisher.gr/?p=nik22', 15]);
});

test('πωλητές: ανάθεση διαχειριστή υπερισχύει («-» = κανείς)· ο πωλητής βλέπει μόνο τους δικούς του + σύνδεσμο + προμήθειες', function () {
  const env = sellEnv();
  const adm = env.loginAs('system@example.com');
  api(env, { act: 'assign', token: adm, key: 'lead:c@x.gr', email: 'nikos@example.com' });
  api(env, { act: 'assign', token: adm, key: 'lead:b@x.gr', email: '-' });
  let d = api(env, { act: 'data', token: adm }).data;
  const c = d.leads.filter(function (l) { return l.email === 'c@x.gr'; })[0];
  assert.deepStrictEqual([c.seller, c.src.how, c.src.name, c.src.link], ['nikos@example.com', 'manual', 'Νίκος', 'Μαρία']);
  const b = d.leads.filter(function (l) { return l.email === 'b@x.gr'; })[0];
  assert.deepStrictEqual([b.seller, b.src.how, b.src.link], ['', 'manual', 'Νίκος']);
  api(env, { act: 'assign', token: adm, key: 'lead:b@x.gr', email: '' });
  const nik = env.loginAs('nikos@example.com');
  d = api(env, { act: 'data', token: nik }).data;
  assert.deepStrictEqual(d.leads.map(function (l) { return l.email; }).sort(), ['b@x.gr', 'b@x.gr', 'c@x.gr']);
  assert.deepStrictEqual(d.clients.map(function (x) { return x.key; }), ['ABC']);
  assert.deepStrictEqual([d.me.link, d.me.setup_link, d.me.pct], ['https://okpublisher.gr/?p=nik22', 'https://okpublisher.gr/setup.html?p=nik22', 15]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.commissions.map(function (x) { return [x.month, x.pay, x.net, x.pct, x.amount]; }))),
    [['2026-12', 'PAY-0005', 250, 15, 37.5], ['2026-10', 'PAY-0004', 250, 15, 37.5]]);
  assert.ok(!('payments' in d) && !('users' in d));
  const mar = env.loginAs('maria@example.com');
  d = api(env, { act: 'data', token: mar }).data;
  assert.deepStrictEqual(d.clients.length + d.commissions.length, 0);
});

function prefillOf(url) {
  const m = /#d=([A-Za-z0-9_-]+)$/.exec(url);
  return m ? JSON.parse(Buffer.from(m[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) : null;
}

test('σύνδεσμος σεταρίσματος ανά επαφή: προσυμπληρωμένος (#d=), με τον κωδικό της επαφής ή της ανάθεσης· agency χωρίς email· όχι για αιτήσεις agency', function () {
  const env = sellEnv();
  const users = JSON.parse(SELL_USERS);
  users['studio@agency.example'] = { role: 'agency', name: 'Studio X', ref: 'stu55' };
  env.props.ADMIN_USERS = JSON.stringify(users);
  env.opts.leadsCsv += '27/11/2026 9:00:00 π.μ.,Ηλίας,Πελάτης Agency,el@x.gr,690,Μεσαίο,@pelatis,,el,νέο,απευθείας,όχι,stu55\r\n' +
    '27/11/2026 9:30:00 π.μ.,Θ,Studio Y,y@agency.example,,Agency,https://studio-y.gr,[Agency · ~5 πελάτες],el,νέο,απευθείας,όχι,\r\n' +
    '27/11/2026 10:00:00 π.μ.,Ιωάννα,"Καφέ ""Γωνία"" & Σία",i@x.gr,6911111111,Καθημερινό,facebook.com/gonia,,el,νέο,απευθείας,όχι,nik22\r\n';
  env.cache = {};
  const adm = env.loginAs('system@example.com');
  let d = api(env, { act: 'data', token: adm }).data;
  const L = function (biz) { return d.leads.filter(function (l) { return l.business === biz; })[0]; };
  const gon = L('Καφέ "Γωνία" & Σία');
  assert.ok(/^https:\/\/okpublisher\.gr\/setup\.html\?p=nik22#d=/.test(gon.setup_link), gon.setup_link);
  assert.deepStrictEqual(prefillOf(gon.setup_link), { b: 'Καφέ "Γωνία" & Σία', n: 'Ιωάννα', e: 'i@x.gr', p: 'Καθημερινό', s: 'facebook.com/gonia' });
  assert.ok(gon.setup_link.indexOf('6911') < 0 && !/6911/.test(JSON.stringify(prefillOf(gon.setup_link))), 'χωρίς τηλέφωνο');
  const alone = L('Μόνος');
  assert.ok(/^https:\/\/okpublisher\.gr\/setup\.html#d=/.test(alone.setup_link), 'χωρίς πωλητή: χωρίς ?p=');
  assert.deepStrictEqual(prefillOf(alone.setup_link), { b: 'Μόνος', n: 'Α', e: 'a@x.gr' });
  const ag = L('Πελάτης Agency');
  assert.ok(/^https:\/\/okpublisher\.gr\/setup\.html\?p=stu55#d=/.test(ag.setup_link), ag.setup_link);
  assert.deepStrictEqual(prefillOf(ag.setup_link), { b: 'Πελάτης Agency', n: 'Ηλίας', p: 'Μεσαίο', s: '@pelatis' }, 'agency: χωρίς το email του πελάτη');
  assert.strictEqual(L('Studio Y').setup_link, '', 'αίτηση agency: όχι σύνδεσμος σεταρίσματος');
  api(env, { act: 'assign', token: adm, key: 'lead:a@x.gr', email: 'maria@example.com' });
  d = api(env, { act: 'data', token: adm }).data;
  assert.ok(/\?p=mar33#d=/.test(L('Μόνος').setup_link), 'ανάθεση σε πωλητή → ο κωδικός του');
  d = api(env, { act: 'data', token: env.loginAs('nikos@example.com') }).data;
  assert.ok(d.leads.length && d.leads.every(function (l) { return /\?p=nik22#d=/.test(l.setup_link); }), 'ο πωλητής βλέπει τον σύνδεσμο των δικών του');
  d = api(env, { act: 'data', token: env.loginAs('studio@agency.example') }).data;
  assert.deepStrictEqual(d.leads.map(function (l) { return [l.business, prefillOf(l.setup_link).e || '']; }), [['Πελάτης Agency', '']], 'η agency βλέπει τη δική της, χωρίς email πελάτη');
});

test('σεταρίσματα: «Άλλα» και απομακρυσμένη βοήθεια (το setup.html βάζει μπροστά το [Θέλει απομακρυσμένη βοήθεια])', function () {
  const env = sellEnv();
  env.opts.setupsCsv = 'Χρόνος,Επιχείρηση,Υπεύθυνος,Email εγκρίσεων,Πακέτο,Τι κάνει,Άλλα,Κατάσταση,ΑΦΜ,Κωδικός πελάτη,Σύσταση\r\n' +
    '27/11/2026 1:00:00 μ.μ.,Με βοήθεια,Α,h@x.gr,Βασικό,x,[Θέλει απομακρυσμένη βοήθεια] απογεύματα,νέο,333333333,OK-0004,\r\n' +
    '27/11/2026 2:00:00 μ.μ.,Χωρίς βοήθεια,Β,n@x.gr,Βασικό,x,τίποτα,νέο,444444444,OK-0005,\r\n';
  env.cache = {};
  const d = api(env, { act: 'data', token: env.loginAs('system@example.com') }).data;
  const S = function (biz) { return d.setups.filter(function (x) { return x.business === biz; })[0]; };
  assert.deepStrictEqual([S('Με βοήθεια').help, S('Με βοήθεια').other, S('Χωρίς βοήθεια').help, S('Χωρίς βοήθεια').other],
    [true, '[Θέλει απομακρυσμένη βοήθεια] απογεύματα', false, 'τίποτα']);
});

test('πωλητές: νέος πωλητής παίρνει κωδικό και σύνδεσμο στο email· προμήθεια με ιστορικό (η αλλαγή ισχύει από τον τρέχοντα μήνα)', function () {
  const env = sellEnv();
  const adm = env.loginAs('system@example.com');
  assert.ok(api(env, { act: 'save_user', token: adm, email: 'new@example.com', name: 'Νέος', role: 'sales', pct: '10' }).ok);
  const u = JSON.parse(env.props.ADMIN_USERS)['new@example.com'];
  assert.ok(/^[a-z0-9]{5}$/.test(u.ref));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(u.pcts)), [{ from: '0000-01', pct: 10 }]);
  assert.ok(env.mails.some(function (m) { return m.to === 'new@example.com' && m.body.indexOf('https://okpublisher.gr/?p=' + u.ref) >= 0; }));
  assert.ok(/από 0 έως 50/.test(api(env, { act: 'save_user', token: adm, email: 'new@example.com', name: 'Νέος', role: 'sales', pct: '80' }).error));
  api(env, { act: 'save_user', token: adm, email: 'nikos@example.com', name: 'Νίκος', role: 'sales', pct: '20' });   // 26/11 → από 2026-11
  const nu = JSON.parse(env.props.ADMIN_USERS)['nikos@example.com'];
  assert.strictEqual(nu.ref, 'nik22', 'ο κωδικός μένει');
  const d = api(env, { act: 'data', token: adm }).data;
  assert.deepStrictEqual(JSON.parse(JSON.stringify(d.commissions.map(function (x) { return [x.month, x.pct, x.amount]; }))), [['2026-12', 20, 50], ['2026-10', 15, 37.5]]);
  env.props.ADMIN_USERS = JSON.stringify(Object.assign(JSON.parse(env.props.ADMIN_USERS), { 'old@example.com': { role: 'sales', name: 'Παλιός' } }));
  api(env, { act: 'data', token: adm });
  assert.ok(/^[a-z0-9]{5}$/.test(JSON.parse(env.props.ADMIN_USERS)['old@example.com'].ref), 'παλιός πωλητής χωρίς κωδικό παίρνει');
});

test('πωλητές: email στον πωλητή για νέα επαφή/σετάρισμα από τον σύνδεσμό του (μία φορά· όχι για τα παλιά)', function () {
  const env = sellEnv();
  assert.strictEqual(env.ctx.admRefNotify_(), 0, 'πρώτη φορά: μόνο σημειώνει');
  assert.ok(Number(env.props.ADMIN_REF_TS) > 0);
  env.opts.leadsCsv += '27/11/2026 9:15:00 π.μ.,Ε,Νέα Καφετέρια,e@x.gr,,Βασικό,,,el,νέο,απευθείας,όχι,nik22\r\n' +
    '27/11/2026 9:20:00 π.μ.,Ζ,Χωρίς σύνδεσμο,f@x.gr,,,,,el,νέο,απευθείας,όχι,\r\n';
  env.cache = {};
  const before = env.mails.length;
  assert.strictEqual(env.ctx.admRefNotify_(), 1);
  const m = env.mails.slice(before);
  assert.deepStrictEqual([m.length, m[0].to], [1, 'nikos@example.com']);
  assert.ok(/Νέα επαφή από τον σύνδεσμό σου: Νέα Καφετέρια/.test(m[0].subject) && m[0].body.indexOf('e@x.gr') < 0, 'χωρίς στοιχεία επικοινωνίας');
  env.cache = {};
  assert.strictEqual(env.ctx.admRefNotify_(), 0, 'όχι ξανά');
});

test('πωλητές: ώρα του Sheet με π.μ./μ.μ. (σειρά «πρώτος σύνδεσμος»)', function () {
  const t = admEnv().ctx.admTime_;
  assert.ok(t('26/11/2026 12:30:00 π.μ.') < t('26/11/2026 1:00:00 π.μ.'));
  assert.ok(t('26/11/2026 11:59:00 π.μ.') < t('26/11/2026 12:00:00 μ.μ.'));
  assert.ok(t('26/11/2026 12:00:00 μ.μ.') < t('26/11/2026 1:00:00 μ.μ.'));
  assert.ok(t('9/1/2027 8:00:00 π.μ.') > t('26/12/2026 11:00:00 μ.μ.'));
  assert.strictEqual(t('κάτι'), 0);
});

const SITE_HTML = '<!doctype html><html><head><title>Φούρνος &amp; Καφές</title><meta name="description" content="Ψωμί κάθε μέρα">' +
  '<meta name="theme-color" content="#C0392B"><meta name="generator" content="WordPress 6.4">' +
  '<link rel="stylesheet" href="/css/site.css"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato&display=swap" rel="stylesheet">' +
  '<link rel="icon" href="/fav.png"><style>:root{--brand-red:#c0392b;--cream:#FFF8E7}body{font-family:"Lato",system-ui,sans-serif;color:#333}</style></head>' +
  '<body><header><img class="site-logo" src="/img/logo.svg" alt="Φούρνος"></header><h1 style="color:#C0392B">Ζεστό ψωμί</h1><p>Από το 1965, με αγάπη.</p>' +
  '<script>var x="#123456";</script></body></html>';
const SITE_CSS = 'h1,h2{font-family:\'Playfair Display\',serif;color:#c0392b}.btn{background:rgb(192, 57, 43);color:#fff}.muted{color:rgba(0,0,0,.3)}' +
  '.box{background:#FFF8E7;border:1px solid #eee}a{color:#2E86C1}';
function siteEnv(extra) {
  const opts = {
    setupsCsv: 'Χρόνος,Επιχείρηση,Υπεύθυνος,Email εγκρίσεων,Πακέτο,Τι κάνει,Κατάσταση,ΑΦΜ,Έλεγχος τιμολόγησης,Δωρεάν εβδομάδα,Κωδικός πελάτη,Σύσταση,Ιστοσελίδα\r\n' +
      '26/11/2026 4:00:00 μ.μ.,Φούρνος Δοκιμή,Γιώργος,owner@shop.gr,Βασικό,Ψωμί,νέο,123456783,ΟΚ,ναι,OK-0002,,https://www.fournos-test.gr/\r\n' +
      '26/11/2026 5:00:00 μ.μ.,Χωρίς site,Ν,n@shop.gr,Βασικό,x,νέο,111111111,ΟΚ,ναι,OK-0003,,\r\n' +
      '26/11/2026 6:00:00 μ.μ.,Τοπικό,Ν,l@shop.gr,Βασικό,x,νέο,222222222,ΟΚ,ναι,OK-0004,,http://192.168.1.1/\r\n',
    web: Object.assign({
      'https://www.fournos-test.gr/': [200, SITE_HTML],
      'https://www.fournos-test.gr/css/site.css': [200, SITE_CSS, 'text/css'],
      'https://www.fournos-test.gr/img/logo.svg': [200, '<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml'],
    }, extra || {}),
  };
  return admEnv({}, opts);
}

test('ιστοσελίδα: χρώματα, γραμματοσειρές, λογότυπο, κείμενο → setups/<OK>/site.json + σύνοψη στο διαχειριστικό', function () {
  const env = siteEnv();
  assert.strictEqual(env.ctx.siteScanCycle_(), 1, 'μόνο αυτό με έγκυρη ιστοσελίδα');
  const put = env.calls.filter(function (c) { return c.method === 'put' && decodeURIComponent(c.url).indexOf('/contents/setups/OK-0002/site.json') > 0; });
  assert.strictEqual(put.length, 1);
  const j = JSON.parse(Buffer.from(JSON.parse(put[0].payload).content, 'base64').toString('utf8'));
  assert.strictEqual(j.title, 'Φούρνος & Καφές');
  assert.strictEqual(j.theme_color, '#C0392B');
  assert.strictEqual(j.colors[0].hex, '#C0392B', 'το πιο συχνό χρώμα πρώτο (hex + rgb)');
  assert.ok(j.colors.some(function (c) { return c.hex === '#FFF8E7'; }) && j.colors.some(function (c) { return c.hex === '#2E86C1'; }));
  assert.ok(!j.colors.some(function (c) { return c.hex === '#123456'; }), 'όχι από scripts');
  assert.ok(!j.colors.some(function (c) { return c.hex === '#000000'; }), 'διαφανές rgba(…,.3) έξω');
  assert.ok(j.colors.filter(function (c) { return c.hex === '#333333'; })[0].neutral);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(j.css_vars)), [{ name: 'brand-red', hex: '#C0392B' }, { name: 'cream', hex: '#FFF8E7' }]);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(j.google_fonts)), ['Playfair Display', 'Lato']);
  assert.deepStrictEqual(j.fonts.map(function (f) { return f.family; }).slice(0, 2).sort(), ['Lato', 'Playfair Display']);
  assert.ok(!j.fonts.some(function (f) { return /system-ui|serif/.test(f.family); }));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(j.logo_candidates)), ['https://www.fournos-test.gr/img/logo.svg']);
  assert.strictEqual(j.generator, 'WordPress 6.4');
  assert.strictEqual(j.logo_file, 'site_logo.svg');
  const lg = env.calls.filter(function (c) { return c.method === 'put' && decodeURIComponent(c.url).indexOf('/contents/setups/OK-0002/site_logo.svg') > 0; });
  assert.strictEqual(Buffer.from(JSON.parse(lg[0].payload).content, 'base64').toString('utf8'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  assert.ok(/Ζεστό ψωμί/.test(j.text) && /Από το 1965/.test(j.text) && !/var x/.test(j.text));
  const d = api(env, { act: 'data', token: env.loginAs('system@example.com') }).data;
  const s = d.setups.filter(function (x) { return x.code === 'OK-0002'; })[0];
  assert.strictEqual(s.website, 'https://www.fournos-test.gr/');
  assert.deepStrictEqual([s.site.ok, s.site.colors[0], s.site.fonts.length > 0], [true, '#C0392B', true]);
  assert.ok(!d.setups.filter(function (x) { return x.code === 'OK-0004'; })[0].site, 'IP τοπικού δικτύου: ποτέ');
  env.cache = {};
  assert.strictEqual(env.ctx.siteScanCycle_(), 0, 'μία φορά');
  assert.ok(!env.webHits.some(function (u) { return /192\.168/.test(u); }));
});

test('ιστοσελίδα: σφάλμα → ξανά δοκιμή έως 3 φορές· μετά σταματά (φαίνεται στο διαχειριστικό)', function () {
  const env = siteEnv({ 'https://www.fournos-test.gr/': [503, 'down'] });
  for (let i = 0; i < 5; i++) { env.cache = {}; env.ctx.siteScanCycle_(); }
  const sc = JSON.parse(env.props.SITE_SCAN)['OK-0002'];
  assert.deepStrictEqual([sc.ok, sc.tries, /503/.test(sc.err)], [false, 3, true]);
  assert.strictEqual(env.webHits.filter(function (u) { return u === 'https://www.fournos-test.gr/'; }).length, 3);
  const n = env.ctx.siteNorm_;
  assert.deepStrictEqual([n('fournos.gr'), n('http://localhost/x'), n('https://10.0.0.1'), n('https://printer.local'), n('ftp://x.gr'), n('όχι site')],
    ['https://fournos.gr', '', '', '', '', '']);
  assert.strictEqual(env.ctx.siteColor_('#abc'), '#AABBCC');
  assert.strictEqual(env.ctx.siteColor_('rgba(10, 20, 30, 0.9)'), '#0A141E');
  assert.strictEqual(env.ctx.siteColor_('#00000010'), '');
});

test('υποφάκελοι πελάτη: «REELS ΕΤΟΙΜΑ» και «ΛΟΓΟΤΥΠΟ» (και κάθε βράδυ)· το λογότυπο εκτός ελέγχου διπλοτύπων', function () {
  const made = {};
  const root = { getFoldersByName: function (n) { return { hasNext: function () { return !!made[n]; } }; }, createFolder: function (n) { made[n] = 1; } };
  const env = makeEnv({ props: { CLIENTS: 'ORE', FOLDER_ORE: 'ROOT' }, DriveApp: { getFolderById: function () { return root; } } });
  assert.deepStrictEqual(Array.from(env.ctx.ensureClientSubdirs_('ORE')), ['REELS ΕΤΟΙΜΑ', 'ΛΟΓΟΤΥΠΟ']);
  assert.deepStrictEqual(Array.from(env.ctx.ensureClientSubdirs_('ORE')), [], 'δεύτερη φορά τίποτα');
  assert.ok(vm.runInContext('DEDUPE_SKIP_', env.ctx).indexOf('ΛΟΓΟΤΥΠΟ') >= 0);
  assert.ok(vm.runInContext('APPR_.TOP_DIRS', env.ctx).indexOf('ΛΟΓΟΤΥΠΟ') >= 0 && vm.runInContext('APPR_.MOVE_DIRS', env.ctx).indexOf('ΛΟΓΟΤΥΠΟ') >= 0);
});

// ------------------------------------------------------------------ περίοδοι ανά πελάτη (από 26/11/2026)
const CLIENT = function (env) { return env.mails.filter(function (m) { return m.to === 'center@example.com'; }); };
const SYS = function (env) { return env.mails.filter(function (m) { return m.to === 'system@example.com'; }); };

test('περίοδοι: χρέωση «τη μέρα του πελάτη» (27) από τις 09:00· υπενθύμιση +7, παύση +15, κείμενα με ημερομηνίες', function () {
  const env = billEnv('2027-02-26T12:00:00+02:00', { BILLING_ORE: JSON.stringify({ plan: 'Βασικό', amount: 18600, start: '2027-01', day: 27, tx: 'TX1',
    months: { '2027-01': { st: 'paid', tx: 'TX1' } } }) });
  env.ctx.billingCycle();
  env.at('2027-02-27T08:30:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0, 'όχι πριν από τη μέρα του / πριν τις 09:00');
  env.at('2027-02-27T10:00:00+02:00'); env.ctx.billingCycle(); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 1, 'μία χρέωση στις 27');
  assert.strictEqual(env.state().months['2027-02'].st, 'paid');
  const m = CLIENT(env).pop();
  assert.ok(/Χρεώθηκε η συνδρομή για την περίοδο 27\/2–26\/3\/2027/.test(m.subject), m.subject);
  assert.ok(/Περίοδος: 27\/2–26\/3\/2027/.test(m.body), m.body);
  env.viva.chargeFail = true;
  env.at('2027-03-27T10:00:00+02:00'); env.ctx.billingCycle();
  let last = CLIENT(env).pop();
  assert.ok(/δεν πέρασε/.test(last.subject) && /έως τις 10\/4/.test(last.body), last.body);
  const n = CLIENT(env).length;
  env.at('2027-04-02T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(CLIENT(env).length, n, 'όχι υπενθύμιση πριν την 8η μέρα');
  env.at('2027-04-03T10:00:00+02:00'); env.ctx.billingCycle();
  assert.ok(/Υπενθύμιση πληρωμής για την περίοδο 27\/3–26\/4\/2027/.test(CLIENT(env).pop().subject));
  env.at('2027-04-10T10:00:00+02:00'); env.ctx.billingCycle();
  assert.notStrictEqual(env.props.BILLING_PAUSED_ORE, 'true');
  env.at('2027-04-11T10:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.props.BILLING_PAUSED_ORE, 'true', 'παύση την 16η μέρα');
});

test('περίοδοι: billing_start με ημερομηνία → «μέρα» πελάτη· 29–31 → 1η του επόμενου· διακοπή/αλλαγή με περιόδους', function () {
  let env = billEnv('2027-02-10T12:00:00+02:00');
  env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02-14' });
  assert.deepStrictEqual([env.state().start, env.state().day], ['2027-02', 14]);
  assert.ok(/για την περίοδο 14\/2–13\/3\/2027/.test(CLIENT(env).pop().subject));
  env = billEnv('2027-02-10T12:00:00+02:00');
  env.req({ type: 'billing_start', plan: 'Βασικό', amount_eur: 186, start: '2027-02-29' });
  assert.deepStrictEqual([env.state().start, env.state().day], ['2027-03', undefined]);
  // διακοπή: έως τη 15η μέρα της περιόδου → μετά την τρέχουσα, αλλιώς μετά την επόμενη
  const st = { plan: 'Βασικό', amount: 18600, start: '2027-01', day: 20, tx: 'T', months: { '2027-01': { st: 'paid' }, '2027-02': { st: 'paid' } } };
  assert.strictEqual(env.ctx.stopAfterFor_(st, new Date('2027-03-06T12:00:00+02:00')), '2027-02', '6/3 = 15η μέρα της 20/2–19/3');
  assert.strictEqual(env.ctx.stopAfterFor_(st, new Date('2027-03-07T12:00:00+02:00')), '2027-03');
  assert.strictEqual(env.ctx.planChangeFrom_(st, new Date('2027-03-10T12:00:00+02:00')), '2027-03', '19η μέρα → η επόμενη περίοδος');
  assert.strictEqual(env.ctx.planChangeFrom_(st, new Date('2027-03-11T12:00:00+02:00')), '2027-04');
  assert.strictEqual(env.ctx.perRange_({ day: 27 }, '2026-12'), '27/12/2026–26/1/2027');
  assert.strictEqual(env.ctx.perFor_({}, '2027-02'), 'τον Φεβρουάριο 2027', 'χωρίς «μέρα» όλα όπως πριν');
});

test('δωρεάν εβδομάδα → «Συνεχίζουμε;»: 3 σύνδεσμοι (ένας ανά πακέτο), υπενθυμίσεις 6η/7η/10η, πληρωμή → μέρα πελάτη, 1η περίοδος, επόμενη χρέωση', function () {
  const env = billEnv('2027-01-16T10:05:00+02:00');   // 5η μέρα (από 12/1)
  const res = env.req({ type: 'billing_start', trial: true, trial_start: '2027-01-12', plan: 'Μεσαίο', code: 'OK-0005' });
  assert.deepStrictEqual(env.viva.orders.map(function (o) { return o.amount; }), [18600, 31000, 49600]);
  assert.deepStrictEqual(Object.keys(res.links), ['Βασικό', 'Μεσαίο', 'Καθημερινό']);
  let m = CLIENT(env).pop();
  assert.ok(/Συνεχίζουμε;/.test(m.subject) && /Μεσαίο · €310,00 .* · αυτό που διαλέξατε: https:\/\/demo\.vivapayments\.com\/web\/checkout\?ref=/.test(m.body), m.body);
  assert.ok(/ως τις 25\/1|μετά τις 25\/1/.test(m.body), 'ισχύει ως τη 14η μέρα');
  assert.ok(!/Διακοπή συνδρομής/.test(m.body), 'όχι κουμπιά συνδρομής πριν υπάρξει συνδρομή');
  const sent = function () { return CLIENT(env).length; };
  let n = sent();
  env.at('2027-01-17T09:30:00+02:00'); env.ctx.billingCycle(); assert.strictEqual(sent(), n, 'πριν τις 10:00 τίποτα');
  env.at('2027-01-17T10:30:00+02:00'); env.ctx.billingCycle(); env.ctx.billingCycle();
  assert.strictEqual(sent(), n + 1); assert.ok(/^\[.*\] Συνεχίζουμε;$/.test(CLIENT(env).pop().subject));
  env.at('2027-01-18T11:00:00+02:00'); env.ctx.billingCycle();
  assert.ok(/Σήμερα τελειώνει η δωρεάν εβδομάδα/.test(CLIENT(env).pop().subject));
  n = sent();
  env.at('2027-01-19T11:00:00+02:00'); env.ctx.billingCycle(); assert.strictEqual(sent(), n);
  env.at('2027-01-21T11:00:00+02:00'); env.ctx.billingCycle();
  assert.ok(/Τελευταία υπενθύμιση/.test(CLIENT(env).pop().subject));
  assert.strictEqual(env.viva.orders.length, 6, 'νέοι σύνδεσμοι (οι παλιοί λήγουν)');
  // πληρώνει το Καθημερινό με τον ΠΑΛΙΟ σύνδεσμο (ισχύει ακόμα)
  env.viva.paid[String(9000000000000003)] = 'TXD';
  env.at('2027-01-22T15:00:00+02:00'); env.ctx.billingCycle();
  const st = env.state();
  assert.deepStrictEqual([st.plan, st.amount, st.start, st.day, st.tx, !!st.offer], ['Καθημερινό', 49600, '2027-01', 22, 'TXD', false]);
  assert.strictEqual(st.months['2027-01'].st, 'paid');
  assert.ok(/^PAY-\d{4}$/.test(st.months['2027-01'].pay));
  m = CLIENT(env).pop();
  assert.ok(/Ξεκινάμε/.test(m.subject) && /22\/1–21\/2\/2027/.test(m.body) && /στις 22\/2\/2027/.test(m.body), m.body);
  assert.ok(SYS(env).some(function (x) { return /Πλήρωσε μετά τη δωρεάν εβδομάδα: ORE/.test(x.subject) && /χρέωση στις 22 κάθε μήνα/.test(x.body); }));
  env.at('2027-02-21T12:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.viva.charges.length, 0);
  env.at('2027-02-22T10:00:00+02:00'); env.ctx.billingCycle();
  assert.deepStrictEqual([env.viva.charges.length, env.viva.charges[0].body.amount], [1, 49600]);
});

test('δωρεάν εβδομάδα: πληρωμή στις 30 → ξεκινά την 1η του επόμενου (χωρίς «μέρα»)· χωρίς πληρωμή → κλείνει μετά τη 14η μέρα', function () {
  let env = billEnv('2027-01-26T10:05:00+02:00');
  env.req({ type: 'billing_start', trial: true, trial_start: '2027-01-22', plan: 'Βασικό' });
  env.viva.paid[String(9000000000000001)] = 'TXB';
  env.at('2027-01-30T18:00:00+02:00'); env.ctx.billingCycle();
  assert.deepStrictEqual([env.state().start, env.state().day, env.state().plan], ['2027-02', undefined, 'Βασικό']);
  assert.ok(/τον Φεβρουάριο 2027|1\/2/.test(CLIENT(env).pop().body));
  env = billEnv('2027-01-16T10:05:00+02:00');
  env.req({ type: 'billing_start', trial: true, trial_start: '2027-01-12', plan: 'Βασικό' });
  env.at('2027-01-25T11:00:00+02:00'); env.ctx.billingCycle();
  assert.ok(!env.state().offer.closed, 'η 14η μέρα ισχύει ακόμα');
  env.at('2027-01-26T11:00:00+02:00'); env.ctx.billingCycle(); env.ctx.billingCycle();
  assert.ok(env.state().offer.closed);
  assert.strictEqual(CLIENT(env).filter(function (x) { return /Ευχαριστούμε που δοκιμάσατε/.test(x.subject); }).length, 1);
  assert.ok(SYS(env).some(function (x) { return /Δεν συνέχισε μετά τη δωρεάν εβδομάδα: ORE/.test(x.subject); }));
  const n = env.mails.length;
  env.at('2027-01-30T11:00:00+02:00'); env.ctx.billingCycle();
  assert.strictEqual(env.mails.length, n, 'μετά το κλείσιμο τίποτα');
});

test('δωρεάν εβδομάδα: η πληρωμή γράφει billing.day/start και package στο config.json (publisher-work)· διαχειριστικό δείχνει το «Συνεχίζουμε;»', function () {
  const env = actEnv();
  env.at = function (t) { env.nowMs = new Date(t).getTime(); };
  env.at('2026-12-05T10:05:00+02:00');
  const res = {};
  env.ctx.doRequest_('OKP', { type: 'billing_start', trial: true, trial_start: '2026-12-01', plan: 'Βασικό' }, res);
  let d = env.act({ act: 'data' }).data, c = d.clients.find(function (x) { return x.key === 'OKP'; });
  assert.deepStrictEqual([c.billing.offer.day, c.billing.offer.until, c.billing.offer.chosen], [5, '2026-12-14', 'Βασικό']);
  env.viva.paid[String(9000000000000002)] = 'TXM';
  env.at('2026-12-06T12:00:00+02:00'); env.ctx.billingCycle();
  const cfg = env.gh('clients/OKP/config.json');
  assert.deepStrictEqual(JSON.parse(JSON.stringify([cfg.billing, cfg.package])), [{ type: 'paid', day: 6, start: '2026-12-06' }, 'Μεσαίο']);
  d = env.act({ act: 'data' }).data; c = d.clients.find(function (x) { return x.key === 'OKP'; });
  assert.deepStrictEqual([c.billing.day, c.billing.next_date, c.billing.months[0].label], [6, '2027-01-06', '6/12/2026–5/1/2027']);
});

// ------------------------------------------------------------------ σύνδεσμοι Facebook (permalink_url, από 26/11/2026)
function fbLinkEnv(fail) {
  return makeEnv({ props: Object.assign({}, BASE_PROPS), now: '2026-12-06T22:03:00+02:00',
    graphFail: function (url) { return !!fail && /fields=permalink_url/.test(url); },
    graph: function (url, o, resp) {
      const m = /\/([^\/?]+)\?fields=permalink_url/.exec(url);
      if (!m) return null;
      const id = m[1];
      if (/^(PP|F)/.test(id)) return resp(200, { permalink_url: 'https://www.facebook.com/okpage/posts/pfbid0' + id, id: id });
      if (/^V\d/.test(id)) return resp(200, { permalink_url: '/reel/' + id + '/', id: id });
      return resp(200, { id: id });   // stories / post_id βίντεο: χωρίς permalink
    } });
}

test('Facebook: σύνδεσμος = permalink_url (ανοίγει και στο κινητό) για post/carousel/reel· story χωρίς permalink → stories της σελίδας', function () {
  const env = fbLinkEnv(false), ctx = env.ctx;
  const img = ctx.publishFb_({ client: 'ORE', id: 'A', type: 'IMAGE', images: ['https://x/1.jpg'], caption: 'c' });
  assert.ok(/^https:\/\/www\.facebook\.com\/okpage\/posts\/pfbid0PP\d+$/.test(img.link), img.link);
  const car = ctx.publishFb_({ client: 'ORE', id: 'B', type: 'CAROUSEL', images: ['https://x/1.jpg', 'https://x/2.jpg'], caption: 'c' });
  assert.ok(/\/posts\/pfbid0F\d+$/.test(car.link), car.link);
  const reel = ctx.publishFb_({ client: 'ORE', id: 'C', type: 'REEL', video: 'https://x/v.mp4', caption: 'c' });
  assert.ok(/^https:\/\/www\.facebook\.com\/reel\/V\d+\/$/.test(reel.link), 'σχετικός σύνδεσμος βίντεο → πλήρης: ' + reel.link);
  const st = ctx.publishFb_({ client: 'ORE', id: 'D', type: 'STORY', images: ['https://x/1.jpg'] });
  assert.strictEqual(st.link, 'https://www.facebook.com/stories/PAGE1', 'story χωρίς permalink → τα stories της σελίδας (24 ώρες)');
  const vs = ctx.publishFb_({ client: 'ORE', id: 'E', type: 'STORY', images: [], video: 'https://x/s.mp4' });
  assert.ok(/^https:\/\/www\.facebook\.com\/(reel\/V\d+\/|stories\/PAGE1)$/.test(vs.link), vs.link);
  assert.ok(env.calls.some(function (c) { return /PS\d+\?fields=permalink_url/.test(c.url); }), 'ζητήθηκε και για το story');
});

test('Facebook: αν το permalink αποτύχει → η δημοσίευση μένει «Δημοσιεύτηκε» (παλιός σύνδεσμος), καμία δεύτερη δημοσίευση', function () {
  const p = Object.assign({}, BASE_PROPS, { START_AFTER: '2026-12-06T12:00:00+02:00' });
  const env = makeEnv({ props: p, queues: { [OLD_Q]: lsQueue() }, now: '2026-12-06T22:03:00+02:00', graphFail: function (url) { return /fields=permalink_url/.test(url); } });
  env.ctx.run();
  const d = JSON.parse(env.props['fbdone_LS-2026-12-06-post']);
  assert.ok(/^https:\/\/www\.facebook\.com\/(PP|F)\w+$/.test(d.link), d.link);
  assert.ok(!env.props['fbfail_LS-2026-12-06-post']);
  const n = graphPosts(env).length;
  env.nowMs += 10 * 60000; env.ctx.run();
  assert.strictEqual(graphPosts(env).length, n);
});

test('fixFbLinks: διορθώνει ΜΟΝΟ το link των fbdone_* και τη «Λεπτομέρεια» στο Ιστορικό· checkFbLinks δεν αλλάζει τίποτα', function () {
  const env = fbLinkEnv(false);
  env.props['fbdone_ORE-1'] = JSON.stringify({ at: '2026-11-26T18:00:00.000Z', link: 'https://www.facebook.com/PAGE1_9', media: 'PP9' });
  env.props['fbdone_ORE-2'] = JSON.stringify({ at: '2026-11-26T08:00:00.000Z', link: 'PS7', media: 'PS7' });
  env.props['done_ORE-1'] = JSON.stringify({ at: 'x', link: 'https://instagram.com/p/1', media: 'M1' });
  const h = env.ctx.sheet_('Ιστορικό', ['Χρόνος', 'Πελάτης', 'ID', 'Τύπος', 'Κατάσταση', 'Λεπτομέρειες']);
  h.appendRow([new Date(), 'ORE', 'ORE-1', 'CAROUSEL', 'Facebook: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://www.facebook.com/PAGE1_9']);
  h.appendRow([new Date(), 'ORE', 'ORE-1', 'CAROUSEL', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://instagram.com/p/1']);
  h.appendRow([new Date(), 'ORE', 'ORE-2', 'STORY', 'Facebook: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'PS7']);
  const before = JSON.stringify(env.props);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(env.ctx.checkFbLinks())), { changed: 1, same: 0, none: 1 });
  assert.strictEqual(JSON.stringify(env.props), before, 'check: καμία αλλαγή');
  env.ctx.fixFbLinks();
  const d = JSON.parse(env.props['fbdone_ORE-1']);
  assert.deepStrictEqual([d.link, d.media, d.at], ['https://www.facebook.com/okpage/posts/pfbid0PP9', 'PP9', '2026-11-26T18:00:00.000Z']);
  assert.strictEqual(env.props['done_ORE-1'], JSON.stringify({ at: 'x', link: 'https://instagram.com/p/1', media: 'M1' }), 'Instagram ανέγγιχτο');
  assert.strictEqual(h.rows[1][5], 'https://www.facebook.com/okpage/posts/pfbid0PP9');
  assert.strictEqual(h.rows[2][5], 'https://instagram.com/p/1');
  assert.strictEqual(JSON.parse(env.props['fbdone_ORE-2']).link, 'PS7');
  env.activeUser = '';
  assert.throws(function () { env.ctx.fixFbLinks(); }, /editor|χέρι|manual/i);
});

test('διαχειριστικό: «Δημοσιεύτηκαν» — μία κάρτα ανά δημοσίευση με σύνδεσμους IG/FB (από Ουρά/Ιστορικό), σφάλματα χωριστά, ορατότητα πωλητή', function () {
  const env = admEnv();
  const ss = env.ctx.SpreadsheetApp.getActive(), h = ss.getSheetByName('Ιστορικό'), q = ss.getSheetByName('Ουρά');
  h.rows.push([new Date('2026-11-25T20:01:00+02:00'), 'ORE', 'ORE-0', 'STORY', 'Facebook: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'VP3']);
  h.rows.push([new Date('2026-11-20T20:01:00+02:00'), 'ORE', 'ORE-X', 'IMAGE', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://instagram.com/p/X']);
  h.rows.push([new Date('2026-11-20T20:01:00+02:00'), 'ORE', 'ORE-X', 'IMAGE', 'Facebook: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://www.facebook.com/PAGE1_5']);
  h.rows.push([new Date('2026-10-01T20:01:00+02:00'), 'ORE', 'ORE-OLD', 'IMAGE', 'Instagram: ΔΗΜΟΣΙΕΥΤΗΚΕ', 'https://instagram.com/p/OLD']);
  h.rows.push([new Date('2026-11-24T20:01:00+02:00'), 'ORE', 'ORE-Y', 'IMAGE', 'Instagram: ΣΦΑΛΜΑ 1/3', 'mock error']);
  q.rows.push(['ORE', new Date('2026-11-20T20:00:00+02:00'), 'IMAGE', 'Λεζάντα Χ', 1, 'Δημοσιεύτηκε', 'https://instagram.com/p/X', 'Δημοσιεύτηκε', 'https://www.facebook.com/okpage/posts/pfbid0X', 'ORE-X']);
  const d = api(env, { act: 'data', token: env.loginAs('system@example.com') }).data;
  const ids = d.published.map(function (p) { return p.id; });
  assert.deepStrictEqual(ids, ['ORE-0', 'ORE-X'], 'πιο πρόσφατο πρώτο· όχι πάνω από 30 ημέρες, όχι μόνο-σφάλμα');
  const x = d.published[1];
  assert.deepStrictEqual(JSON.parse(JSON.stringify([x.caption, x.ig, x.fb])), ['Λεζάντα Χ', { status: 'Δημοσιεύτηκε', link: 'https://instagram.com/p/X' },
    { status: 'Δημοσιεύτηκε', link: 'https://www.facebook.com/okpage/posts/pfbid0X' }], 'ο τρέχων σύνδεσμος από την «Ουρά»');
  const o = d.published[0];
  assert.deepStrictEqual(JSON.parse(JSON.stringify(o.fb)), { status: 'Δημοσιεύτηκε', link: 'https://fb/x' });
  assert.ok(/Σφάλμα/.test(o.ig.status), 'η κατάσταση Instagram από την «Ουρά»');
  assert.ok(d.problems.some(function (p) { return p.id === 'ORE-Y' && /ΣΦΑΛΜΑ/.test(p.status); }));
  api(env, { act: 'save_user', token: env.loginAs('system@example.com'), email: 'sales@example.com', name: 'Ν', role: 'sales' });
  const sd = api(env, { act: 'data', token: env.loginAs('sales@example.com') }).data;
  assert.deepStrictEqual([sd.published.length, sd.problems.length], [0, 0], 'πωλητής χωρίς πελάτες: τίποτα');
});

test('CSV: κενές γραμμές, \\r\\n, BOM, κελί με αλλαγή γραμμής', function () {
  const env = admEnv();
  const r = env.ctx.admParseCsv_('﻿a,b\r\n"x\ny","z ""q"""\r\n,\n');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), [['a', 'b'], ['x\ny', 'z "q"'], ['', '']]);
});

// ------------------------------------------------------------------ σελίδα πελάτη (Client.gs)
const CLI_SETUPS_CSV = 'Χρόνος,Επιχείρηση,Υπεύθυνος,Email εγκρίσεων,Άλλοι εγκρίνοντες,Πακέτο,Τηλέφωνα (posts),Facebook,Instagram,Διεύθυνση/περιοχή,Τι κάνει,Τι ΔΕΝ γράφουμε,Κριτικές Google,Ώρες,Κατάσταση,Επωνυμία τιμολόγησης,ΑΦΜ,ΔΟΥ,Διεύθυνση τιμολόγησης,Μουσική στα reels,Κωδικός πελάτη,Ιστοσελίδα,Διεύθυνση καταστήματος\r\n' +
  '20/11/2026 4:00:00 μ.μ.,Learning ORE,Λ,center@example.com,deputy@example.com,Βασικό,2310 000000,fb.com/ls,@ls,Ωραιόκαστρο,Θεραπείες παιδιών,Όχι τιμές,https://g.page/r/x,αυτόματες,σετ,Κέντρο ΙΚΕ,094014298,Α Θεσ,Οδός 1,Ήρεμη,OK-0001,https://ls.gr,Βασ. Γεωργίου 11\r\n';
function capi(env, o) { return JSON.parse(env.ctx.doPost({ postData: { contents: JSON.stringify(Object.assign({ a: 'client' }, o)) }, parameter: {} }).text); }
function cliMail(env, email) { return env.mails.filter(function (x) { return x.to === email && /λογαριασμό σας στο okpublisher/.test(x.subject); }).pop(); }
function cliEnv(extra) {
  const env = admEnv(Object.assign({ FOLDER_ORE: 'https://drive.google.com/drive/folders/FOLDERid123456' }, extra || {}), { setupsCsv: CLI_SETUPS_CSV });
  env.clientLogin = function (email) {
    env.cache = {};
    capi(env, { act: 'login', email: email });
    const m = cliMail(env, email);
    return m ? capi(env, { act: 'pin', email: email, pin: /Κωδικός (\d{6})/.exec(m.subject)[1] }).token : null;
  };
  return env;
}

test('σελίδα πελάτη: σύνδεση μόνο με το email εγκρίσεων (κωδικός ή σύνδεσμος)· ίδια απάντηση για όλους· όχι πελάτες agency', function () {
  const env = cliEnv();
  const r = capi(env, { act: 'login', email: 'stranger@example.com' });
  assert.ok(r.ok && /Αν το email είναι email πελάτη μας/.test(r.message));
  assert.strictEqual(env.mails.length, 0, 'κανένα email σε άγνωστο');
  capi(env, { act: 'login', email: 'Center@Example.com' });
  const m = cliMail(env, 'center@example.com');
  assert.ok(m && /^Κωδικός \d{6} για τον λογαριασμό σας στο okpublisher$/.test(m.subject));
  const code = /okpublisher\.gr\/client\/#t=([a-f0-9]+)/.exec(m.body)[1];
  const tok = capi(env, { act: 'link', code: code }).token;
  assert.ok(/^[a-f0-9]{64}$/.test(tok));
  assert.ok(!capi(env, { act: 'link', code: code }).ok, 'ο σύνδεσμος μία φορά');
  const d = capi(env, { act: 'data', token: tok });
  assert.ok(d.ok && d.data.client.key === 'ORE', JSON.stringify(d).slice(0, 300));
  assert.strictEqual(capi(env, { act: 'data', token: tok, client: 'TST' }).data.client.key, 'ORE', 'ξένος πελάτης στα δεδομένα → ο δικός του');
  assert.ok(capi(env, { act: 'save', token: tok, client: 'TST', fields: { name: 'Χ' } }).login, 'ξένος πελάτης σε αλλαγή → ξανά σύνδεση');
  assert.ok(capi(env, { act: 'data', token: 'f'.repeat(64) }).login);
  env.props.AGENCY_ORE = 'ag1';
  assert.ok(capi(env, { act: 'data', token: tok }).login, 'πελάτης agency: καμία πρόσβαση');
  env.cache = {}; const before = env.mails.length;
  capi(env, { act: 'login', email: 'center@example.com' });
  assert.strictEqual(env.mails.length, before, 'πελάτης agency: κανένα email σύνδεσης');
  delete env.props.AGENCY_ORE;
  capi(env, { act: 'logout', token: tok });
  assert.ok(capi(env, { act: 'data', token: tok }).login, 'έξοδος');
});

test('σελίδα πελάτη: δεδομένα (στοιχεία από το σετάρισμα, συνδρομή, αναρτήσεις, πληρωμές, φάκελος, σύσταση)', function () {
  const env = cliEnv();
  const d = capi(env, { act: 'data', token: env.clientLogin('center@example.com') }).data, c = d.client;
  assert.deepStrictEqual(d.clients.map(function (x) { return x.key; }), ['ORE']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify([c.profile.name, c.profile.email, c.profile.approvers, c.profile.phones, c.profile.area, c.profile.shop_address,
    c.profile.website, c.profile.reviews, c.profile.about, c.profile.avoid, c.profile.music, c.profile.times, c.profile.reels])),
    ['Learning & Sensory Ωραιόκαστρο', 'center@example.com', ['deputy@example.com'], '2310 000000', 'Ωραιόκαστρο', 'Βασ. Γεωργίου 11',
     'https://ls.gr', 'https://g.page/r/x', 'Θεραπείες παιδιών', 'Όχι τιμές', 'Ήρεμη', 'auto', 'fill_reel_slots_then_posts_then_next_month']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.bill)), { name: 'Κέντρο ΙΚΕ', afm: '094014298', doy: 'Α Θεσ', address: 'Οδός 1' });
  assert.strictEqual(c.billing.plan, 'Βασικό');
  assert.deepStrictEqual([c.plan_change.state, c.stop.state], ['active', 'active']);
  assert.strictEqual(c.folder, 'https://drive.google.com/drive/folders/FOLDERid123456');
  assert.ok(/^https:\/\/okpublisher\.gr\/\?p=[a-z0-9]{5}$/.test(c.referral.link));
  assert.deepStrictEqual(c.upcoming.map(function (p) { return p.type; }), ['IMAGE']);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(c.payments.map(function (p) { return [p.pay, p.amount]; }))), [['PAY-0001', 186]]);
  assert.deepStrictEqual(d.plans.map(function (p) { return p.name + ' ' + p.eur; }), ['Βασικό 186,00', 'Μεσαίο 310,00', 'Καθημερινό 496,00']);
  assert.ok(!JSON.stringify(d).match(/tokORE|billkey123|vivasecret|ghtok/), 'ποτέ tokens/κλειδιά στη σελίδα');
});

test('σελίδα πελάτη: αλλαγές εφαρμόζονται αμέσως (config.json + ρυθμίσεις)· email σε πελάτη, παλιό email και okpublisher· ιστορικό', function () {
  const env = cliEnv();
  const tok = env.clientLogin('center@example.com');
  assert.ok(/ΩΩ:ΛΛ/.test(capi(env, { act: 'save', token: tok, fields: { times: 'custom', post_time: '25:00', story_time: '10:00' } }).error));
  assert.ok(/email/.test(capi(env, { act: 'save', token: tok, fields: { email: 'όχι' } }).error));
  assert.ok(/ιστοσελίδα/.test(capi(env, { act: 'save', token: tok, fields: { website: 'όχι site' } }).error));
  assert.strictEqual(capi(env, { act: 'save', token: tok, fields: { phones: '2310 000000' } }).message, 'Δεν άλλαξε τίποτα.');
  const before = env.mails.length;
  const r = capi(env, { act: 'save', token: tok, fields: { name: 'Learning & Sensory', email: 'new@example.com', approvers: 'deputy@example.com, x2@example.com',
    phones: '2310 111111', shop_address: 'Νέα οδός 5', website: 'learning.gr', times: 'custom', post_time: '19:00', story_time: '10:30', reels: 'all_in_month', music: 'Ζωντανή' } });
  assert.ok(r.ok && r.relogin && /new@example\.com/.test(r.message), JSON.stringify(r));
  const cfg = env.ghStore['clients/ORE/config.json'];
  assert.deepStrictEqual(JSON.parse(JSON.stringify([cfg.name, cfg.notify_to, cfg.approver_to, cfg.approvers, cfg.times, cfg.post_time, cfg.story_time, cfg.ready_reels_mode])),
    ['Learning & Sensory', 'new@example.com', 'new@example.com', ['new@example.com', 'deputy@example.com', 'x2@example.com'], 'manual', '19:00', '10:30', 'all_in_month']);
  assert.deepStrictEqual([cfg.profile.phones, cfg.profile.shop_address, cfg.profile.website, cfg.profile.music], ['2310 111111', 'Νέα οδός 5', 'https://learning.gr', 'Ζωντανή']);
  assert.ok(!('about' in cfg.profile), 'μόνο ό,τι άλλαξε');
  assert.strictEqual(cfg.code, 'OK-0001', 'τα υπόλοιπα του config μένουν');
  assert.deepStrictEqual([env.props.NAME_ORE, env.props.NOTIFY_TO_ORE, env.props.APPROVERS_ORE], ['Learning & Sensory', 'new@example.com', 'new@example.com,deputy@example.com,x2@example.com']);
  const m = env.mails.slice(before);
  assert.ok(m.some(function (x) { return x.to === 'new@example.com' && /Αλλάξαμε τα στοιχεία σας/.test(x.subject) && /Τηλέφωνα στα posts: 2310 111111/.test(x.body); }));
  assert.ok(m.some(function (x) { return x.to === 'center@example.com' && /Άλλαξε το email του λογαριασμού σας/.test(x.subject); }), 'ειδοποίηση στο παλιό email');
  assert.ok(m.some(function (x) { return /Σελίδα πελάτη: OK-0001/.test(x.subject) && /Email εγκρίσεων: center@example\.com → new@example\.com/.test(x.body); }));
  assert.ok(capi(env, { act: 'data', token: tok }).login, 'το παλιό email δεν έχει πια πρόσβαση');
  const d = capi(env, { act: 'data', token: env.clientLogin('new@example.com') }).data;
  assert.strictEqual(d.client.profile.shop_address, 'Νέα οδός 5');
  assert.deepStrictEqual([d.client.log[0].kind, d.client.log[0].status, d.client.log[0].by], ['change', 'done', 'center@example.com']);
  assert.ok(env.ctx.approvers_('ORE', {}).indexOf('center@example.com') < 0, 'το παλιό email δεν εγκρίνει πια');
  const tok2 = env.clientLogin('new@example.com');
  capi(env, { act: 'save', token: tok2, fields: { approvers: '' } });
  assert.deepStrictEqual(JSON.parse(JSON.stringify(capi(env, { act: 'data', token: tok2 }).data.client.profile.approvers)), [], 'αφαίρεση εγκρινόντων: δεν ξαναγυρνούν από τη φόρμα');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(env.ghStore['clients/ORE/config.json'].approvers)), ['new@example.com']);
});

test('σελίδα πελάτη: πακέτο (από την επόμενη περίοδο, ίδιοι κανόνες με το email) και διακοπή· δωρεάν πελάτης δεν αλλάζει πακέτο', function () {
  const env = cliEnv();
  const tok = env.clientLogin('center@example.com');
  let r = capi(env, { act: 'plan', token: tok, plan: 'Μεσαίο' });
  assert.ok(r.ok && /Μεσαίο/.test(r.message), JSON.stringify(r));
  assert.deepStrictEqual([JSON.parse(env.props.BILLING_ORE).change.plan, JSON.parse(env.props.BILLING_ORE).change.from], ['Μεσαίο', '2027-01']);
  assert.ok(env.ghStore['clients/ORE/package_change.json'] && env.ghStore['clients/ORE/package_change.json'].status === 'scheduled');
  assert.ok(env.mails.some(function (x) { return x.to === 'center@example.com' && /Αλλαγή πακέτου σε Μεσαίο/.test(x.subject) &&
    /Ο λογαριασμός σας \(στοιχεία, πακέτο, δημοσιεύσεις, πληρωμές\): https:\/\/okpublisher\.gr\/client\//.test(x.body); }), 'σύνδεσμος στα email πληρωμής');
  r = capi(env, { act: 'plan', token: tok, plan: 'Βασικό' });
  assert.ok(/μένετε στο Βασικό/.test(r.message) && !JSON.parse(env.props.BILLING_ORE).change);
  r = capi(env, { act: 'stop', token: tok });
  assert.ok(r.ok && /σταματά/.test(r.message));
  assert.ok(JSON.parse(env.props.BILLING_ORE).stop_after);
  assert.ok(/σταματά ήδη/.test(capi(env, { act: 'stop', token: tok }).message));
  const env2 = cliEnv({ BILLING_ORE: '' });
  const r2 = capi(env2, { act: 'plan', token: env2.clientLogin('center@example.com'), plan: 'Μεσαίο' });
  assert.ok(!r2.ok && /ενεργή συνδρομή/.test(r2.error));
});

test('σελίδα πελάτη: αιτήματα (σελίδα, τιμολόγηση, άλλο) → email σε okpublisher + πελάτη· «Έγινε» από το διαχειριστικό', function () {
  const env = cliEnv();
  const tok = env.clientLogin('center@example.com');
  assert.ok(/ΑΦΜ/.test(capi(env, { act: 'request', token: tok, kind: 'billing', data: { name: 'Νέα ΙΚΕ', afm: '123', doy: 'Α', address: 'Οδός' } }).error));
  assert.ok(capi(env, { act: 'request', token: tok, kind: 'billing', data: { name: 'Νέα ΙΚΕ', afm: 'EL 094014298', doy: 'Α Θεσ', address: 'Οδός 2' } }).ok);
  assert.ok(capi(env, { act: 'request', token: tok, kind: 'page', data: { facebook: 'facebook.com/new', instagram: '@new' } }).ok);
  assert.ok(env.mails.some(function (x) { return /Αίτημα πελάτη: OK-0001 · .* · Νέα σελίδα Facebook \/ Instagram/.test(x.subject) && /TOKEN_ORE/.test(x.body); }));
  assert.ok(env.mails.some(function (x) { return x.to === 'center@example.com' && /Λάβαμε το αίτημά σας: Νέα στοιχεία τιμολόγησης/.test(x.subject); }));
  const adm = env.loginAs('system@example.com');
  let d = api(env, { act: 'data', token: adm }).data;
  const L = d.clients.filter(function (c) { return c.key === 'ORE'; })[0].client_log;
  assert.deepStrictEqual(L.map(function (x) { return [x.kind, x.status, x.title]; }), [['request', 'new', 'Νέα σελίδα Facebook / Instagram'], ['request', 'new', 'Νέα στοιχεία τιμολόγησης']]);
  assert.ok(/έγινε/.test(api(env, { act: 'client_log_done', token: adm, client: 'ORE', id: L[0].id }).message));
  assert.strictEqual(JSON.parse(env.props.CLIENT_LOG_ORE)[0].status, 'done');
  assert.ok(!capi(env, { act: 'request', token: tok, kind: 'other', data: { message: '' } }).ok);
});

test('email καλωσορίσματος μετά το σετάρισμα: μία φορά, με τη σελίδα «Ο λογαριασμός μου»· όχι agency, όχι παλιά· σύνδεση πριν ενεργοποιηθεί', function () {
  const csv = 'Χρόνος,Επιχείρηση,Υπεύθυνος,Email εγκρίσεων,Πακέτο,Τι κάνει,Άλλα,Κατάσταση,ΑΦΜ,Δωρεάν εβδομάδα,Κωδικός πελάτη,Σύσταση\r\n' +
    '27/11/2026 6:00:00 μ.μ.,Παλιό,Α,old@x.gr,Βασικό,x,,νέο,111,ναι,OK-0002,\r\n' +
    '28/11/2026 10:00:00 π.μ.,Καφέ Γωνία,Β,gonia@x.gr,Μεσαίο,x,[Θέλει απομακρυσμένη βοήθεια] απόγευμα,νέο,222,ναι,OK-0003,nik22\r\n' +
    '28/11/2026 11:00:00 π.μ.,Πελάτης Agency,Γ,studio@agency.example,Βασικό,x,,νέο,333,ναι,OK-0004,stu55\r\n' +
    '28/11/2026 12:00:00 μ.μ.,Ξανά,Δ,again@x.gr,Βασικό,x,,νέο,444,όχι: ο ίδιος ΑΦΜ,OK-0005,\r\n';
  const env = admEnv({ ADMIN_USERS: JSON.stringify({ 'nikos@example.com': { role: 'sales', name: 'Νίκος', ref: 'nik22' },
    'studio@agency.example': { role: 'agency', name: 'Studio X', ref: 'stu55' } }) }, { setupsCsv: csv });
  assert.strictEqual(env.ctx.cliWelcome_(), 2);
  const W = function (to) { return env.mails.filter(function (m) { return m.to === to && /Λάβαμε το σετάρισμά σας/.test(m.subject); }); };
  const g = W('gonia@x.gr')[0];
  assert.ok(g && /«Καφέ Γωνία» \(κωδικός πελάτη OK-0003\)/.test(g.body), g && g.body);
  assert.ok(/Ο λογαριασμός σας: https:\/\/okpublisher\.gr\/client\//.test(g.body) && /βλέπετε τα πάντα/.test(g.body) && /ακόμα και πακέτο/.test(g.body));
  assert.ok(/απομακρυσμένη σύνδεση: θα σας γράψουμε/.test(g.body) && /τη δωρεάν εβδομάδα \(3 posts και 3 stories\)/.test(g.body));
  assert.ok(/href="https:\/\/okpublisher\.gr\/client\/"/.test(g.htmlBody) && !/<script/i.test(g.htmlBody));
  assert.ok(/το πρώτο πρόγραμμα/.test(W('again@x.gr')[0].body) && !/δωρεάν εβδομάδα/.test(W('again@x.gr')[0].body), 'χωρίς δωρεάν εβδομάδα');
  assert.deepStrictEqual([W('old@x.gr').length, W('studio@agency.example').length], [0, 0], 'όχι παλιά, όχι agency');
  assert.strictEqual(env.ctx.cliWelcome_(), 0, 'μία φορά');
  assert.ok(env.ctx.billingCycle.toString().indexOf('cliWelcome_()') >= 0, 'τρέχει στον ωριαίο κύκλο');
  env.cache = {};
  capi(env, { act: 'login', email: 'gonia@x.gr' });
  assert.ok(env.mails.some(function (m) { return m.to === 'gonia@x.gr' && /ενεργοποιείται σύντομα/.test(m.subject) && /Καφέ Γωνία/.test(m.body); }), 'σύνδεση πριν ενεργοποιηθεί');
  env.cache = {};
  const n = env.mails.length;
  capi(env, { act: 'login', email: 'studio@agency.example' });
  capi(env, { act: 'login', email: 'nobody@x.gr' });
  assert.strictEqual(env.mails.length, n, 'agency / άγνωστος: τίποτα');
});

// ------------------------------------------------------------------ υπογραφή Gmail (Signature.gs)
const SIG_URL = 'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs';
const SIG_HTML = '<div><img src="https://okpublisher.gr/img/mark.png"><b>okpublisher</b><br>Ένα ΟΚ τον μήνα.<br><a href="https://okpublisher.gr/">okpublisher.gr</a></div>';
function sigEnv(extra, sigHtml) {
  const web = {}; web[SIG_URL] = [200, JSON.stringify({ sendAs: [{ sendAsEmail: 'other@example.com', signature: 'ΛΑΘΟΣ' },
    { sendAsEmail: 'system@example.com', isPrimary: true, signature: sigHtml === undefined ? SIG_HTML : sigHtml }] }), 'application/json'];
  return admEnv(extra || {}, { web: web });
}

test('υπογραφή Gmail: μπαίνει στα email προς πελάτες (κείμενο + HTML), από το Gmail του λογαριασμού· όχι σε πελάτη agency, όχι στα email συστήματος', function () {
  const env = sigEnv();
  env.ctx.notify_('ORE', 'Θέμα', 'Γεια σας,\nκείμενο https://okpublisher.gr/client/');
  const m = env.mails.pop();
  assert.ok(/κείμενο https:\/\/okpublisher\.gr\/client\/\n\n-- \nokpublisher\nΈνα ΟΚ τον μήνα\.\nokpublisher\.gr$/.test(m.body), m.body);
  assert.ok(/<a href="https:\/\/okpublisher\.gr\/client\/">/.test(m.htmlBody) && m.htmlBody.indexOf(SIG_HTML) > 0 && m.htmlBody.indexOf('ΛΑΘΟΣ') < 0);
  env.ctx.notify_('ORE', 'Με HTML', 'κείμενο', '<p>html</p>');
  const h = env.mails.pop();
  assert.ok(h.htmlBody.indexOf('<p>html</p><br><div style="margin-top:14px">' + SIG_HTML) === 0, h.htmlBody);
  env.ctx.systemNotify_('Σφάλμα', 'κάτι');
  assert.ok(env.mails.pop().body === 'κάτι', 'όχι στα email συστήματος');
  env.props.AGENCY_ORE = 'ag1';
  env.ctx.notify_('ORE', 'Agency', 'κείμενο');
  const a = env.mails.pop();
  assert.ok(a.body === 'κείμενο' && !a.htmlBody, 'πελάτης agency: χωρίς υπογραφή (κανένα okpublisher)');
  const n = env.calls.filter(function (c) { return c.url === SIG_URL; }).length;
  env.ctx.notify_('ORE', 'ξανά', 'x');
  assert.strictEqual(env.calls.filter(function (c) { return c.url === SIG_URL; }).length, n, 'cache: όχι νέα κλήση στο Gmail');
});

test('υπογραφή Gmail: αλλάζει όταν αλλάξει στο Gmail· άδεια → τίποτα· Gmail εκτός → η τελευταία γνωστή· email καλωσορίσματος χωρίς διπλό κλείσιμο', function () {
  const env = sigEnv({}, '');
  env.ctx.notify_('ORE', 'Θέμα', 'κείμενο');
  assert.strictEqual(env.mails.pop().body, 'κείμενο', 'χωρίς υπογραφή στο Gmail: όπως πριν');
  const env2 = sigEnv();
  env2.ctx.sig_();
  env2.cache = {};
  delete env2.opts;
  env2.ctx.UrlFetchApp.fetch = (function (f) { return function (u, o) { if (u === SIG_URL) throw new Error('Gmail εκτός'); return f(u, o); }; })(env2.ctx.UrlFetchApp.fetch);
  env2.ctx.notify_('ORE', 'Θέμα', 'κείμενο');
  assert.ok(/\n-- \nokpublisher/.test(env2.mails.pop().body), 'η τελευταία γνωστή υπογραφή');
  const csv = 'Χρόνος,Επιχείρηση,Υπεύθυνος,Email εγκρίσεων,Πακέτο,Τι κάνει,Κατάσταση,ΑΦΜ,Δωρεάν εβδομάδα,Κωδικός πελάτη\r\n28/11/2026 10:00:00 π.μ.,Καφέ,Β,cafe@x.gr,Βασικό,x,νέο,1,ναι,OK-0009\r\n';
  const web = {}; web[SIG_URL] = [200, JSON.stringify({ sendAs: [{ sendAsEmail: 'system@example.com', signature: SIG_HTML }] }), 'application/json'];
  const env3 = admEnv({}, { setupsCsv: csv, web: web });
  env3.ctx.cliWelcome_();
  const w = env3.mails.filter(function (x) { return x.to === 'cafe@x.gr'; })[0];
  assert.ok(w.body.indexOf('Ένα ΟΚ τον μήνα. Τα υπόλοιπα') < 0 && /-- \nokpublisher/.test(w.body), 'όχι διπλό κλείσιμο');
});

test('υπογραφή Gmail: στα email έγκρισης (sendMail_) με κείμενο και HTML· καρτέλα «Υπογραφή» για τη φόρμα (μόνο όταν αλλάζει)', function () {
  const env = approvalEnv({ gh: { 'clients/ORE/config.json': ORE_CFG,
    'clients/ORE/outbox/2027-01-01-send.json': JSON.stringify({ type: 'email', subject: 'Πρόγραμμα Ιανουαρίου', text: 'Γεια σας', html: '<p>Γεια σας</p>' }) } });
  env.ctx.sig_ = function () { return { html: '<b>SIG</b>', text: 'SIG' }; };
  env.ctx.approvalCycle();
  const raw = env.sent[0].raw;
  assert.ok(/Γεια σας\n\n-- \nSIG/.test(mimePart(raw, 'text/plain')), mimePart(raw, 'text/plain'));
  assert.ok(/<p>Γεια σας<\/p><br><div style="margin-top:14px"><b>SIG<\/b><\/div>/.test(mimePart(raw, 'text/html')));
  const e2 = sigEnv();
  assert.strictEqual(e2.ctx.sigSync_(), true);
  const tab = e2.ctx.SpreadsheetApp.getActive().getSheetByName('Υπογραφή');
  assert.deepStrictEqual([tab.rows[0][0], tab.rows[0][1], tab.rows[1][0]], ['HTML', SIG_HTML, 'Κείμενο']);
  assert.strictEqual(tab.rows[1][1], 'okpublisher\nΈνα ΟΚ τον μήνα.\nokpublisher.gr');
  assert.strictEqual(e2.ctx.sigSync_(), false, 'ίδια υπογραφή: δεν ξαναγράφει');
  assert.ok(e2.ctx.billingCycle.toString().indexOf('sigSync_()') >= 0, 'κάθε ώρα στον κύκλο πληρωμών');
});

// ------------------------------------------------------------------ εκτέλεση
let failed = 0;
tests.forEach(function (t) {
  try { t.fn(); console.log('✓ ' + t.name); }
  catch (e) { failed++; console.log('✗ ' + t.name + '\n    ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n    ')); }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' δοκιμές πέρασαν');
process.exit(failed ? 1 : 0);
