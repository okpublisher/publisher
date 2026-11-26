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
 * Αναθέσεις σε πωλητή: ADMIN_ASSIGN (JSON { "lead:<email>" | "setup:<κωδικός>" | "client:<K>": email | "-" (κανείς) }).
 * Πωλητές (από 26/11/2026): κάθε πωλητής έχει κωδικό (ref, 5 χαρακτήρες) → σύνδεσμος okpublisher.gr/?p=<ref> (και
 *   setup.html?p=<ref>). Η σελίδα του site στέλνει τον κωδικό κρυφά με τη φόρμα (στήλη «Σύσταση»· κανένα πεδίο, κανένα cookie).
 *   Πωλητής κάθε επαφής / σεταρίσματος / πελάτη: η ανάθεση του διαχειριστή, αλλιώς ο ΠΡΩΤΟΣ σύνδεσμος πωλητή που ήρθε με το
 *   ίδιο email, ΑΦΜ ή κωδικό πελάτη (για πάντα· δεύτερος πωλητής δεν τον παίρνει) — admOwners_. Ο πωλητής βλέπει μόνο τους
 *   δικούς του, παίρνει email για κάθε νέο από τον σύνδεσμό του (κύκλος πληρωμών, admRefNotify_) και βλέπει τις προμήθειές
 *   του: ποσοστό (pcts, ιστορικό ανά μήνα) στο καθαρό ποσό (χωρίς ΦΠΑ) κάθε πληρωμένου μήνα των πελατών του.
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
 *     Απλήρωτος σύνδεσμος πληρωμής (π.χ. «Χρέωση» κατά λάθος) → ακυρώνεται: καμία υπενθύμιση/παύση, email στον πελάτη.
 *   - Χρέωση (πακέτο + πρώτος μήνας) → billing_start: σύνδεσμος πληρωμής στο email του πελάτη· config.json billing { type: paid }.
 *   - Διακοπή συνδρομής → όπως το κουμπί του πελάτη (όροι Α.8), με email στον πελάτη.
 *   - Έγκριση: «με email» (κανονικά) ή «χωρίς έγκριση» → config.json approval: "none" (η παραγωγή βάζει το πρόγραμμα
 *     κατευθείαν στην ουρά και στέλνει μόνο ενημερωτικό email· βλ. RUNBOOK §2.13). Για το okpublisher και δικά μας projects.
 *   Το config.json γράφεται με το GITHUB_TOKEN (μόνο τα πεδία billing)· κάθε ενέργεια → email στο okpublisher.
 */
const ADM_ = {
  SESSION_DAYS: 30,
  LOGIN_TTL_S: 900,
  MAX_SESSIONS: 40,
  CLIENTS_CACHE_S: 300,
  CLIENTS_KEY: 'adm:clients:2',   // αλλάζει όταν αλλάζουν τα πεδία, για να μη μείνει παλιό cache μετά το ανέβασμα
  LEADS_CACHE_S: 60,
  LEADS_KEY: 'adm:leads:3',
  REF_URL: 'https://okpublisher.gr/',
  REF_RE: /^[a-z0-9]{5}$/,
  REF_ABC: 'abcdefghjkmnpqrstuvwxyz23456789',   // χωρίς i, l, o, 0, 1 (μπερδεύονται)
  PCT_MAX: 50,
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
    if (em && ADM_.ROLES.indexOf(x.role) >= 0) u[em] = { role: x.role, name: String(x.name || '').slice(0, 80),
      ref: ADM_.REF_RE.test(String(x.ref || '')) ? String(x.ref) : '',
      pcts: (Array.isArray(x.pcts) ? x.pcts : []).filter(function (p) { return p && /^\d{4}-\d{2}$/.test(p.from) && p.pct >= 0 && p.pct <= ADM_.PCT_MAX; }).slice(-24) };
  });
  const o = admOwner_();
  if (o) u[o] = { role: 'admin', name: 'okpublisher', owner: true, ref: '', pcts: [] };
  return u;
}

