/**
 * Διαχειριστικό του okpublisher: σελίδα του site https://okpublisher.gr/admin/ (κώδικας στο repo του site, admin/),
 * που μιλά με αυτό το web app μέσω JSON (doPost { a: "admin", act: … }). Από 26/11/2026 βράδυ· πριν ήταν σελίδα
 * HtmlService (?a=admin), που ως συντόμευση στην αρχική οθόνη του κινητού έβγαζε σφάλμα.
 *
 * Σύνδεση χωρίς κωδικούς πρόσβασης: email → email με 6ψήφιο κωδικό ΚΑΙ σύνδεσμο (15′, μία φορά, μόνο σε email με
 *   πρόσβαση) → συνεδρία 30 ημερών στη συσκευή. Ο κωδικός γράφεται και μέσα από την «εφαρμογή» της αρχικής οθόνης
 *   (στο iPhone έχει δικό της χώρο αποθήκευσης, άρα ο σύνδεσμος, που ανοίγει στον browser, δεν φτάνει).
 * Χρήστες (ADMIN_USERS, JSON { email: { role, name } }): role = admin (όλα) ή sales (πωλητής: μόνο ό,τι του έχει ανατεθεί,
 *   χωρίς πληρωμές, ιστορικό πληρωμών, ΑΦΜ και χρήστες). Τους προσθέτει ένας admin από τη σελίδα (ο νέος παίρνει email).
 *   Ο λογαριασμός που τρέχει το script (okpublisher) είναι πάντα admin.
 * Αναθέσεις σε πωλητή: ADMIN_ASSIGN (JSON { "lead:<email>" | "setup:<κωδικός>" | "client:<K>": email }).
 * Συνεδρίες: ADMIN_SESSIONS (μόνο το hash του κλειδιού συνεδρίας). Καμία δημόσια συνάρτηση (όλες με «_»).
 *
 * Δεδομένα (ΜΟΝΟ ανάγνωση, καμία νέα άδεια Google):
 *   - Επαφές / Σεταρίσματα: Sheet «okpublisher — ενδιαφέροντα» ως CSV με το token του script (άδεια drive).
 *     ID και gid στο admin/config.json του publisher-work: { leads_sheet, leads_gid, setups_gid } (όχι στο δημόσιο repo).
 *   - Πελάτες: clients/<K>/config.json + state.json του publisher-work (κωδικός OK-…, πακέτο, έγκριση) + Script Properties
 *     (όνομα, παύση, πληρωμές BILLING_<K>). Ποτέ tokens ή κλειδιά στη σελίδα.
 *   - Δημοσιεύσεις, Ιστορικό, Πληρωμές: οι καρτέλες «Ουρά», «Ιστορικό», «Πληρωμές» του Sheet «okpublisher».
 * Η διεύθυνση του web app γράφεται μόνη της στο admin/webapp.json του publisher-work (για τη σελίδα του site).
 *
 * Ενέργειες διαχειριστή ανά πελάτη (από 26/11/2026, μόνο role admin):
 *   - Πακέτο: με ενεργή συνδρομή → όπως η «Αλλαγή πακέτου» του πελάτη (planChangeSet_, email στον πελάτη)· χωρίς συνδρομή
 *     (δωρεάν/κανένα) → clients/<K>/package_change.json (η παραγωγή της 20ής αλλάζει config). Από τον επόμενο μήνα έως τις 19,
 *     αλλιώς από τον μεθεπόμενο.
 *   - Δωρεάν (χωρίς λήξη ή έως μήνα) → config.json billing { type: free, until }. Όχι με ενεργή συνδρομή (πρώτα διακοπή).
 *   - Χρέωση (πακέτο + πρώτος μήνας) → billing_start: σύνδεσμος πληρωμής στο email του πελάτη· config.json billing { type: paid }.
 *   - Διακοπή συνδρομής → όπως το κουμπί του πελάτη (όροι Α.8), με email στον πελάτη.
 *   Το config.json γράφεται με το GITHUB_TOKEN (μόνο τα πεδία billing)· κάθε ενέργεια → email στο okpublisher.
 */
