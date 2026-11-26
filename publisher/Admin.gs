/**
 * Διαχειριστικό του okpublisher (από 26/11/2026): σελίδα της εφαρμογής ιστού για κινητό → WEBAPP_URL?a=admin
 *
 * Σύνδεση χωρίς κωδικούς: email → σύνδεσμος μίας χρήσης (15′, μόνο σε email με πρόσβαση) → κουμπί «Σύνδεση» →
 *   συνεδρία 30 ημερών σε αυτή τη συσκευή. Το απλό άνοιγμα του συνδέσμου δεν συνδέει (τα προγράμματα email τον «ανοίγουν»).
 * Χρήστες (ADMIN_USERS, JSON { email: { role, name } }): role = admin (όλα) ή sales (πωλητής: μόνο ό,τι του έχει ανατεθεί,
 *   χωρίς πληρωμές, ιστορικό πληρωμών και χρήστες). Τους προσθέτει ένας admin από τη σελίδα. Ο λογαριασμός που τρέχει
 *   το script (okpublisher) είναι πάντα admin: με αυτόν γίνεται η πρώτη σύνδεση.
 * Αναθέσεις σε πωλητή: ADMIN_ASSIGN (JSON { "lead:<email>" | "setup:<κωδικός>" | "client:<K>": email }).
 * Συνεδρίες: ADMIN_SESSIONS (μόνο το hash του κλειδιού συνεδρίας).
 *
 * Δεδομένα (ΜΟΝΟ ανάγνωση, καμία νέα άδεια Google):
 *   - Επαφές / Σεταρίσματα: Sheet «okpublisher — ενδιαφέροντα» ως CSV με το token του script (άδεια drive).
 *     ID και gid στο admin/config.json του publisher-work: { leads_sheet, leads_gid, setups_gid } (όχι στο δημόσιο repo).
 *   - Πελάτες: clients/<K>/config.json + state.json του publisher-work (κωδικός OK-…, πακέτο, έγκριση) + Script Properties
 *     (όνομα, παύση, πληρωμές BILLING_<K>). Ποτέ tokens ή κλειδιά στη σελίδα.
 *   - Δημοσιεύσεις, Ιστορικό, Πληρωμές: οι καρτέλες «Ουρά», «Ιστορικό», «Πληρωμές» του Sheet «okpublisher».
 */
const ADM_ = {
  SESSION_DAYS: 30,
  LOGIN_TTL_S: 900,
  MAX_SESSIONS: 40,
  CLIENTS_CACHE_S: 300,
  LEADS_CACHE_S: 60,
  ROLES: ['admin', 'sales'],
  ROLE_NAMES: { admin: 'Διαχειριστής', sales: 'Πωλητής' },
  LOGIN_MSG: 'Αν το email έχει πρόσβαση, σας στείλαμε σύνδεσμο. Ισχύει 15 λεπτά.',
  ROWS: 150,
};

// ------------------------------------------------------------------ χρήστες και συνεδρίες
function admEmail_(s) { s = String(s || '').trim().toLowerCase(); return /^[^@\s,;]+@[^@\s,;]+\.[^@\s,;]+$/.test(s) ? s : ''; }
function admOwner_() { try { return admEmail_(Session.getEffectiveUser().getEmail()); } catch (e) { return ''; } }
function admJson_(k) { try { return JSON.parse(prop_(k, '{}')) || {}; } catch (e) { return {}; } }

function admUsers_() {
  const raw = admJson_('ADMIN_USERS'), u = {};
  Object.keys(raw).forEach(function (e) {
    const x = raw[e] || {}, em = admEmail_(e);
    if (em && ADM_.ROLES.indexOf(x.role) >= 0) u[em] = { role: x.role, name: String(x.name || '').slice(0, 80) };
  });
  const o = admOwner_();
  if (o) u[o] = { role: 'admin', name: 'okpublisher', owner: true };
  return u;
}

function admSaveUsers_(u) {
  const c = {};
  Object.keys(u).forEach(function (e) { if (!u[e].owner) c[e] = { role: u[e].role, name: u[e].name || '' }; });
  P_().setProperty('ADMIN_USERS', JSON.stringify(c));
}

function admHash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(s), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}
function admRandom_() { return (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '').toLowerCase(); }
function admTok_(t) { t = String(t || ''); return /^[a-f0-9]{40,80}$/.test(t) ? t : ''; }

function admSessions_() {
  const s = admJson_('ADMIN_SESSIONS'), now = Date.now(), out = {};
  Object.keys(s).forEach(function (h) { if (s[h] && s[h].x > now) out[h] = s[h]; });
  return out;
}
function admSaveSessions_(s) {
  const keys = Object.keys(s).sort(function (a, b) { return s[b].x - s[a].x; }).slice(0, ADM_.MAX_SESSIONS), out = {};
  keys.forEach(function (h) { out[h] = s[h]; });
  P_().setProperty('ADMIN_SESSIONS', JSON.stringify(out));
}

// Ο χρήστης της συνεδρίας { email, role, name } ή σφάλμα «login» (η σελίδα δείχνει ξανά τη σύνδεση).
function admSession_(token) {
  const t = admTok_(token);
  if (!t) throw new Error('login');
  const rec = admSessions_()[admHash_(t)];
  if (!rec) throw new Error('login');
  const u = admUsers_()[rec.e];
  if (!u) throw new Error('login');
  return { email: rec.e, role: u.role, name: u.name || '', owner: !!u.owner };
}
function admNeedAdmin_(me) { if (me.role !== 'admin') throw new Error('Μόνο για διαχειριστές.'); }