function admSaveUsers_(u) {
  const c = {};
  Object.keys(u).forEach(function (e) {
    if (!u[e].owner) c[e] = { role: u[e].role, name: u[e].name || '', ref: u[e].ref || '', pcts: u[e].pcts || [] };
  });
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
function admSaveUser_(token, email, name, role, pct) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const e = admEmail_(email);
  if (!e) throw new Error('Μη έγκυρο email.');
  if (ADM_.ROLES.indexOf(role) < 0) throw new Error('Άγνωστος ρόλος.');
  const u = admUsers_();
  if (u[e] && u[e].owner) throw new Error('Ο λογαριασμός του okpublisher είναι πάντα διαχειριστής.');
  if (e === me.email && role !== 'admin') throw new Error('Δεν μπορείτε να αφαιρέσετε από τον εαυτό σας τον ρόλο του διαχειριστή.');
  const isNew = !u[e], old = u[e] || {};
  u[e] = { role: role, name: String(name || '').trim().slice(0, 80), ref: old.ref || '', pcts: old.pcts || [] };
  if (role === 'sales' && !u[e].ref) u[e].ref = admNewRef_(u);
  if (pct !== undefined && pct !== null && String(pct).trim() !== '') {
    const n = Number(String(pct).replace(',', '.'));
    if (!(n >= 0 && n <= ADM_.PCT_MAX)) throw new Error('Η προμήθεια είναι ποσοστό από 0 έως ' + ADM_.PCT_MAX + '.');
    if (admPct_(u[e].pcts, '9999-12') !== n || !u[e].pcts.length) {
      // Το πρώτο ποσοστό ισχύει για όλους τους μήνες· κάθε αλλαγή από τον τρέχοντα μήνα (οι παλιοί μήνες μένουν ως ήταν).
      const from = u[e].pcts.length ? ym_(new Date()) : '0000-01';
      u[e].pcts = u[e].pcts.filter(function (p) { return p.from !== from; }).concat([{ from: from, pct: Math.round(n * 100) / 100 }]);
    }
  }
  admSaveUsers_(u);
  if (isNew) {
    const ref = u[e].ref;
    try {
      MailApp.sendEmail({ to: e, name: CFG.SENDER_NAME, subject: 'Πρόσβαση στο διαχειριστικό okpublisher',
        body: 'Σας δόθηκε πρόσβαση στο διαχειριστικό του okpublisher (' + ADM_.ROLE_NAMES[role] + ').\n\n' + ADM_.SITE +
          '\n\nΓράψτε το email σας και θα σας έρθει κωδικός. Δεν χρειάζεται κωδικός πρόσβασης.' +
          (ref ? '\n\nΟ προσωπικός σας σύνδεσμος για πελάτες: ' + admLink_(ref) + '\nΌποιος συμπληρώσει τη φόρμα από αυτόν ' +
            'τον σύνδεσμο είναι δικός σας. Τον βρίσκετε πάντα στο διαχειριστικό, με QR.' : '') });
    } catch (x) { console.log('email νέου χρήστη: ' + x.message); }
  }
  return 'ok';
}
function admLink_(ref, page) { return ref ? ADM_.REF_URL + (page || '') + '?p=' + ref : ''; }
function admNewRef_(u) {
  const used = {};
  Object.keys(u).forEach(function (e) { if (u[e].ref) used[u[e].ref] = 1; });
  for (let i = 0; i < 50; i++) {
    let r = '';
    for (let j = 0; j < 5; j++) r += ADM_.REF_ABC.charAt(Math.floor(Math.random() * ADM_.REF_ABC.length));
    if (!used[r]) return r;
  }
  throw new Error('Δεν βγήκε κωδικός πωλητή· ξαναδοκιμάστε.');
}
// Ποσοστό προμήθειας για τον μήνα ym: το τελευταίο που ίσχυε τότε.
function admPct_(pcts, ym) {
  let v = 0;
  (pcts || []).slice().sort(function (a, b) { return a.from < b.from ? -1 : 1; }).forEach(function (p) { if (p.from <= ym) v = Number(p.pct) || 0; });
  return v;
}
// Πωλητές χωρίς κωδικό (από πριν): παίρνουν τώρα.
function admEnsureRefs_(u) {
  let ch = false;
  Object.keys(u).forEach(function (e) { if (u[e].role === 'sales' && !u[e].ref) { u[e].ref = admNewRef_(u); ch = true; } });
  if (ch) admSaveUsers_(u);
  return u;
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
  if (email === '-') a[key] = '-';                         // ρητά κανείς (ακόμα κι αν ήρθε από σύνδεσμο)
  else if (!e) delete a[key];                              // αυτόματα (από τον σύνδεσμο, αν υπάρχει)
  else if (!admUsers_()[e]) throw new Error('Ο χρήστης δεν υπάρχει.');
  else a[key] = e;
  P_().setProperty('ADMIN_ASSIGN', JSON.stringify(a));
  return 'ok';
}