const ADM_ = {
  SESSION_DAYS: 30,
  LOGIN_TTL_S: 900,
  MAX_SESSIONS: 40,
  CLIENTS_CACHE_S: 300,
  LEADS_CACHE_S: 60,
  ROLES: ['admin', 'sales'],
  ROLE_NAMES: { admin: 'Διαχειριστής', sales: 'Πωλητής' },
  LOGIN_MSG: 'Αν το email έχει πρόσβαση, σας στείλαμε κωδικό. Ισχύει 15 λεπτά.',
  ROWS: 150,
  SITE: 'https://okpublisher.gr/admin/',
  PIN_TRIES: 5,
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

// ------------------------------------------------------------------ σύνδεση
function admLogin_(email) {
  const e = admEmail_(email);
  if (!e) return ADM_.LOGIN_MSG;
  const c = CacheService.getScriptCache();
  const ke = 'adm:rl:' + admHash_(e).slice(0, 16), n = Number(c.get(ke) || 0), g = Number(c.get('adm:rl') || 0);
  if (n >= 3 || g >= 30) return ADM_.LOGIN_MSG;            // όριο: 3 ανά email / 15′, 30 συνολικά / ώρα
  c.put(ke, String(n + 1), 900);
  c.put('adm:rl', String(g + 1), 3600);
  if (!admUsers_()[e]) return ADM_.LOGIN_MSG;              // η ίδια απάντηση: δεν φαίνεται ποια email έχουν πρόσβαση
  const code = admRandom_(), pin = admPin_();
  c.put('adm:code:' + admHash_(code), e, ADM_.LOGIN_TTL_S);
  c.put('adm:pin:' + admHash_(e), JSON.stringify({ h: admHash_(e + '|' + pin), n: 0 }), ADM_.LOGIN_TTL_S);
  const link = ADM_.SITE + '#t=' + code;
  MailApp.sendEmail({
    to: e, name: CFG.SENDER_NAME, subject: 'Κωδικός ' + pin + ' για το διαχειριστικό okpublisher',
    body: 'Ο κωδικός σας: ' + pin + '\n\nΓράψτε τον στη σελίδα του διαχειριστικού, ή ανοίξτε τον σύνδεσμο και πατήστε «Σύνδεση»:\n' + link +
      '\n\nΙσχύει 15 λεπτά και μία φορά. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το email.',
    htmlBody: '<div style="font:15px/1.6 Arial,sans-serif;color:#14162E">Ο κωδικός σας για το διαχειριστικό του okpublisher:' +
      '<p style="font:bold 32px/1.2 Arial,sans-serif;letter-spacing:6px;color:#5B21D6;margin:18px 0">' + pin + '</p>' +
      '<p>Γράψτε τον στη σελίδα, ή <a href="' + esc_(link) + '">ανοίξτε τον σύνδεσμο</a> και πατήστε «Σύνδεση».</p>' +
      '<p style="color:#4A4C66">Ισχύει 15 λεπτά και μία φορά. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το email.</p></div>',
  });
  return ADM_.LOGIN_MSG;
}

function admPin_() {
  const b = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, admRandom_(), Utilities.Charset.UTF_8);
  return ('00000' + (((b[0] & 255) << 16 | (b[1] & 255) << 8 | (b[2] & 255)) % 1000000)).slice(-6);
}

// Νέα συνεδρία για το email: επιστρέφει το κλειδί της (μόνο το hash του αποθηκεύεται).
function admNewSession_(e) {
  const token = admRandom_();
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try {
    const s = admSessions_();
    s[admHash_(token)] = { e: e, x: Date.now() + ADM_.SESSION_DAYS * 86400000 };
    admSaveSessions_(s);
  } finally { lock.releaseLock(); }
  return token;
}

// Σύνδεση με τον 6ψήφιο κωδικό του email: το πολύ PIN_TRIES προσπάθειες, μετά χρειάζεται νέος κωδικός.
function admPinLogin_(email, pin) {
  const e = admEmail_(email), bad = 'Λάθος ή ληγμένος κωδικός. Ζητήστε νέο.';
  pin = String(pin || '').replace(/\s/g, '');
  if (!e || !/^\d{6}$/.test(pin)) throw new Error(bad);
  const c = CacheService.getScriptCache(), k = 'adm:pin:' + admHash_(e);
  let rec = null;
  try { rec = JSON.parse(c.get(k) || 'null'); } catch (x) { rec = null; }
  if (!rec || rec.n >= ADM_.PIN_TRIES) throw new Error(bad);
  if (rec.h !== admHash_(e + '|' + pin)) { rec.n++; c.put(k, JSON.stringify(rec), ADM_.LOGIN_TTL_S); throw new Error(bad); }
  c.remove(k);
  if (!admUsers_()[e]) throw new Error(bad);
  return admNewSession_(e);
}