// ------------------------------------------------------------------ σύνδεση (καλούνται από τη σελίδα)
function adminLogin(email) {
  const e = admEmail_(email);
  if (!e) return ADM_.LOGIN_MSG;
  const c = CacheService.getScriptCache();
  const ke = 'adm:rl:' + admHash_(e).slice(0, 16), n = Number(c.get(ke) || 0), g = Number(c.get('adm:rl') || 0);
  if (n >= 3 || g >= 30) return ADM_.LOGIN_MSG;            // όριο: 3 ανά email / 15′, 30 συνολικά / ώρα
  c.put(ke, String(n + 1), 900);
  c.put('adm:rl', String(g + 1), 3600);
  if (!admUsers_()[e]) return ADM_.LOGIN_MSG;              // η ίδια απάντηση: δεν φαίνεται ποια email έχουν πρόσβαση
  const url = webappUrl_();
  if (!url) throw new Error('Λείπει η διεύθυνση της εφαρμογής ιστού (WEBAPP_URL).');
  const code = admRandom_();
  c.put('adm:code:' + admHash_(code), e, ADM_.LOGIN_TTL_S);
  const link = url + '?a=admin&t=' + code;
  MailApp.sendEmail({
    to: e, name: CFG.SENDER_NAME, subject: 'Σύνδεση στο διαχειριστικό okpublisher',
    body: 'Για να συνδεθείτε στο διαχειριστικό του okpublisher, ανοίξτε τον σύνδεσμο και πατήστε «Σύνδεση»:\n\n' + link +
      '\n\nΙσχύει 15 λεπτά και μία φορά. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το email.',
    htmlBody: '<div style="font:15px/1.6 Arial,sans-serif;color:#14162E">Για να συνδεθείτε στο διαχειριστικό του okpublisher:' +
      '<p style="margin:22px 0"><a href="' + esc_(link) + '" style="display:inline-block;padding:11px 22px;background:#5B21D6;' +
      'border-radius:999px;color:#fff;text-decoration:none;font-weight:bold">Άνοιγμα διαχειριστικού</a></p>' +
      '<p style="color:#4A4C66">Ισχύει 15 λεπτά και μία φορά. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το email.</p></div>',
  });
  return ADM_.LOGIN_MSG;
}

function adminExchange(code) {
  const t = admTok_(code), bad = 'Ο σύνδεσμος δεν ισχύει πια. Ζητήστε νέο με το email σας.';
  if (!t) throw new Error(bad);
  const c = CacheService.getScriptCache(), k = 'adm:code:' + admHash_(t), e = c.get(k);
  if (!e) throw new Error(bad);
  c.remove(k);
  const u = admUsers_()[e];
  if (!u) throw new Error(bad);
  const token = admRandom_();
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const s = admSessions_();
    s[admHash_(token)] = { e: e, x: Date.now() + ADM_.SESSION_DAYS * 86400000 };
    admSaveSessions_(s);
  } finally { lock.releaseLock(); }
  return JSON.stringify({ token: token });
}

function adminLogout(token) {
  const t = admTok_(token);
  if (!t) return 'ok';
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try { const s = admSessions_(); delete s[admHash_(t)]; admSaveSessions_(s); } finally { lock.releaseLock(); }
  return 'ok';
}

// ------------------------------------------------------------------ ενέργειες διαχειριστή
function adminSaveUser(token, email, name, role) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const e = admEmail_(email);
  if (!e) throw new Error('Μη έγκυρο email.');
  if (ADM_.ROLES.indexOf(role) < 0) throw new Error('Άγνωστος ρόλος.');
  const u = admUsers_();
  if (u[e] && u[e].owner) throw new Error('Ο λογαριασμός του okpublisher είναι πάντα διαχειριστής.');
  if (e === me.email && role !== 'admin') throw new Error('Δεν μπορείτε να αφαιρέσετε από τον εαυτό σας τον ρόλο του διαχειριστή.');
  u[e] = { role: role, name: String(name || '').trim().slice(0, 80) };
  admSaveUsers_(u);
  return 'ok';
}

function adminDeleteUser(token, email) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const e = admEmail_(email), u = admUsers_();
  if (!e || !u[e]) return 'ok';
  if (u[e].owner) throw new Error('Ο λογαριασμός του okpublisher δεν αφαιρείται.');
  if (e === me.email) throw new Error('Δεν μπορείτε να αφαιρέσετε τον εαυτό σας.');
  delete u[e];
  admSaveUsers_(u);
  const a = admJson_('ADMIN_ASSIGN');                     // οι αναθέσεις του φεύγουν μαζί του
  Object.keys(a).forEach(function (k) { if (a[k] === e) delete a[k]; });
  P_().setProperty('ADMIN_ASSIGN', JSON.stringify(a));
  return 'ok';
}

function adminAssign(token, key, email) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  key = String(key || '');
  if (!/^(lead|setup|client):[^\s]{1,200}$/.test(key)) throw new Error('Άκυρη ανάθεση.');
  const a = admJson_('ADMIN_ASSIGN'), e = admEmail_(email);
  if (!e) delete a[key];
  else if (!admUsers_()[e]) throw new Error('Ο χρήστης δεν υπάρχει.');
  else a[key] = e;
  P_().setProperty('ADMIN_ASSIGN', JSON.stringify(a));
  return 'ok';
}