// ------------------------------------------------------------------ δεδομένα
function admData_(token) {
  const me = admSession_(token), admin = me.role === 'admin';
  const assign = admJson_('ADMIN_ASSIGN');
  const users = admEnsureRefs_(admUsers_());
  const mu = users[me.email] || {};
  const out = { me: { email: me.email, name: me.name, role: me.role, owner: me.owner }, now: new Date().toISOString(), errors: [] };
  if (mu.ref) {
    out.me.ref = mu.ref; out.me.link = admLink_(mu.ref); out.me.setup_link = admLink_(mu.ref, 'setup.html');
    out.me.pct = admPct_(mu.pcts, ym_(new Date()));
  }

  let L = { leads: [], setups: [] };
  try { L = admLeads_(); } catch (e) { out.errors.push('Επαφές / σεταρίσματα: ' + e.message); }
  const own = admOwners_(L, users);
  // Πωλητής: ανάθεση διαχειριστή («-» = κανείς), αλλιώς ο πρώτος σύνδεσμος πωλητή. src = από πού (για τη γραμμή «Πηγή»).
  const nm = function (e) { return e ? ((users[e] && users[e].name) || e) : ''; };
  const who = function (key, auto) {
    const m = assign[key], src = { how: 'none', link: auto ? nm(auto.seller) : '', link_at: auto ? auto.at : '' };
    let seller = '';
    if (m === '-') src.how = 'manual';
    else if (m) { seller = m; src.how = 'manual'; }
    else if (auto) { seller = auto.seller; src.how = 'link'; }
    src.name = nm(seller);
    return { seller: seller, src: src };
  };
  const take = function (o, key, auto) {
    const w = who(key, auto);
    o.seller = w.seller; o.src = w.src; delete o.ref;
    return admin || w.seller === me.email;
  };

  let clients = [];
  try { clients = admClients_(); } catch (e) { out.errors.push('Πελάτες: ' + e.message); }
  out.clients = clients.filter(function (c) { return take(c, 'client:' + c.key, c.code ? own['c:' + c.code] : null); })
    .map(function (c) { if (!admin) delete c.note; return c; });
  const keys = out.clients.map(function (c) { return c.key; });
  const seen = function (K) { return admin || keys.indexOf(String(K)) >= 0; };

  out.leads = L.leads.filter(function (l) { const a = l.auto; delete l.auto; return take(l, 'lead:' + l.email, a); });
  const scan = siteScanState_();   // χρώματα / γραμματοσειρές από την ιστοσελίδα (Site.gs)
  out.setups = L.setups.filter(function (s) { const a = s.auto; delete s.auto; return take(s, s.code ? 'setup:' + s.code : 'lead:' + s.email, a); })
    .map(function (s) {
      if (!admin) delete s.afm;
      const x = s.code && scan[s.code];
      if (x && x.url === siteNorm_(s.website)) s.site = { ok: !!x.ok, at: x.at, colors: x.colors || [], fonts: x.fonts || [], err: x.err || '', tries: x.tries || 0 };
      return s;
    });

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

  try { out.commissions = admCommissions_(out.clients, users); } catch (e) { out.commissions = []; out.errors.push('Προμήθειες: ' + e.message); }

  if (admin) {
    try {
      out.payments = admSheet_(BILL_.SHEET).slice(1).slice(-ADM_.ROWS).reverse().map(function (r) {
        return { at: admIso_(r[0]), client: String(r[1] || ''), month: String(r[2] || ''), amount: r[3] === '' ? '' : Number(r[3]),
          action: String(r[4] || ''), result: String(r[5] || ''), pay: String(r[7] || ''), code: String(r[8] || ''), name: String(r[9] || ''),
          plan: String(r[10] || '') };
      });
    } catch (e) { out.payments = []; out.errors.push('Πληρωμές: ' + e.message); }
    const ym = ym_(new Date());
    out.users = Object.keys(users).sort().map(function (e) {
      const u = users[e];
      return { email: e, name: u.name || '', role: u.role, owner: !!u.owner, ref: u.ref || '', link: admLink_(u.ref), pct: admPct_(u.pcts, ym), has_pct: !!(u.pcts && u.pcts.length) };
    });
  }
  out.sellers = admin ? out.users.filter(function (x) { return !x.owner; }).map(function (x) { return { email: x.email, name: x.name }; }) : [];
  return out;
}