function admExchange_(code) {
  const t = admTok_(code), bad = 'Ο σύνδεσμος δεν ισχύει πια. Ζητήστε νέο με το email σας.';
  if (!t) throw new Error(bad);
  const c = CacheService.getScriptCache(), k = 'adm:code:' + admHash_(t), e = c.get(k);
  if (!e) throw new Error(bad);
  c.remove(k);
  c.remove('adm:pin:' + admHash_(e));
  if (!admUsers_()[e]) throw new Error(bad);
  return admNewSession_(e);
}

function admLogout_(token) {
  const t = admTok_(token);
  if (!t) return 'ok';
  const lock = LockService.getScriptLock();
  lock.tryLock(10000);
  try { const s = admSessions_(); delete s[admHash_(t)]; admSaveSessions_(s); } finally { lock.releaseLock(); }
  return 'ok';
}

// ------------------------------------------------------------------ ενέργειες διαχειριστή
function admSaveUser_(token, email, name, role) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const e = admEmail_(email);
  if (!e) throw new Error('Μη έγκυρο email.');
  if (ADM_.ROLES.indexOf(role) < 0) throw new Error('Άγνωστος ρόλος.');
  const u = admUsers_();
  if (u[e] && u[e].owner) throw new Error('Ο λογαριασμός του okpublisher είναι πάντα διαχειριστής.');
  if (e === me.email && role !== 'admin') throw new Error('Δεν μπορείτε να αφαιρέσετε από τον εαυτό σας τον ρόλο του διαχειριστή.');
  const isNew = !u[e];
  u[e] = { role: role, name: String(name || '').trim().slice(0, 80) };
  admSaveUsers_(u);
  if (isNew) {
    try {
      MailApp.sendEmail({ to: e, name: CFG.SENDER_NAME, subject: 'Πρόσβαση στο διαχειριστικό okpublisher',
        body: 'Σας δόθηκε πρόσβαση στο διαχειριστικό του okpublisher (' + ADM_.ROLE_NAMES[role] + ').\n\n' + ADM_.SITE +
          '\n\nΓράψτε το email σας και θα σας έρθει κωδικός. Δεν χρειάζεται κωδικός πρόσβασης.' });
    } catch (x) { console.log('email νέου χρήστη: ' + x.message); }
  }
  return 'ok';
}

function admDeleteUser_(token, email) {
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

function admAssign_(token, key, email) {
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
function admData_(token) {
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
          action: String(r[4] || ''), result: String(r[5] || ''), pay: String(r[7] || ''), code: String(r[8] || ''), name: String(r[9] || ''),
          plan: String(r[10] || '') };
      });
    } catch (e) { out.payments = []; out.errors.push('Πληρωμές: ' + e.message); }
    const u = admUsers_();
    out.users = Object.keys(u).sort().map(function (e) { return { email: e, name: u[e].name || '', role: u[e].role, owner: !!u[e].owner }; });
  }
  out.sellers = admin ? out.users.filter(function (x) { return !x.owner; }).map(function (x) { return { email: x.email, name: x.name }; }) : [];
  return out;
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
      let pc = null;
      try { pc = ghJson_('clients/' + K + '/package_change.json'); } catch (e) { pc = null; }
      const pk = st && Array.isArray(st.packages) && st.packages.length ? st.packages[st.packages.length - 1] : null;
      gh[K] = {
        code: cfg && cfg.code ? String(cfg.code) : '', name: cfg && cfg.name ? String(cfg.name) : '',
        package: cfg && cfg.package ? String(cfg.package) : '', group: cfg && cfg.group ? String(cfg.group) : '',
        active: !cfg || cfg.active !== false, note: cfg && cfg.status ? String(cfg.status).slice(0, 400) : '',
        accounts: cfg && cfg.accounts ? { instagram: String(cfg.accounts.instagram || ''), facebook: String(cfg.accounts.facebook_page || '') } : {},
        approval: pk ? { month: String(pk.month || ''), status: String(pk.status || ''), round: pk.round || '', label: String(pk.label || '') } : null,
        free: cfg && cfg.billing && cfg.billing.type === 'free' ? { until: /^\d{4}-\d{2}$/.test(String(cfg.billing.until || '')) ? String(cfg.billing.until) : '' } : null,
        pkg_change: pc && pc.status === 'scheduled' ? { plan: String(pc.plan || ''), from: String(pc.from || '') } : null,
        has_config: !!cfg,
      };
    });
    try { cache.put('adm:clients', JSON.stringify(gh), ADM_.CLIENTS_CACHE_S); } catch (e) { /* πολύ μεγάλο: χωρίς cache */ }
  }
  return Object.keys(gh).sort().map(function (K) {
    const g = gh[K], nm = clientName_(K);
    return { key: K, code: g.code, name: nm !== K ? nm : (g.name || K), package: g.package, group: g.group, note: g.note,
      accounts: g.accounts, approval: g.approval, active: g.active, free: g.free || null, pkg_change: g.pkg_change || null,
      has_config: g.has_config !== false, has_email: !!String(cprop_(K, 'NOTIFY_TO', '')).trim(),
      live: live.indexOf(K) >= 0, test: live.indexOf(K) < 0 && all.indexOf(K) >= 0,
      paused: cprop_(K, 'PAUSED', 'false') === 'true', billing_paused: billPaused_(K), billing: admBilling_(K) };
  });
}

