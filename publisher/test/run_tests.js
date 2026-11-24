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
  return f.replace('yyyy', parts.year).replace('MM', pad(parts.month)).replace('HH', pad(parts.hour === '24' ? '0' : parts.hour))
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
    return { getResponseCode: () => code, getContentText: () => text, getAllHeaders: () => headers || {}, getContent: () => Buffer.from(text) };
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
    LockService: { getScriptLock: function () { return { tryLock: () => true, releaseLock: () => {} }; } },
    Utilities: {
      formatDate: fmt, sleep: function () { env.nowMs += 1000; }, getUuid: function () { return 'abcd-ef01-2345-6789-abcdefabcdef'; },
      computeDigest: function () { return [1, 2, 3]; }, DigestAlgorithm: { MD5: 'md5' },
      newBlob: function (b, m, n) { return { bytes: b, mime: m, name: n }; },
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