// Ποιος πωλητής έφερε τον καθένα: ο ΠΡΩΤΟΣ σύνδεσμος πωλητή (?p=) ανάμεσα σε επαφές και σεταρίσματα με το ίδιο email,
// ΑΦΜ ή κωδικό πελάτη, με σειρά χρόνου (για πάντα). Γράφει o.auto = { seller, at } σε κάθε γραμμή· επιστρέφει { κλειδί: … }
// (e:<email>, a:<ΑΦΜ>, c:<OK-…>) για τους πελάτες.
function admOwners_(L, users) {
  const byRef = {}, own = {}, rows = [];
  Object.keys(users).forEach(function (e) { if (users[e].role === 'sales' && users[e].ref) byRef[users[e].ref] = e; });
  (L.leads || []).forEach(function (l) { rows.push({ o: l, t: admTime_(l.at), k: 0, keys: l.email ? ['e:' + l.email] : [] }); });
  (L.setups || []).forEach(function (s) {
    const afm = String(s.afm || '').replace(/[^\d]/g, '');
    rows.push({ o: s, t: admTime_(s.at), k: 1, keys: [s.email ? 'e:' + s.email : '', afm ? 'a:' + afm : '', s.code ? 'c:' + s.code : ''].filter(String) });
  });
  rows.sort(function (x, y) { return (x.t - y.t) || (x.k - y.k); });
  rows.forEach(function (r) {
    let hit = null;
    r.keys.forEach(function (k) { if (!hit && own[k]) hit = own[k]; });
    if (!hit && r.o.ref && byRef[r.o.ref]) hit = { seller: byRef[r.o.ref], at: r.o.at };
    if (hit) r.keys.forEach(function (k) { if (!own[k]) own[k] = hit; });
    r.o.auto = hit;
  });
  return own;
}

// Χρόνος γραμμής του Sheet («26/11/2026 2:48:33 μ.μ.» ή ISO) → αριθμός για σύγκριση (0 = άγνωστος).
function admTime_(s) {
  s = String(s || '').trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(π\.?\s*μ\.?|μ\.?\s*μ\.?|am|pm)?)?/i.exec(s);
  if (m) {
    let h = +(m[4] || 0);
    const ap = String(m[7] || '').replace(/[\s.]/g, '').toLowerCase();
    if ((ap === 'μμ' || ap === 'pm') && h < 12) h += 12;
    if ((ap === 'πμ' || ap === 'am') && h === 12) h = 0;
    return Date.UTC(+m[3], +m[2] - 1, +m[1], h, +(m[5] || 0), +(m[6] || 0));
  }
  const d = new Date(s);
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

// Προμήθειες: για κάθε πληρωμένο μήνα πελάτη με πωλητή, ποσοστό του πωλητή (όπως ίσχυε τον μήνα εκείνο) στο καθαρό ποσό.
function admCommissions_(clients, users) {
  const out = [];
  clients.forEach(function (c) {
    const u = c.seller && users[c.seller];
    if (!u) return;
    const st = billState_(c.key);
    if (!st || !st.months) return;
    Object.keys(st.months).sort().forEach(function (m) {
      const r = st.months[m] || {}, cents = r.amount || st.amount || 0;
      if (r.st !== 'paid' || !cents) return;
      const net = Math.round(cents / (1 + BILL_.VAT)) / 100, pct = admPct_(u.pcts, m);
      out.push({ seller: c.seller, seller_name: u.name || c.seller, client: c.key, client_name: c.name, code: c.code || '', month: m,
        pay: String(r.pay || ''), net: net, pct: pct, amount: Math.round(net * pct) / 100 });
    });
  });
  return out.sort(function (a, b) { return a.month < b.month ? 1 : a.month > b.month ? -1 : (a.client < b.client ? -1 : 1); });
}