// Σύνοψη πληρωμών ενός πελάτη (χωρίς κωδικούς Viva).
function admBilling_(K) {
  const st = billState_(K);
  if (!st) return null;
  const cur = ym_(new Date()), months = st.months || {};
  const list = Object.keys(months).sort().slice(-6).map(function (m) { return { month: m, st: String(months[m].st || ''), pay: String(months[m].pay || '') }; });
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

// ------------------------------------------------------------------ API για τη σελίδα του site (doPost)
// Είσοδος: { a: "admin", act, … }. Έξοδος JSON: { ok: true, … } ή { ok: false, error, login? } (login = ξανά σύνδεση).
function adminApi_(p) {
  const out = function (o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); };
  try {
    const t = p.token;
    switch (String(p.act || '')) {
      case 'login': return out({ ok: true, message: admLogin_(p.email) });
      case 'pin': return out({ ok: true, token: admPinLogin_(p.email, p.pin) });
      case 'link': return out({ ok: true, token: admExchange_(p.code) });
      case 'logout': admLogout_(t); return out({ ok: true });
      case 'data': return out({ ok: true, data: admData_(t) });
      case 'save_user': admSaveUser_(t, p.email, p.name, p.role); return out({ ok: true });
      case 'delete_user': admDeleteUser_(t, p.email); return out({ ok: true });
      case 'assign': admAssign_(t, p.key, p.email); return out({ ok: true });
      case 'client_plan': return out({ ok: true, message: admClientPlan_(t, p.client, p.plan) });
      case 'client_free': return out({ ok: true, message: admClientFree_(t, p.client, p.until) });
      case 'client_charge': return out({ ok: true, message: admClientCharge_(t, p.client, p.plan, p.start) });
      case 'client_stop': return out({ ok: true, message: admClientStop_(t, p.client) });
      default: return out({ ok: false, error: 'Άγνωστη ενέργεια.' });
    }
  } catch (e) {
    const m = String((e && e.message) || e);
    return out(m === 'login' ? { ok: false, login: true, error: 'Χρειάζεται ξανά σύνδεση.' } : { ok: false, error: m });
  }
}