// ------------------------------------------------------------------ δεδομένα
function adminData(token) {
  const me = admSession_(token), admin = me.role === 'admin';
  const assign = admJson_('ADMIN_ASSIGN');
  const mine = function (key) { return admin || assign[key] === me.email; };
  const out = { me: { email: me.email, name: me.name, role: me.role, owner: me.owner }, now: new Date().toISOString(), errors: [] };

  let clients = [];
  try { clients = admClients_(); } catch (e) { out.errors.push('Πελάτες: ' + e.message); }
  out.clients = clients.filter(function (c) { return mine('client:' + c.key); }).map(function (c) {
    c.seller = assign['client:' + c.key] || '';
    if (!admin) delete c.note;
    return c;
  });
  const keys = out.clients.map(function (c) { return c.key; });
  const seen = function (K) { return admin || keys.indexOf(String(K)) >= 0; };

  let L = { leads: [], setups: [] };
  try { L = admLeads_(); } catch (e) { out.errors.push('Επαφές / σεταρίσματα: ' + e.message); }
  out.leads = L.leads.filter(function (l) { return mine('lead:' + l.email); })
    .map(function (l) { l.seller = assign['lead:' + l.email] || ''; return l; });
  out.setups = L.setups.filter(function (s) { return mine(s.code ? 'setup:' + s.code : 'lead:' + s.email); })
    .map(function (s) { s.seller = assign[s.code ? 'setup:' + s.code : 'lead:' + s.email] || ''; if (!admin) delete s.afm; return s; });

  try {
    const q = admSheet_('Ουρά');
    out.heartbeat = q.length && q[0][11] === 'Τελευταίος κύκλος' ? admIso_(q[0][12]) : '';   // βλ. syncSheet_ (Code.gs)
    out.queue = q.slice(1).filter(function (r) { return r[0] && seen(r[0]); }).map(function (r) {
      return { client: String(r[0]), at: admIso_(r[1]), type: String(r[2] || ''), caption: String(r[3] || '').slice(0, 120),
        files: Number(r[4] || 0), ig: String(r[5] || ''), ig_link: String(r[6] || ''), fb: String(r[7] || ''), fb_link: String(r[8] || ''), id: String(r[9] || '') };
    });
  } catch (e) { out.queue = []; out.errors.push('Ουρά: ' + e.message); }

  try {
    out.history = admSheet_('Ιστορικό').slice(1).slice(-ADM_.ROWS).reverse()
      .filter(function (r) { return r[1] && seen(r[1]); })
      .map(function (r) { return { at: admIso_(r[0]), client: String(r[1]), id: String(r[2] || ''), type: String(r[3] || ''), status: String(r[4] || ''), detail: String(r[5] || '').slice(0, 300) }; });
  } catch (e) { out.history = []; out.errors.push('Ιστορικό: ' + e.message); }

  if (admin) {
    try {
      out.payments = admSheet_(BILL_.SHEET).slice(1).slice(-ADM_.ROWS).reverse().map(function (r) {
        return { at: admIso_(r[0]), client: String(r[1] || ''), month: String(r[2] || ''), amount: r[3] === '' ? '' : Number(r[3]),
          action: String(r[4] || ''), result: String(r[5] || '') };
      });
    } catch (e) { out.payments = []; out.errors.push('Πληρωμές: ' + e.message); }
    const u = admUsers_();
    out.users = Object.keys(u).sort().map(function (e) { return { email: e, name: u[e].name || '', role: u[e].role, owner: !!u[e].owner }; });
  }
  out.sellers = admin ? out.users.filter(function (x) { return !x.owner; }).map(function (x) { return { email: x.email, name: x.name }; }) : [];
  return JSON.stringify(out);
}

function admIso_(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : v.toISOString();
  const d = new Date(v);
  return v && !isNaN(d.getTime()) ? d.toISOString() : String(v || '');
}

function admSheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : [];
}

// Πελάτες: publisher-work (κωδικός, πακέτο, έγκριση· cache 5′) + Script Properties (όνομα, παύση, πληρωμές· πάντα φρέσκα).
function admClients_() {
  const cache = CacheService.getScriptCache();
  let gh = null;
  try { gh = JSON.parse(cache.get('adm:clients') || 'null'); } catch (e) { gh = null; }
  const live = clients_(), all = approvalClients_();
  if (!gh) {
    gh = {};
    const dirs = ghList_('clients').filter(function (f) { return f.type === 'dir' && /^[A-Z0-9]{2,12}$/.test(f.name); }).map(function (f) { return f.name; });
    dirs.concat(all).filter(function (K, i, a) { return a.indexOf(K) === i; }).forEach(function (K) {
      let cfg = null, st = null;
      try { cfg = ghJson_('clients/' + K + '/config.json'); } catch (e) { cfg = null; }
      try { st = ghJson_('clients/' + K + '/state.json'); } catch (e) { st = null; }
      const pk = st && Array.isArray(st.packages) && st.packages.length ? st.packages[st.packages.length - 1] : null;
      gh[K] = {
        code: cfg && cfg.code ? String(cfg.code) : '', name: cfg && cfg.name ? String(cfg.name) : '',
        package: cfg && cfg.package ? String(cfg.package) : '', group: cfg && cfg.group ? String(cfg.group) : '',
        active: !cfg || cfg.active !== false, note: cfg && cfg.status ? String(cfg.status).slice(0, 400) : '',
        accounts: cfg && cfg.accounts ? { instagram: String(cfg.accounts.instagram || ''), facebook: String(cfg.accounts.facebook_page || '') } : {},
        approval: pk ? { month: String(pk.month || ''), status: String(pk.status || ''), round: pk.round || '', label: String(pk.label || '') } : null,
      };
    });
    try { cache.put('adm:clients', JSON.stringify(gh), ADM_.CLIENTS_CACHE_S); } catch (e) { /* πολύ μεγάλο: χωρίς cache */ }
  }
  return Object.keys(gh).sort().map(function (K) {
    const g = gh[K], nm = clientName_(K);
    return { key: K, code: g.code, name: nm !== K ? nm : (g.name || K), package: g.package, group: g.group, note: g.note,
      accounts: g.accounts, approval: g.approval, active: g.active,
      live: live.indexOf(K) >= 0, test: live.indexOf(K) < 0 && all.indexOf(K) >= 0,
      paused: cprop_(K, 'PAUSED', 'false') === 'true', billing_paused: billPaused_(K), billing: admBilling_(K) };
  });
}

// Σύνοψη πληρωμών ενός πελάτη (χωρίς κωδικούς Viva).
function admBilling_(K) {
  const st = billState_(K);
  if (!st) return null;
  const cur = ym_(new Date()), months = st.months || {};
  const list = Object.keys(months).sort().slice(-6).map(function (m) { return { month: m, st: String(months[m].st || '') }; });
  let next = st.start && st.start > cur ? st.start : cur;         // ο πρώτος μήνας από σήμερα που δεν έχει πληρωθεί
  for (let i = 0; i < 24 && months[next] && months[next].st === 'paid'; i++) next = nextYm_(next);
  if (st.stop_after && next > st.stop_after) next = '';
  return { plan: String(st.plan || ''), amount_eur: st.amount ? st.amount / 100 : 0, start: st.start || '', stop_after: st.stop_after || '',
    card: !!st.tx, months: list, next: next, change: st.change ? { plan: String(st.change.plan), from: String(st.change.from) } : null,
    unpaid: Object.keys(months).filter(function (m) { return m <= cur && months[m].st !== 'paid'; }).sort() };
}