// Κάθε ώρα (κύκλος πληρωμών): email στον πωλητή για κάθε νέα επαφή / νέο σετάρισμα που είναι δικό του (σύνδεσμος ή ανάθεση).
// Χωρίς στοιχεία επικοινωνίας στο email (τα βλέπει στο διαχειριστικό). Την πρώτη φορά απλώς σημειώνει πού έμεινε.
function admRefNotify_() {
  const users = admUsers_();
  if (!Object.keys(users).some(function (e) { return users[e].role === 'sales' && users[e].ref; })) return 0;
  const L = admLeads_(), assign = admJson_('ADMIN_ASSIGN');
  admOwners_(L, users);
  const last = Number(prop_('ADMIN_REF_TS', '0')) || 0;
  const rows = L.leads.map(function (l) { return { o: l, key: 'lead:' + l.email, what: 'Νέα επαφή' }; })
    .concat(L.setups.map(function (s) { return { o: s, key: s.code ? 'setup:' + s.code : 'lead:' + s.email, what: 'Νέο σετάρισμα' }; }));
  let max = last, n = 0;
  rows.forEach(function (r) {
    const t = admTime_(r.o.at);
    if (t > max) max = t;
    if (!last || t <= last) return;
    const m = assign[r.key], seller = m === '-' ? '' : (m || (r.o.auto && r.o.auto.seller) || '');
    if (!seller || !users[seller] || users[seller].role !== 'sales') return;
    try {
      MailApp.sendEmail({ to: seller, name: CFG.SENDER_NAME, subject: r.what + ' από τον σύνδεσμό σου: ' + r.o.business + (r.o.code ? ' (' + r.o.code + ')' : ''),
        body: r.what + ' για εσένα: «' + r.o.business + '»' + (r.o.plan ? ', πακέτο ' + r.o.plan : '') + '.\n\nΤα στοιχεία είναι στο διαχειριστικό: ' +
          ADM_.SITE + '\n\n— okpublisher' });
      n++;
    } catch (e) { console.log('email πωλητή: ' + e.message); }
  });
  if (max !== last) P_().setProperty('ADMIN_REF_TS', String(max));
  return n;
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
  try { gh = JSON.parse(cache.get(ADM_.CLIENTS_KEY) || 'null'); } catch (e) { gh = null; }
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
        no_approval: !!(cfg && cfg.approval === 'none'),
        days: cfg ? { posts: admDays_(cfg.post_days), stories: admDays_(cfg.story_days), post_time: cfg.times === 'auto' ? '' : String(cfg.post_time || ''),
          story_time: cfg.times === 'auto' ? '' : String(cfg.story_time || ''), auto: cfg.times === 'auto' } : null,
      };
    });
    try { cache.put(ADM_.CLIENTS_KEY, JSON.stringify(gh), ADM_.CLIENTS_CACHE_S); } catch (e) { /* πολύ μεγάλο: χωρίς cache */ }
  }
  return Object.keys(gh).sort().map(function (K) {
    const g = gh[K], nm = clientName_(K);
    return { key: K, code: g.code, name: nm !== K ? nm : (g.name || K), package: g.package, group: g.group, note: g.note,
      accounts: g.accounts, approval: g.approval, active: g.active, free: g.free || null, pkg_change: g.pkg_change || null,
      has_config: g.has_config !== false, has_email: !!String(cprop_(K, 'NOTIFY_TO', '')).trim(), no_approval: !!g.no_approval, days: g.days || null,
      live: live.indexOf(K) >= 0, test: live.indexOf(K) < 0 && all.indexOf(K) >= 0,
      paused: cprop_(K, 'PAUSED', 'false') === 'true', billing_paused: billPaused_(K), billing: admBilling_(K) };
  });
}

function admDays_(a) { return Array.isArray(a) ? a.map(String).slice(0, 7) : []; }