// Η παλιά διεύθυνση (?a=admin) δείχνει πού μεταφέρθηκε το διαχειριστικό.
function admMoved_() {
  return HtmlService.createHtmlOutput('<!doctype html><html lang="el"><head><meta charset="utf-8"></head>' +
    '<body style="font:17px/1.6 Arial,sans-serif;color:#14162E;background:#F2ECFF;margin:0"><div style="max-width:520px;margin:40px auto;' +
    'background:#fff;border-radius:22px;padding:28px"><h1 style="font-size:24px;color:#5B21D6;margin:0 0 12px">Το διαχειριστικό μεταφέρθηκε</h1>' +
    '<p><a href="' + ADM_.SITE + '" target="_top" style="color:#5B21D6;font-weight:bold">' + ADM_.SITE.replace(/^https:\/\//, '') + '</a></p></div></body></html>')
    .setTitle('Διαχείριση · okpublisher').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Μία φορά για κάθε διεύθυνση του web app: γράφεται στο admin/webapp.json του publisher-work (τη χρειάζεται η σελίδα του site).
function adminUrlToRepo_() {
  try {
    const u = webappUrl_();
    if (!u || prop_('WEBAPP_URL_REPO', '') === u) return;
    ghPutJson_('admin/webapp.json', { url: u, note: 'Η διεύθυνση /exec του web app (Apps Script «okpublisher»). Τη γράφει μόνο του το Upload.gs.', at: new Date().toISOString() },
      'Διεύθυνση web app');
    P_().setProperty('WEBAPP_URL_REPO', u);
  } catch (e) { console.log('admin/webapp.json: ' + e.message); }
}

// ------------------------------------------------------------------ ενέργειες διαχειριστή ανά πελάτη
// Ο πελάτης και το config.json του (υπάρχει φάκελος clients/<K> στο publisher-work).
function admClientCfg_(K) {
  K = String(K || '').toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(K)) throw new Error('Άγνωστος πελάτης.');
  const cfg = ghJson_('clients/' + K + '/config.json');
  if (!cfg) throw new Error('Δεν βρέθηκε το config.json του ' + K + '.');
  return { K: K, cfg: cfg };
}
function admSaveCfg_(K, cfg, what, me) {
  ghPutJson_('clients/' + K + '/config.json', cfg, 'Διαχειριστικό (' + me.email + '): ' + K + ' ' + what);
  try { CacheService.getScriptCache().remove('adm:clients'); } catch (e) { /* μένει 5′ */ }
}
function admWho_(K, cfg) { return (cfg.code ? cfg.code + ' · ' : '') + (cfg.name || clientName_(K)) + ' (' + K + ')'; }
// Ενεργή συνδρομή: πληρωμένη κάρτα και όχι λήξη στο παρελθόν.
function admPaying_(st) { return !!(st && st.tx && !(st.stop_after && st.stop_after < ym_(new Date()))); }

function admClientPlan_(token, client, plan) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const p = planOf_(plan);
  if (!p) throw new Error('Διάλεξε πακέτο.');
  const c = admClientCfg_(client), K = c.K, cfg = c.cfg, st = billState_(K);
  if (admPaying_(st)) {
    if (Object.keys(st.months || {}).some(function (m) { return st.months[m].st !== 'paid'; })) throw new Error('Υπάρχει απλήρωτος μήνας: πρώτα η πληρωμή.');
    const from = planChangeFrom_(st, new Date());
    if (!from) throw new Error('Η συνδρομή λήγει: δεν αλλάζει πακέτο.');
    const r = planChangeSet_(K, st, p, from, 'διαχειριστικό: ' + me.email);
    if (r === 'same') return 'Είναι ήδη ' + p.name + '.';
    if (r === 'cancelled') return 'Η αλλαγή ακυρώθηκε: μένει ' + p.name + '. Ο πελάτης πήρε email.';
    return p.name + ' από τον ' + monthLabel_(from) + ' (€' + euros_(planCents_(p)) + ' με ΦΠΑ). Ο πελάτης πήρε email.';
  }
  const from = planChangeFrom_({ months: {} }, new Date());
  const was = String(cfg.package || '');
  if (was === p.name) {
    let pc = null;
    try { pc = ghJson_('clients/' + K + '/package_change.json'); } catch (e) { pc = null; }
    if (!pc || pc.status !== 'scheduled') return 'Είναι ήδη ' + p.name + '.';
    planChangeRepo_(K, { plan: was, previous: was, from: pc.from, status: 'cancelled', cancelled: pc.plan, by: me.email });
    try { CacheService.getScriptCache().remove('adm:clients'); } catch (e) { /* μένει 5′ */ }
    return 'Η αλλαγή σε ' + pc.plan + ' ακυρώθηκε: μένει ' + p.name + '.';
  }
  const err = planChangeRepo_(K, { plan: p.name, previous: was, from: from, week: p.week, status: 'scheduled', by: me.email });
  if (err) throw new Error('Δεν γράφτηκε: ' + err.trim());
  try { CacheService.getScriptCache().remove('adm:clients'); } catch (e) { /* μένει 5′ */ }
  systemNotify_('Αλλαγή πακέτου: ' + K, admWho_(K, cfg) + ' (χωρίς συνδρομή): ' + (was || 'δικό του πρόγραμμα') + ' → ' + p.name + ' από τον ' +
    monthLabel_(from) + ' (διαχειριστικό: ' + me.email + '). Στην παραγωγή της 20ής: config.json (package, ημέρες posts/stories).');
  return p.name + ' (' + p.week + '+' + p.week + ' την εβδομάδα) από τον ' + monthLabel_(from) + ': με αυτό ετοιμάζεται το πρόγραμμα στις 20.';
}

function admClientFree_(token, client, until) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  until = String(until || '');
  if (until && (!/^\d{4}-\d{2}$/.test(until) || until < ym_(new Date()))) throw new Error('Άκυρος μήνας λήξης.');
  const c = admClientCfg_(client), K = c.K, cfg = c.cfg;
  if (admPaying_(billState_(K))) throw new Error('Ο πελάτης έχει ενεργή συνδρομή: πρώτα «Διακοπή συνδρομής».');
  cfg.billing = until ? { type: 'free', until: until } : { type: 'free' };
  admSaveCfg_(K, cfg, until ? 'δωρεάν έως ' + until : 'δωρεάν χωρίς λήξη', me);
  P_().deleteProperty('FREE_REMINDED_' + K);
  P_().deleteProperty('FREE_ENDED_' + K);
  systemNotify_('Δωρεάν: ' + admWho_(K, cfg), (until ? 'Δωρεάν έως και τον ' + monthLabel_(until) : 'Δωρεάν χωρίς λήξη') + ' (διαχειριστικό: ' + me.email + ').');
  return until ? 'Δωρεάν έως και τον ' + monthLabel_(until) + '. Στις ' + BILL_.FREE_REMIND_DAY + ' του μήνα έρχεται υπενθύμιση.' : 'Δωρεάν χωρίς λήξη.';
}