// Επαφές και σεταρίσματα από το Sheet της φόρμας (CSV με το token του script). Cache 1′.
function admLeads_() {
  const cache = CacheService.getScriptCache();
  try { const hit = cache.get('adm:leads'); if (hit) return JSON.parse(hit); } catch (e) { /* ξανά */ }
  const cfg = admConfig_();
  const v = function (r, k) { return String(r[k] == null ? '' : r[k]).trim(); };
  const res = {
    leads: admCsv_(cfg.leads_sheet, cfg.leads_gid).map(function (r) {
      return { at: v(r, 'Χρόνος'), name: v(r, 'Όνομα'), business: v(r, 'Επιχείρηση'), email: v(r, 'Email').toLowerCase(), phone: v(r, 'Τηλέφωνο'),
        plan: v(r, 'Πακέτο'), social: v(r, 'Instagram/Facebook'), message: v(r, 'Μήνυμα').slice(0, 1500), lang: v(r, 'Γλώσσα'),
        status: v(r, 'Κατάσταση'), source: v(r, 'Πηγή'), news: v(r, 'Νέα') };
    }).reverse(),
    setups: admCsv_(cfg.leads_sheet, cfg.setups_gid).map(function (r) {
      return { at: v(r, 'Χρόνος'), code: v(r, 'Κωδικός πελάτη'), business: v(r, 'Επιχείρηση'), name: v(r, 'Υπεύθυνος'),
        email: v(r, 'Email εγκρίσεων').toLowerCase(), plan: v(r, 'Πακέτο'), phones: v(r, 'Τηλέφωνα (posts)'), facebook: v(r, 'Facebook'),
        instagram: v(r, 'Instagram'), address: v(r, 'Διεύθυνση/περιοχή'), about: v(r, 'Τι κάνει').slice(0, 1500), times: v(r, 'Ώρες'),
        reels: v(r, 'Έτοιμα reels'), music: v(r, 'Μουσική στα reels'), status: v(r, 'Κατάσταση'), terms: v(r, 'Όροι (έκδοση)'),
        bill_name: v(r, 'Επωνυμία τιμολόγησης'), afm: v(r, 'ΑΦΜ'), bill_check: v(r, 'Έλεγχος τιμολόγησης'), trial: v(r, 'Δωρεάν εβδομάδα') };
    }).reverse(),
  };
  try { cache.put('adm:leads', JSON.stringify(res), ADM_.LEADS_CACHE_S); } catch (e) { /* πολύ μεγάλο: χωρίς cache */ }
  return res;
}

function admConfig_() {
  const cache = CacheService.getScriptCache();
  let c = null;
  try { c = JSON.parse(cache.get('adm:config') || 'null'); } catch (e) { c = null; }
  if (!c) {
    c = ghJson_('admin/config.json');
    if (!c || !/^[A-Za-z0-9_-]{20,}$/.test(String(c.leads_sheet || ''))) throw new Error('λείπει το admin/config.json (leads_sheet) στο publisher-work');
    cache.put('adm:config', JSON.stringify(c), 3600);
  }
  return c;
}

function admCsv_(id, gid) {
  if (gid === undefined || gid === null || !/^\d+$/.test(String(gid))) throw new Error('λείπει το gid στο admin/config.json');
  const r = UrlFetchApp.fetch('https://docs.google.com/spreadsheets/d/' + encodeURIComponent(id) + '/export?format=csv&gid=' + gid,
    { muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() } });
  const type = String((r.getAllHeaders() || {})['Content-Type'] || (r.getAllHeaders() || {})['content-type'] || '');
  if (r.getResponseCode() !== 200 || /text\/html/i.test(type)) throw new Error('το Sheet δεν διαβάστηκε (' + r.getResponseCode() + ')');
  const rows = admParseCsv_(r.getContentText('UTF-8'));
  const head = (rows.shift() || []).map(function (h) { return String(h).trim(); });
  return rows.filter(function (row) { return row.some(function (x) { return String(x).trim(); }); }).map(function (row) {
    const o = {};
    head.forEach(function (h, i) { if (h) o[h] = row[i] == null ? '' : row[i]; });
    return o;
  });
}

