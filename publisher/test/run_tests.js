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
          setValues: function (v) { v.forEach(function (row, i) { rows[r - 1 + i] = row.slice(); }); return this; },
          setFontWeight: function () { return this; }, setNumberFormat: function () { return this; },
          clearContent: function () { for (let i = 0; i < nr; i++) rows[r - 1 + i] = []; return this; },
        };
      },
      appendRow: function (row) { rows.push(row); },
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
      computeDigest: function () { return [1, 2, 3]; }, DigestAlgorithm: { MD5: 'md5' },
      newBlob: function (b, m, n) { return { bytes: b, mime: m, name: n, getDataAsString: function () { return Buffer.from(b).toString('utf8'); } }; },
      base64Encode: function (x, cs) { return (typeof x === 'string' ? Buffer.from(x, 'utf8') : Buffer.from(x)).toString('base64'); },
      base64Decode: function (s) { return Array.from(Buffer.from(s, 'base64')); },
      Charset: { UTF_8: 'UTF-8' },
    },
    SpreadsheetApp: { getActive: function () { return {
      getSheetByName: function (n) { return sheets[n] || null; },
      insertSheet: function (n) { sheets[n] = sheet(n); return sheets[n]; },
    }; }, getUi: function () { return {}; } },
    Session: { getEffectiveUser: function () { return { getEmail: function () { return 'system@example.com'; } }; } },
    ScriptApp: {
      getOAuthToken: function () { return 'oauth'; },
      getProjectTriggers: function () { return triggers.slice(); },
      deleteTrigger: function (t) { triggers.splice(triggers.indexOf(t), 1); },
      newTrigger: function (fn) { const t = { fn: fn, getHandlerFunction: () => fn, getEventType: () => 'CLOCK' };
        const b = { timeBased: () => b, everyMinutes: () => b, everyDays: () => b, atHour: () => b, after: () => b, create: () => { triggers.push(t); return t; } }; return b; },
      EventType: { CLOCK: 'CLOCK' }, getService: function () { return { getUrl: () => '' }; },
    },
    DriveApp: opts.DriveApp || { getFolderById: function (id) { return folder(id, 'Φάκελος ' + id); } },
    ContentService: { createTextOutput: function (s) { return { text: s, setMimeType: function () { return this; } }; }, MimeType: { JSON: 'json' } },
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
    NAME_ORE: 'Learning & Sensory Ωραιόκαστρο' }, o.props || {}), now: o.now || '2026-12-20T12:00:00+02:00', extraFetch: extraFetch, DriveApp: dm.DriveApp });
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

test('checkApproval: μόνο έλεγχος, καμία αλλαγή', function () {
  const env = approvalEnv({ gh: { 'clients/ORE/config.json': ORE_CFG } });
  const out = env.ctx.checkApproval();
  assert.ok(/GitHub: OK .*γράφει/.test(out[0]), out[0]);
  assert.ok(/Gmail: OK/.test(out[1]));
  assert.ok(/\[ORE\].*εγκρίνοντες: 2/.test(out[2]), out[2]);
  assert.strictEqual(env.puts.length + env.sent.length + env.mails.length, 0);
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

// ------------------------------------------------------------------ εκτέλεση
let failed = 0;
tests.forEach(function (t) {
  try { t.fn(); console.log('✓ ' + t.name); }
  catch (e) { failed++; console.log('✗ ' + t.name + '\n    ' + (e.stack || e.message).split('\n').slice(0, 4).join('\n    ')); }
});
console.log('\n' + (tests.length - failed) + '/' + tests.length + ' δοκιμές πέρασαν');
process.exit(failed ? 1 : 0);