function admClientCharge_(token, client, plan, start) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const p = planOf_(plan);
  if (!p) throw new Error('Διάλεξε πακέτο.');
  start = String(start || '');
  if (!/^\d{4}-\d{2}$/.test(start) || start < ym_(new Date())) throw new Error('Άκυρος πρώτος μήνας.');
  const c = admClientCfg_(client), K = c.K, cfg = c.cfg, st = billState_(K);
  if (admPaying_(st) && !st.stop_after) throw new Error('Ο πελάτης έχει ήδη συνδρομή: για άλλο πακέτο, «Πακέτο».');
  if (!String(cprop_(K, 'NOTIFY_TO', '')).trim()) throw new Error('Ο πελάτης δεν έχει email (NOTIFY_TO_' + K + ').');
  const res = {};
  billingRequest_(K, { type: 'billing_start', plan: p.name, amount_eur: planCents_(p) / 100, start: start, code: cfg.code || '' }, res);
  cfg.billing = { type: 'paid', since: start };
  let note = '';
  try { admSaveCfg_(K, cfg, 'συνδρομή ' + p.name + ' από ' + start, me); } catch (e) { note = ' (config.json: ' + e.message + ')'; }
  if (String(cfg.package || '') !== p.name) planChangeRepo_(K, { plan: p.name, previous: String(cfg.package || ''), from: start, week: p.week, status: 'scheduled', by: me.email });
  systemNotify_('Χρέωση: ' + admWho_(K, cfg), 'Στάλθηκε σύνδεσμος πληρωμής (' + p.name + ', €' + euros_(planCents_(p)) + ' με ΦΠΑ) για τον ' + monthLabel_(start) +
    ' (διαχειριστικό: ' + me.email + '). Το πρόγραμμα του ' + monthLabel_(start) + ' ετοιμάζεται μόνο αφού φανεί «πληρώθηκε».' + note);
  return 'Στάλθηκε σύνδεσμος πληρωμής στο email του πελάτη: ' + p.name + ', €' + euros_(planCents_(p)) + ' με ΦΠΑ, για τον ' + monthLabel_(start) + '.' + note;
}

function admClientStop_(token, client) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const c = admClientCfg_(client), K = c.K, st = billState_(K);
  if (!admPaying_(st)) throw new Error('Δεν υπάρχει ενεργή συνδρομή.');
  if (st.stop_after) return 'Η συνδρομή σταματά ήδη μετά τον ' + monthLabel_(st.stop_after) + '.';
  const after = stopAfterFor_(st, new Date());
  billingStop_(K, st, after, false, 'διαχειριστικό: ' + me.email);
  systemNotify_('Διακοπή συνδρομής: ' + K, admWho_(K, c.cfg) + ': διακοπή από το διαχειριστικό (' + me.email + '). Τελευταίος μήνας: ' + monthLabel_(after) + '.');
  return 'Η συνδρομή σταματά μετά τον ' + monthLabel_(after) + '. Ο πελάτης πήρε email.';
}