// CSV (RFC 4180): εισαγωγικά, "" μέσα σε εισαγωγικά, αλλαγές γραμμής μέσα σε κελί.
function admParseCsv_(t) {
  const rows = [];
  let row = [], cell = '', q = false;
  t = String(t || '').replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && t[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

// ------------------------------------------------------------------ η σελίδα
function adminPage_(q) {
  const t = admTok_(q && q.t);
  const html = '<!doctype html><html lang="el"><head><meta charset="utf-8"><style>' + ADMIN_CSS_ + '</style></head><body>' +
    '<header><div class="brand">ok<b>publisher</b> <span>Διαχείριση</span></div><div id="who"></div></header>' +
    '<nav id="tabs"></nav><main id="main"><p class="muted">Μια στιγμή…</p></main>' +
    '<script>var LOGIN_CODE=' + JSON.stringify(t).replace(/</g, '\\u003c') + ';</script><script>' + ADMIN_JS_ + '</script></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Διαχείριση · okpublisher').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

const ADMIN_CSS_ = [
  ':root{--v:#5B21D6;--y:#FFD23F;--d:#14162E;--l:#F2ECFF;--g:#4A4C66;--r:#C62828;--ok:#1B7F3B}',
  '*{box-sizing:border-box}body{margin:0;font:15px/1.5 -apple-system,system-ui,Segoe UI,Roboto,Arial,sans-serif;color:var(--d);background:var(--l)}',
  'header{display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:var(--d);color:#fff;position:sticky;top:0;z-index:2}',
  '.brand{font-size:18px}.brand b{color:var(--y)}.brand span{font-size:13px;opacity:.75;margin-left:6px}#who{font-size:12px;opacity:.85;text-align:right}',
  '#who a{color:var(--y)}nav{display:flex;gap:6px;overflow-x:auto;padding:10px 12px;background:#fff;border-bottom:1px solid #e4dcf7;position:sticky;top:48px;z-index:1}',
  'nav button{flex:0 0 auto;border:1.5px solid var(--v);background:#fff;color:var(--v);border-radius:999px;padding:6px 13px;font-weight:600;font-size:14px;font-family:inherit}',
  'nav button.on{background:var(--v);color:#fff}nav button i{font-style:normal;background:var(--y);color:var(--d);border-radius:9px;padding:0 6px;margin-left:5px;font-size:12px}',
  'main{max-width:760px;margin:0 auto;padding:12px}.card{background:#fff;border-radius:16px;padding:13px 15px;margin:0 0 10px;box-shadow:0 1px 2px rgba(20,22,46,.06)}',
  '.card h3{margin:0 0 2px;font-size:16px}.row{display:flex;justify-content:space-between;gap:8px;align-items:baseline}.muted{color:var(--g);font-size:13px}',
  '.tag{display:inline-block;font-size:12px;border-radius:8px;padding:1px 7px;margin:2px 4px 2px 0;background:var(--l);color:var(--v);font-weight:600}',
  '.tag.y{background:#FFF6CC;color:#7a5b00}.tag.r{background:#fde7e7;color:var(--r)}.tag.ok{background:#e3f4e8;color:var(--ok)}',
  'h2{font-size:15px;margin:18px 4px 8px;color:var(--g);text-transform:uppercase;letter-spacing:.04em}a{color:var(--v)}',
  'details summary{cursor:pointer;color:var(--v);font-size:13px;margin-top:4px}.kv{font-size:13px;margin:6px 0 0}.kv div{margin:2px 0}.kv b{color:var(--g);font-weight:600}',
  'input,select{font-size:15px;font-family:inherit;padding:10px 12px;border:1.5px solid #d6ccef;border-radius:12px;width:100%;background:#fff}',
  '.btn{font-weight:bold;font-size:15px;font-family:inherit;background:var(--v);color:#fff;border:0;border-radius:999px;padding:11px 20px;cursor:pointer}',
  '.btn.s{background:#fff;color:var(--v);border:1.5px solid var(--v);padding:6px 12px;font-size:13px}.btn:disabled{opacity:.55}',
  '.stat{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:8px;margin-bottom:6px}.stat .card{margin:0;text-align:center}',
  '.stat b{display:block;font-size:26px;color:var(--v)}.err{background:#fde7e7;color:var(--r);border-radius:12px;padding:10px 12px;margin-bottom:10px;font-size:14px}',
  '.search{margin:0 0 10px}.login{max-width:420px;margin:40px auto}.login p{margin:0 0 12px}.grid2{display:grid;gap:8px}',
].join('');

const ADMIN_JS_ = String(function () {
  var S = null, D = null, TAB = 'today', Q = '';
  function load(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* χωρίς αποθήκευση */ } }
  function $(id) { return document.getElementById(id); }
  function esc(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function call(fn, args, ok, fail) {
    var r = google.script.run.withSuccessHandler(ok).withFailureHandler(function (e) {
      var m = String((e && e.message) || e);
      if (/login/.test(m)) { S = null; store('okp_admin', null); if (LOGIN_CODE) showExchange(); else showLogin(); return; }
      if (fail) fail(m); else flash(m);
    });
    r[fn].apply(r, args);
  }
  function flash(m) { var f = $('flash'); if (!f) { f = document.createElement('div'); f.id = 'flash'; f.className = 'err'; $('main').insertBefore(f, $('main').firstChild); } f.textContent = m; window.scrollTo(0, 0); }
  function athens(iso, withTime) {
    if (!iso || !/^\d{4}-/.test(iso)) return esc(iso || '');
    var d = new Date(iso), o = { timeZone: 'Europe/Athens', weekday: 'short', day: 'numeric', month: 'numeric' };
    if (withTime !== false) { o.hour = '2-digit'; o.minute = '2-digit'; }
    return esc(d.toLocaleString('el-GR', o));
  }
  function dayKey(iso) { return new Date(iso).toLocaleDateString('en-CA', { timeZone: 'Europe/Athens' }); }
  function months(ym) { if (!ym) return ''; var p = ym.split('-'); return ['Ιαν', 'Φεβ', 'Μαρ', 'Απρ', 'Μάι', 'Ιουν', 'Ιουλ', 'Αυγ', 'Σεπ', 'Οκτ', 'Νοε', 'Δεκ'][+p[1] - 1] + ' ' + p[0]; }
  function eur(n) { return '€' + Number(n || 0).toFixed(2).replace('.', ','); }
  function tag(t, c) { return t ? '<span class="tag ' + (c || '') + '">' + esc(t) + '</span>' : ''; }
  function kv(pairs) { return '<div class="kv">' + pairs.filter(function (p) { return p[1]; }).map(function (p) { return '<div><b>' + esc(p[0]) + ':</b> ' + p[1] + '</div>'; }).join('') + '</div>'; }
  function mail(e) { return e ? '<a href="mailto:' + esc(e) + '">' + esc(e) + '</a>' : ''; }
  function tel(p) { return p ? '<a href="tel:' + esc(String(p).replace(/[^\d+]/g, '')) + '">' + esc(p) + '</a>' : ''; }
  function link(u, t) { return u ? '<a href="' + esc(u) + '" target="_blank" rel="noopener">' + esc(t || 'άνοιγμα') + '</a>' : ''; }
  var PK = { queued: 'στην ουρά', sent: 'περιμένει ΟΚ', awaiting_approval: 'περιμένει ΟΚ', approved: 'εγκρίθηκε', draft: 'σε παραγωγή',
    changes: 'ζητήθηκαν αλλαγές', changes_requested: 'ζητήθηκαν αλλαγές', published: 'δημοσιεύτηκε', done: 'ολοκληρώθηκε' };
  function isNew(s) { return /^νέο$/i.test(String(s || '').trim()); }
  function bad(s) { return /Σφάλμα|Δεν δημοσιεύτηκε/.test(s || ''); }
  function hit(o) { if (!Q) return true; return JSON.stringify(o).toLowerCase().indexOf(Q) >= 0; }
  function clientOf(K) { return (D.clients || []).filter(function (c) { return c.key === K; })[0]; }
  function cname(K) { var c = clientOf(K); return c ? (c.code ? c.code + ' · ' : '') + c.name : K; }

  function showLogin(msg) {
    $('tabs').innerHTML = ''; $('who').innerHTML = '';
    $('main').innerHTML = '<div class="card login"><h3>Σύνδεση</h3><p class="muted">Γράψτε το email σας. Αν έχει πρόσβαση, θα σας έρθει σύνδεσμος.</p>' +
      '<div class="grid2"><input id="em" type="email" autocomplete="email" placeholder="email"><button class="btn" id="go">Στείλε μου σύνδεσμο</button></div>' +
      '<p id="lm" class="muted" style="margin-top:12px">' + esc(msg || '') + '</p></div>';
    $('go').onclick = function () {
      var b = this; b.disabled = true;
      call('adminLogin', [$('em').value], function (m) { $('lm').textContent = m; b.disabled = false; }, function (m) { $('lm').textContent = m; b.disabled = false; });
    };
  }
  function showExchange() {
    $('main').innerHTML = '<div class="card login"><h3>Σύνδεση στο διαχειριστικό</h3><p class="muted">Πατήστε για να συνδεθείτε σε αυτή τη συσκευή (30 ημέρες).</p>' +
      '<button class="btn" id="go">Σύνδεση</button><p id="lm" class="muted" style="margin-top:12px"></p></div>';
    $('go').onclick = function () {
      var b = this; b.disabled = true;
      call('adminExchange', [LOGIN_CODE], function (r) { S = JSON.parse(r).token; store('okp_admin', S); LOGIN_CODE = ''; refresh(); },
        function (m) { showLogin(m); });
    };
  }
  function refresh() {
    $('main').innerHTML = '<p class="muted">Φόρτωση…</p>';
    call('adminData', [S], function (r) { D = JSON.parse(r); render(); }, function (m) { $('main').innerHTML = '<div class="err">' + esc(m) + '</div>'; });
  }
  function logout() { call('adminLogout', [S], function () {}); S = null; store('okp_admin', null); showLogin(); }

  function tabsList() {
    var a = D.me.role === 'admin';
    var t = [['today', 'Σήμερα'], ['leads', 'Επαφές', D.leads.filter(function (l) { return isNew(l.status); }).length],
      ['setups', 'Σεταρίσματα', D.setups.filter(function (s) { return isNew(s.status); }).length], ['clients', 'Πελάτες'], ['posts', 'Δημοσιεύσεις']];
    if (a) t.push(['pay', 'Πληρωμές'], ['users', 'Χρήστες']);
    return t;
  }
  function render() {
    $('who').innerHTML = esc(D.me.name || D.me.email) + ' · ' + (D.me.role === 'admin' ? 'Διαχειριστής' : 'Πωλητής') +
      '<br><a href="#" id="rf">ανανέωση</a> · <a href="#" id="lo">έξοδος</a>';
    $('rf').onclick = function (e) { e.preventDefault(); refresh(); };
    $('lo').onclick = function (e) { e.preventDefault(); logout(); };
    $('tabs').innerHTML = tabsList().map(function (t) { return '<button data-t="' + t[0] + '" class="' + (t[0] === TAB ? 'on' : '') + '">' + t[1] + (t[2] ? '<i>' + t[2] + '</i>' : '') + '</button>'; }).join('');
    Array.prototype.forEach.call($('tabs').querySelectorAll('button'), function (b) { b.onclick = function () { TAB = b.getAttribute('data-t'); Q = ''; render(); window.scrollTo(0, 0); }; });
    var errs = (D.errors || []).map(function (e) { return '<div class="err">' + esc(e) + '</div>'; }).join('');
    var V = { today: vToday, leads: vLeads, setups: vSetups, clients: vClients, posts: vPosts, pay: vPay, users: vUsers }[TAB] || vToday;
    $('main').innerHTML = errs + V();
    var s = $('q');
    if (s) { s.value = Q; s.oninput = function () { Q = s.value.trim().toLowerCase(); var p = s.selectionStart; render(); var n = $('q'); n.focus(); n.setSelectionRange(p, p); }; }
    bind();
  }
  function search(ph) { return '<input id="q" class="search" type="search" placeholder="' + esc(ph) + '">'; }
  function sellerSel(key, cur) {
    if (D.me.role !== 'admin' || !D.sellers.length) return cur ? tag('Πωλητής: ' + cur) : '';
    return '<div class="kv"><b>Πωλητής:</b> <select data-assign="' + esc(key) + '" style="width:auto;padding:4px 8px;font-size:13px"><option value="">—</option>' +
      D.sellers.map(function (s) { return '<option value="' + esc(s.email) + '"' + (s.email === cur ? ' selected' : '') + '>' + esc(s.name || s.email) + '</option>'; }).join('') + '</select></div>';
  }
  function bind() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-assign]'), function (el) {
      el.onchange = function () { el.disabled = true; call('adminAssign', [S, el.getAttribute('data-assign'), el.value], function () { refresh(); }, function (m) { flash(m); el.disabled = false; }); };
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-deluser]'), function (el) {
      el.onclick = function () {
        if (!el.getAttribute('data-sure')) { el.setAttribute('data-sure', '1'); el.textContent = 'Σίγουρα; Πατήστε ξανά'; return; }
        el.disabled = true; call('adminDeleteUser', [S, el.getAttribute('data-deluser')], refresh, function (m) { flash(m); el.disabled = false; });
      };
    });
    var add = $('addu');
    if (add) add.onclick = function () { add.disabled = true; call('adminSaveUser', [S, $('ue').value, $('un').value, $('ur').value], function () { refresh(); }, function (m) { flash(m); add.disabled = false; }); };
  }

  function vToday() {
    var today = dayKey(new Date().toISOString());
    var nl = D.leads.filter(function (l) { return isNew(l.status); }), ns = D.setups.filter(function (s) { return isNew(s.status); });
    var posts = (D.queue || []).filter(function (p) { return p.at && dayKey(p.at) === today; });
    var probs = [];
    (D.queue || []).forEach(function (p) { if (bad(p.ig) || bad(p.fb)) probs.push(esc(cname(p.client)) + ': ' + esc(p.type) + ' ' + athens(p.at) + ' — ' + esc([p.ig, p.fb].filter(bad).join(' / '))); });
    (D.clients || []).forEach(function (c) {
      if (c.billing_paused) probs.push(esc(cname(c.key)) + ': παύση δημοσιεύσεων (απλήρωτη συνδρομή)');
      else if (c.billing && c.billing.unpaid.length && c.billing.card) probs.push(esc(cname(c.key)) + ': απλήρωτο ' + c.billing.unpaid.map(months).join(', '));
      if (c.paused) probs.push(esc(cname(c.key)) + ': σε παύση (PAUSED)');
      if (c.billing && c.billing.change) probs.push(esc(cname(c.key)) + ': αλλαγή πακέτου σε ' + esc(c.billing.change.plan) + ' από ' + months(c.billing.change.from) +
        ' — config (πακέτο, ημέρες) στην παραγωγή της 20ής');
    });
    if (D.heartbeat && Date.now() - new Date(D.heartbeat).getTime() > 40 * 60000) probs.unshift('Ο κύκλος δημοσίευσης δεν έχει τρέξει από ' + athens(D.heartbeat));
    var h = '<div class="stat"><div class="card"><b>' + nl.length + '</b>νέες επαφές</div><div class="card"><b>' + ns.length + '</b>νέα σεταρίσματα</div>' +
      '<div class="card"><b>' + posts.length + '</b>δημοσιεύσεις σήμερα</div><div class="card"><b>' + (D.clients || []).filter(function (c) { return c.live; }).length + '</b>ενεργοί πελάτες</div></div>';
    h += '<h2>Θέλει προσοχή</h2>' + (probs.length ? probs.map(function (p) { return '<div class="card">' + p + '</div>'; }).join('') : '<div class="card muted">Τίποτα. Όλα κυλούν.</div>');
    if (ns.length) h += '<h2>Νέα σεταρίσματα</h2>' + ns.slice(0, 5).map(setupCard).join('');
    if (nl.length) h += '<h2>Νέες επαφές</h2>' + nl.slice(0, 5).map(leadCard).join('');
    h += '<h2>Σήμερα δημοσιεύονται</h2>' + (posts.length ? posts.map(postCard).join('') : '<div class="card muted">Τίποτα για σήμερα.</div>');
    if (D.heartbeat) h += '<p class="muted">Τελευταίος κύκλος δημοσίευσης: ' + athens(D.heartbeat) + '</p>';
    return h;
  }
  function leadCard(l) {
    return '<div class="card"><div class="row"><h3>' + esc(l.business) + '</h3>' + tag(l.status, isNew(l.status) ? 'y' : '') + '</div>' +
      '<div class="muted">' + esc(l.name) + ' · ' + esc(l.at) + '</div>' +
      kv([['Email', mail(l.email)], ['Τηλέφωνο', tel(l.phone)], ['Πακέτο', esc(l.plan || 'δεν ξέρει')], ['Σελίδα', esc(l.social)], ['Πηγή', esc(l.source)],
        ['Νέα με email', esc(l.news)], ['Μήνυμα', esc(l.message)]]) + sellerSel('lead:' + l.email, l.seller) + '</div>';
  }
  function vLeads() {
    var L = D.leads.filter(hit);
    return search('Αναζήτηση σε επαφές…') + (L.length ? L.map(leadCard).join('') : '<div class="card muted">Καμία επαφή.</div>');
  }
  function setupCard(s) {
    var t = s.trial && s.trial !== 'ναι' ? tag('Δωρεάν εβδομάδα: όχι', 'r') : tag('Δωρεάν εβδομάδα', 'ok');
    var b = s.bill_check && s.bill_check !== 'ΟΚ' ? tag(s.bill_check, 'r') : '';
    return '<div class="card"><div class="row"><h3>' + (s.code ? esc(s.code) + ' · ' : '') + esc(s.business) + '</h3>' + tag(s.status, isNew(s.status) ? 'y' : '') + '</div>' +
      '<div class="muted">' + esc(s.name) + ' · ' + esc(s.at) + '</div>' + tag(String(s.plan).split(' ')[0]) + t + b +
      kv([['Email', mail(s.email)], ['Τηλέφωνα', esc(s.phones)], ['Instagram', esc(s.instagram)], ['Facebook', esc(s.facebook)]]) +
      '<details><summary>Περισσότερα</summary>' + kv([['Περιοχή', esc(s.address)], ['Τι κάνει', esc(s.about)], ['Ώρες', esc(s.times)], ['Έτοιμα reels', esc(s.reels)],
        ['Μουσική', esc(s.music)], ['Όροι', esc(s.terms)], ['Τιμολόγηση', esc(s.bill_name)], ['ΑΦΜ', esc(s.afm)]]) + '</details>' +
      sellerSel(s.code ? 'setup:' + s.code : 'lead:' + s.email, s.seller) + '</div>';
  }
  function vSetups() {
    var L = D.setups.filter(hit);
    return search('Αναζήτηση σε σεταρίσματα…') + (L.length ? L.map(setupCard).join('') : '<div class="card muted">Κανένα σετάρισμα.</div>');
  }
  function clientCard(c) {
    var b = c.billing, st = [];
    if (c.test) st.push(tag('δοκιμαστικός'));
    else if (c.live) st.push(tag('ενεργός', 'ok')); else st.push(tag('εκτός δημοσίευσης', 'y'));
    if (c.paused) st.push(tag('παύση', 'r'));
    if (c.billing_paused) st.push(tag('παύση: απλήρωτο', 'r'));
    var bill = b ? [['Συνδρομή', esc(b.plan) + (b.amount_eur ? ' · ' + eur(b.amount_eur) + '/μήνα' : '') + (b.card ? ' · κάρτα ✓' : ' · χωρίς κάρτα ακόμα')],
      ['Επόμενη χρέωση', b.next ? months(b.next) : (b.stop_after ? 'καμία (λήγει)' : '')], ['Λήξη μετά', months(b.stop_after)],
      ['Αλλαγή πακέτου', b.change ? esc(b.change.plan) + ' από ' + months(b.change.from) : ''],
      ['Μήνες', b.months.map(function (m) { return months(m.month) + ' ' + (m.st === 'paid' ? '✓' : '(' + m.st + ')'); }).join(' · ')]] : [['Συνδρομή', 'καμία ακόμα']];
    var ap = c.approval ? [['Τελευταίο πακέτο', esc((c.approval.label || months(c.approval.month)) + ' — ' + (PK[c.approval.status] || c.approval.status) + (c.approval.round ? ' (γύρος ' + c.approval.round + ')' : ''))]] : [];
    var next = (D.queue || []).filter(function (p) { return p.client === c.key && new Date(p.at) > new Date(); })[0];
    return '<div class="card"><div class="row"><h3>' + (c.code ? esc(c.code) + ' · ' : '') + esc(c.name) + '</h3><span class="muted">' + esc(c.key) + '</span></div>' +
      st.join('') + tag(c.package) + kv([['Instagram', esc(c.accounts && c.accounts.instagram)], ['Facebook', esc(c.accounts && c.accounts.facebook)],
        ['Επόμενη δημοσίευση', next ? athens(next.at) + ' · ' + esc(next.type) : '']].concat(ap, bill)) +
      (c.note ? '<details><summary>Σημειώσεις</summary><div class="kv">' + esc(c.note) + '</div></details>' : '') + sellerSel('client:' + c.key, c.seller) + '</div>';
  }
  function vClients() {
    var L = (D.clients || []).filter(hit);
    return search('Αναζήτηση σε πελάτες…') + (L.length ? L.map(clientCard).join('') : '<div class="card muted">Κανένας πελάτης.</div>');
  }
  function postCard(p) {
    var cls = function (s) { return bad(s) ? 'r' : (/Δημοσιεύτηκε/.test(s) ? 'ok' : ''); };
    return '<div class="card"><div class="row"><b>' + athens(p.at) + '</b><span class="muted">' + esc(p.type) + '</span></div><div class="muted">' + esc(cname(p.client)) + '</div>' +
      (p.caption ? '<div style="font-size:13px;margin:4px 0">' + esc(p.caption) + '…</div>' : '') +
      tag('IG: ' + (p.ig || '—'), cls(p.ig)) + tag('FB: ' + (p.fb || '—'), cls(p.fb)) + ' ' + link(p.ig_link, 'Instagram') + ' ' + link(p.fb_link, 'Facebook') + '</div>';
  }
  function vPosts() {
    var now = Date.now();
    var up = (D.queue || []).filter(function (p) { return new Date(p.at).getTime() > now - 6 * 3600000; }).filter(hit).slice(0, 60);
    var hi = (D.history || []).filter(hit).slice(0, 40);
    return search('Αναζήτηση…') + '<h2>Επόμενες</h2>' + (up.length ? up.map(postCard).join('') : '<div class="card muted">Η ουρά είναι άδεια.</div>') +
      '<h2>Ιστορικό</h2>' + (hi.length ? hi.map(function (r) {
        return '<div class="card"><div class="row"><b>' + athens(r.at) + '</b>' + tag(r.status, bad(r.status) || /σφάλμα|απέτυχε/i.test(r.status) ? 'r' : '') + '</div>' +
          '<div class="muted">' + esc(cname(r.client)) + ' · ' + esc(r.type) + '</div>' + (r.detail ? '<div style="font-size:13px">' + esc(r.detail) + '</div>' : '') + '</div>';
      }).join('') : '<div class="card muted">Τίποτα ακόμα.</div>');
  }
  function vPay() {
    var C = (D.clients || []).filter(function (c) { return c.billing; });
    var h = '<h2>Συνδρομές</h2>' + (C.length ? C.map(function (c) {
      var b = c.billing;
      return '<div class="card"><div class="row"><h3>' + esc(cname(c.key)) + '</h3>' + (b.unpaid.length && b.card ? tag('απλήρωτο', 'r') : tag(b.card ? 'κάρτα ✓' : 'χωρίς κάρτα', b.card ? 'ok' : 'y')) + '</div>' +
        kv([['Πακέτο', esc(b.plan) + ' · ' + eur(b.amount_eur) + '/μήνα'], ['Επόμενη χρέωση', b.next ? months(b.next) : 'καμία'], ['Λήξη μετά', months(b.stop_after)]]) + '</div>';
    }).join('') : '<div class="card muted">Καμία συνδρομή ακόμα.</div>');
    var P = (D.payments || []).filter(hit).slice(0, 80);
    h += '<h2>Κινήσεις</h2>' + search('Αναζήτηση σε κινήσεις…') + (P.length ? P.map(function (p) {
      return '<div class="card"><div class="row"><b>' + esc(cname(p.client)) + '</b><span class="muted">' + athens(p.at) + '</span></div>' +
        '<div>' + esc(p.action) + (p.amount !== '' ? ' · ' + eur(p.amount) : '') + (p.month ? ' · ' + esc(/^\d{4}-\d{2}$/.test(p.month) ? months(p.month) : p.month) : '') + '</div>' +
        '<div class="muted">' + esc(p.result) + '</div></div>';
    }).join('') : '<div class="card muted">Καμία κίνηση.</div>');
    return h;
  }
  function vUsers() {
    var h = (D.users || []).map(function (u) {
      return '<div class="card"><div class="row"><h3>' + esc(u.name || u.email) + '</h3>' + tag(u.role === 'admin' ? 'Διαχειριστής' : 'Πωλητής', u.role === 'admin' ? '' : 'y') + '</div>' +
        '<div class="muted">' + esc(u.email) + (u.owner ? ' · λογαριασμός okpublisher (πάντα διαχειριστής)' : '') + '</div>' +
        (!u.owner && u.email !== D.me.email ? '<p style="margin:8px 0 0"><button class="btn s" data-deluser="' + esc(u.email) + '">Αφαίρεση</button></p>' : '') + '</div>';
    }).join('');
    h += '<h2>Νέος χρήστης ή αλλαγή ρόλου</h2><div class="card grid2"><input id="ue" type="email" placeholder="email"><input id="un" placeholder="όνομα">' +
      '<select id="ur"><option value="sales">Πωλητής: μόνο ό,τι του αναθέτεις</option><option value="admin">Διαχειριστής: τα πάντα</option></select>' +
      '<button class="btn" id="addu">Αποθήκευση</button><p class="muted" style="margin:0">Μπαίνει με το email του: του έρχεται σύνδεσμος, χωρίς κωδικό.</p></div>';
    return h;
  }

  S = load('okp_admin');
  if (S) refresh(); else if (LOGIN_CODE) showExchange(); else showLogin();
}).replace(/^function \(\) \{|\}$/g, '');