// Σύνοψη πληρωμών ενός πελάτη (χωρίς κωδικούς Viva). Από 26/11/2026 με «μέρα» πελάτη (περίοδοι) και το «Συνεχίζουμε;».
function admBilling_(K) {
  const st = billState_(K);
  if (!st) return null;
  const now = new Date();
  if (st.offer) {
    return { plan: String(st.plan || ''), amount_eur: st.amount ? st.amount / 100 : 0, start: '', stop_after: '', card: false, months: [], next: '',
      next_date: '', change: null, unpaid: [], unpaid_labels: [], day: 0,
      offer: { kind: st.offer.kind || 'trial', trial_start: st.offer.trial_start, chosen: st.offer.chosen || '', day: offerDay_(st, now), until: addDays_(st.offer.trial_start, OFFER_.LAST_DAY - 1),
        closed: st.offer.closed || '', cancelled: !!st.offer.cancelled } };
  }
  if (!st.start) return null;
  const cur = periodOf_(st, now), months = st.months || {};
  const list = Object.keys(months).sort().slice(-6).map(function (m) { return { month: m, label: perShort_(st, m), st: String(months[m].st || ''), pay: String(months[m].pay || '') }; });
  let next = st.start && st.start > cur ? st.start : cur;         // η πρώτη περίοδος από σήμερα που δεν έχει πληρωθεί
  for (let i = 0; i < 24 && months[next] && months[next].st === 'paid'; i++) next = nextYm_(next);
  if (st.stop_after && next > st.stop_after) next = '';
  const unpaid = Object.keys(months).filter(function (m) { return m <= cur && months[m].st !== 'paid' && months[m].st !== 'cancelled'; }).sort();
  return { plan: String(st.plan || ''), amount_eur: st.amount ? st.amount / 100 : 0, start: st.start || '', stop_after: st.stop_after || '',
    card: !!st.tx, months: list, next: next, next_date: next ? perStart_(st, next) : '', day: billDay_(st),
    change: st.change ? { plan: String(st.change.plan), from: String(st.change.from), from_label: perShort_(st, st.change.from) } : null,
    stop_label: st.stop_after ? perShort_(st, st.stop_after) : '',
    unpaid: unpaid, unpaid_labels: unpaid.map(function (m) { return perShort_(st, m); }) };
}

// Επαφές και σεταρίσματα από το Sheet της φόρμας (CSV με το token του script). Cache 1′.
function admLeads_() {
  const cache = CacheService.getScriptCache();
  try { const hit = cache.get(ADM_.LEADS_KEY); if (hit) return JSON.parse(hit); } catch (e) { /* ξανά */ }
  const cfg = admConfig_();
  const v = function (r, k) { return String(r[k] == null ? '' : r[k]).trim(); };
  const res = {
    leads: admCsv_(cfg.leads_sheet, cfg.leads_gid).map(function (r) {
      return { at: v(r, 'Χρόνος'), name: v(r, 'Όνομα'), business: v(r, 'Επιχείρηση'), email: v(r, 'Email').toLowerCase(), phone: v(r, 'Τηλέφωνο'),
        plan: v(r, 'Πακέτο'), social: v(r, 'Instagram/Facebook'), message: v(r, 'Μήνυμα').slice(0, 1500), lang: v(r, 'Γλώσσα'),
        status: v(r, 'Κατάσταση'), source: v(r, 'Πηγή'), news: v(r, 'Νέα'), ref: v(r, 'Σύσταση').toLowerCase() };
    }).reverse(),
    setups: admCsv_(cfg.leads_sheet, cfg.setups_gid).map(function (r) {
      return { at: v(r, 'Χρόνος'), code: v(r, 'Κωδικός πελάτη'), business: v(r, 'Επιχείρηση'), name: v(r, 'Υπεύθυνος'),
        email: v(r, 'Email εγκρίσεων').toLowerCase(), plan: v(r, 'Πακέτο'), phones: v(r, 'Τηλέφωνα (posts)'), facebook: v(r, 'Facebook'),
        instagram: v(r, 'Instagram'), address: v(r, 'Διεύθυνση/περιοχή'), about: v(r, 'Τι κάνει').slice(0, 1500), times: v(r, 'Ώρες'),
        reels: v(r, 'Έτοιμα reels'), music: v(r, 'Μουσική στα reels'), status: v(r, 'Κατάσταση'), terms: v(r, 'Όροι (έκδοση)'),
        bill_name: v(r, 'Επωνυμία τιμολόγησης'), afm: v(r, 'ΑΦΜ'), bill_check: v(r, 'Έλεγχος τιμολόγησης'), trial: v(r, 'Δωρεάν εβδομάδα'),
        ref: v(r, 'Σύσταση').toLowerCase(), website: v(r, 'Ιστοσελίδα') };
    }).reverse(),
  };
  try { cache.put(ADM_.LEADS_KEY, JSON.stringify(res), ADM_.LEADS_CACHE_S); } catch (e) { /* πολύ μεγάλο: χωρίς cache */ }
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
      case 'save_user': admSaveUser_(t, p.email, p.name, p.role, p.pct); return out({ ok: true });
      case 'delete_user': admDeleteUser_(t, p.email); return out({ ok: true });
      case 'assign': admAssign_(t, p.key, p.email); return out({ ok: true });
      case 'client_plan': return out({ ok: true, message: admClientPlan_(t, p.client, p.plan) });
      case 'client_free': return out({ ok: true, message: admClientFree_(t, p.client, p.until) });
      case 'client_charge': return out({ ok: true, message: admClientCharge_(t, p.client, p.plan) });
      case 'client_stop': return out({ ok: true, message: admClientStop_(t, p.client) });
      case 'client_approval': return out({ ok: true, message: admClientApproval_(t, p.client, p.mode) });
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
  try { CacheService.getScriptCache().remove(ADM_.CLIENTS_KEY); } catch (e) { /* μένει 5′ */ }
}
function admWho_(K, cfg) { return (cfg.code ? cfg.code + ' · ' : '') + (cfg.name || clientName_(K)) + ' (' + K + ')'; }
// Ενεργή συνδρομή: πληρωμένη κάρτα και όχι λήξη στο παρελθόν.
function admPaying_(st) { return !!(st && st.tx && st.start && !st.offer && !(st.stop_after && st.stop_after < periodOf_(st, new Date()))); }

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
    return p.name + ' από ' + perFor_(st, from) + ' (€' + euros_(planCents_(p)) + ' με ΦΠΑ). Ο πελάτης πήρε email.';
  }
  const from = planChangeFrom_({ months: {} }, new Date());
  const was = String(cfg.package || '');
  if (was === p.name) {
    let pc = null;
    try { pc = ghJson_('clients/' + K + '/package_change.json'); } catch (e) { pc = null; }
    if (!pc || pc.status !== 'scheduled') return 'Είναι ήδη ' + p.name + '.';
    planChangeRepo_(K, { plan: was, previous: was, from: pc.from, status: 'cancelled', cancelled: pc.plan, by: me.email });
    try { CacheService.getScriptCache().remove(ADM_.CLIENTS_KEY); } catch (e) { /* μένει 5′ */ }
    return 'Η αλλαγή σε ' + pc.plan + ' ακυρώθηκε: μένει ' + p.name + '.';
  }
  const err = planChangeRepo_(K, { plan: p.name, previous: was, from: from, week: p.week, status: 'scheduled', by: me.email });
  if (err) throw new Error('Δεν γράφτηκε: ' + err.trim());
  try { CacheService.getScriptCache().remove(ADM_.CLIENTS_KEY); } catch (e) { /* μένει 5′ */ }
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
  const cancelled = billingCancelUnpaid_(K, 'διαχειριστικό: ' + me.email);
  const extra = cancelled[0] === 'offer' ? ' Έκλεισαν οι σύνδεσμοι πληρωμής μετά τη δωρεάν εβδομάδα.'
    : cancelled.length ? ' Ακυρώθηκε ο απλήρωτος σύνδεσμος για τον ' + cancelled.map(monthLabel_).join(', ') + ' (ο πελάτης πήρε email).' : '';
  systemNotify_('Δωρεάν: ' + admWho_(K, cfg), (until ? 'Δωρεάν έως και τον ' + monthLabel_(until) : 'Δωρεάν χωρίς λήξη') + ' (διαχειριστικό: ' + me.email + ').' + extra);
  return (until ? 'Δωρεάν έως και τον ' + monthLabel_(until) + '. Στις ' + BILL_.FREE_REMIND_DAY + ' του μήνα έρχεται υπενθύμιση.' : 'Δωρεάν χωρίς λήξη.') + extra;
}

// «Χρέωση»: email στον πελάτη με σύνδεσμο πληρωμής (υπενθυμίσεις 4η/8η μέρα, λήγει μετά τη 14η). Η συνδρομή ξεκινά τη μέρα
// που θα πληρώσει: εκείνη γίνεται «η μέρα του» (χρέωση κάθε μήνα), η 1η περίοδος παράγεται αμέσως (Billing.gs, offer).
// Το config γίνεται «paid» με την πληρωμή (ως τότε, αν ήταν δωρεάν, μένει δωρεάν).
function admClientCharge_(token, client, plan) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const p = planOf_(plan);
  if (!p) throw new Error('Διάλεξε πακέτο.');
  const c = admClientCfg_(client), K = c.K, cfg = c.cfg, st = billState_(K);
  if (admPaying_(st) && !st.stop_after) throw new Error('Ο πελάτης έχει ήδη συνδρομή: για άλλο πακέτο, «Πακέτο».');
  if (!String(cprop_(K, 'NOTIFY_TO', '')).trim()) throw new Error('Ο πελάτης δεν έχει email (NOTIFY_TO_' + K + ').');
  const res = {};
  billingRequest_(K, { type: 'billing_start', open: true, plan: p.name, code: cfg.code || '' }, res);
  const free = cfg.billing && cfg.billing.type === 'free'
    ? ' Είναι δωρεάν' + (cfg.billing.until ? ' έως ' + monthLabel_(cfg.billing.until) : '') + ': με την πληρωμή τα δωρεάν σταματούν και ξεκινά η συνδρομή.' : '';
  const until = dm_(addDays_(athens_(new Date(), 'yyyy-MM-dd'), OFFER_.LAST_DAY - 1), true);
  systemNotify_('Χρέωση: ' + admWho_(K, cfg), 'Στάλθηκε σύνδεσμος πληρωμής (' + p.name + ', €' + euros_(planCents_(p)) + ' με ΦΠΑ, διαχειριστικό: ' + me.email +
    '). Η συνδρομή ξεκινά τη μέρα της πληρωμής (χρέωση κάθε μήνα εκείνη τη μέρα) και η παραγωγή της 1ης περιόδου γίνεται αμέσως. ' +
    'Υπενθυμίσεις την 4η και την 8η μέρα· ο σύνδεσμος λήγει ' + until + '.' + free);
  return 'Στάλθηκε email με σύνδεσμο πληρωμής: ' + p.name + ', €' + euros_(planCents_(p)) + ' με ΦΠΑ. Ξεκινά τη μέρα που θα πληρώσει ' +
    '(εκείνη γίνεται η μέρα χρέωσης κάθε μήνα) και τότε γίνεται αμέσως η παραγωγή. Υπενθυμίσεις 4η και 8η μέρα, λήγει ' + until + '.' + free;
}

function admClientStop_(token, client) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  const c = admClientCfg_(client), K = c.K, st = billState_(K);
  if (!admPaying_(st)) throw new Error('Δεν υπάρχει ενεργή συνδρομή.');
  if (st.stop_after) return 'Η συνδρομή σταματά ήδη μετά ' + perFor_(st, st.stop_after) + '.';
  const after = stopAfterFor_(st, new Date());
  billingStop_(K, st, after, false, 'διαχειριστικό: ' + me.email);
  systemNotify_('Διακοπή συνδρομής: ' + K, admWho_(K, c.cfg) + ': διακοπή από το διαχειριστικό (' + me.email + '). Τελευταία περίοδος: ' + perShort_(st, after) + '.');
  return 'Η συνδρομή σταματά μετά ' + perFor_(st, after) + '. Ο πελάτης πήρε email.';
}

// Έγκριση: 'email' (κανονικά, ΟΚ στο email του μήνα) ή 'none' (χωρίς έγκριση· μόνο ενημερωτικό email). Ισχύει από την επόμενη παραγωγή.
function admClientApproval_(token, client, mode) {
  const me = admSession_(token);
  admNeedAdmin_(me);
  if (mode !== 'none' && mode !== 'email') throw new Error('Διάλεξε «με email» ή «χωρίς έγκριση».');
  const c = admClientCfg_(client), K = c.K, cfg = c.cfg;
  if ((cfg.approval === 'none') === (mode === 'none')) return mode === 'none' ? 'Είναι ήδη χωρίς έγκριση.' : 'Έχει ήδη έγκριση με email.';
  if (mode === 'none') cfg.approval = 'none'; else delete cfg.approval;
  admSaveCfg_(K, cfg, mode === 'none' ? 'χωρίς έγκριση' : 'έγκριση με email', me);
  systemNotify_('Έγκριση: ' + admWho_(K, cfg), (mode === 'none' ? 'Χωρίς έγκριση: το πρόγραμμα μπαίνει κατευθείαν στην ουρά, με ενημερωτικό email.'
    : 'Με έγκριση: το πρόγραμμα περιμένει «ΟΚ» στο email του μήνα.') + ' Από την επόμενη παραγωγή (διαχειριστικό: ' + me.email + ').');
  return (mode === 'none' ? 'Χωρίς έγκριση: το πρόγραμμα μπαίνει κατευθείαν στην ουρά και έρχεται μόνο ενημερωτικό email.'
    : 'Με έγκριση: το πρόγραμμα περιμένει «ΟΚ» στο email του μήνα.') + ' Από την επόμενη παραγωγή.';
}
