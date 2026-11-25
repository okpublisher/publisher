/**
 * Πληρωμές συνδρομής μέσω Viva (okpublisher, ξεχωριστό αρχείο στο ίδιο project).
 *
 * Ροή (όροι Α.7):
 *   1. Ο πελάτης λέει «ναι» μετά τον δωρεάν μήνα → ο Claude γράφει αίτημα billing_start στο outbox του πελάτη.
 *      Το Apps Script φτιάχνει παραγγελία πληρωμής στη Viva (με αποθήκευση κάρτας για μηνιαία χρέωση) και στέλνει
 *      τον σύνδεσμο ΜΟΝΟ στο NOTIFY_TO_<K>.
 *   2. Μόλις πληρώσει, κρατάμε το ID της πρώτης συναλλαγής (όχι στοιχεία κάρτας: αυτά μένουν στη Viva).
 *   3. Κάθε 1η του μήνα (από τις 09:00) χρεώνεται αυτόματα το ποσό του πακέτου.
 *   4. Αν η χρέωση δεν περάσει: email με νέο σύνδεσμο · στις 8 υπενθύμιση · στις 16 παύση των δημοσιεύσεων
 *      (BILLING_PAUSED_<K>) · μόλις πληρώσει, οι δημοσιεύσεις ξαναρχίζουν μόνες τους.
 *   5. Λύση: ο Claude γράφει billing_stop { after: "2027-05" } → καμία χρέωση για μήνες μετά.
 *   Ποτέ δεύτερη χρέωση για τον ίδιο μήνα: αν μια χρέωση κοπεί στη μέση, δεν ξαναδοκιμάζεται (email στο okpublisher).
 *
 * Αιτήματα (clients/<K>/outbox/*.json, βλ. Approval.gs):
 *   billing_start { plan: "Βασικό", amount_eur: 186, start: "2027-02" }  → order_code, link (email στον πελάτη)
 *   billing_stop  { after: "2027-05" }                                     → καμία χρέωση μετά τον Μάιο 2027
 *
 * Ρυθμίσεις (Script Properties, τα κλειδιά τα βάζει μόνο ο διαχειριστής):
 *   VIVA_ENV            demo (προεπιλογή) ή live
 *   VIVA_CLIENT_ID / VIVA_CLIENT_SECRET   Smart Checkout credentials (Settings → API Access)
 *   VIVA_MERCHANT_ID / VIVA_API_KEY       για τη μηνιαία χρέωση και τον έλεγχο πληρωμής
 *   VIVA_SOURCE_CODE    προαιρετικό: κωδικός πηγής online πληρωμών
 *   VIVA_LINK_SECONDS   προαιρετικό: πόσο ισχύει ένας σύνδεσμος (προεπιλογή 432000 = 5 ημέρες)
 *   Κατάσταση ανά πελάτη: BILLING_<K> (JSON, την γράφει μόνο αυτό το αρχείο), BILLING_PAUSED_<K>.
 * Συναρτήσεις: checkBilling() (έλεγχος, χωρίς χρεώσεις) · setupBilling() (κάθε ώρα) · billingCycle() ·
 *   demoChargeNow() (ΜΟΝΟ demo: μία μηνιαία χρέωση τώρα στον BILLING_TEST_CLIENT, για να δοκιμαστεί η αυτόματη χρέωση).
 */
const BILL_ = {
  TYPES: ['billing_start', 'billing_stop'],
  EVERY_H: 1,
  ACT_HOUR: 9,          // χρεώσεις / υπενθυμίσεις / παύση μόνο από τις 09:00 (ώρα Ελλάδας)
  REMIND_DAY: 8,
  PAUSE_DAY: 16,
  LINK_SECONDS: 432000, // 5 ημέρες
  LINK_REFRESH_DAYS: 4, // νέο σύνδεσμο σε κάθε email αν ο προηγούμενος είναι παλιότερος από τόσες ημέρες
  SHEET: 'Πληρωμές',
  HEAD: ['Χρόνος', 'Πελάτης', 'Μήνας', 'Ποσό €', 'Ενέργεια', 'Αποτέλεσμα', 'Κωδικός'],
  MONTHS: ['Ιανουάριο', 'Φεβρουάριο', 'Μάρτιο', 'Απρίλιο', 'Μάιο', 'Ιούνιο', 'Ιούλιο', 'Αύγουστο', 'Σεπτέμβριο', 'Οκτώβριο', 'Νοέμβριο', 'Δεκέμβριο'],
};

// ------------------------------------------------------------------ Viva
function vivaHosts_() {
  const live = String(prop_('VIVA_ENV', 'demo')).toLowerCase() === 'live';
  return live
    ? { accounts: 'https://accounts.vivapayments.com', api: 'https://api.vivapayments.com', web: 'https://www.vivapayments.com', live: true }
    : { accounts: 'https://demo-accounts.vivapayments.com', api: 'https://demo-api.vivapayments.com', web: 'https://demo.vivapayments.com', live: false };
}

function vivaNeed_(names) {
  const miss = names.filter(function (n) { return !String(prop_(n, '')).trim(); });
  if (miss.length) throw new Error('Λείπουν ρυθμίσεις Viva: ' + miss.join(', '));
}

function vivaJson_(r, what) {
  const code = r.getResponseCode();
  let body = {};
  try { body = JSON.parse(r.getContentText() || '{}'); } catch (e) { body = { raw: String(r.getContentText()).slice(0, 300) }; }
  if (code >= 300) throw new Error('Viva ' + what + ' ' + code + ': ' + JSON.stringify(body).slice(0, 300));
  return body;
}

let VIVA_TOKEN_ = null;
function vivaToken_() {
  if (VIVA_TOKEN_ && VIVA_TOKEN_.exp > Date.now()) return VIVA_TOKEN_.t;
  vivaNeed_(['VIVA_CLIENT_ID', 'VIVA_CLIENT_SECRET']);
  const basic = Utilities.base64Encode(prop_('VIVA_CLIENT_ID', '') + ':' + prop_('VIVA_CLIENT_SECRET', ''));
  const r = UrlFetchApp.fetch(vivaHosts_().accounts + '/connect/token', { method: 'post', muteHttpExceptions: true,
    contentType: 'application/x-www-form-urlencoded', payload: 'grant_type=client_credentials', headers: { Authorization: 'Basic ' + basic } });
  const j = vivaJson_(r, 'token');
  if (!j.access_token) throw new Error('Viva token: χωρίς access_token');
  VIVA_TOKEN_ = { t: j.access_token, exp: Date.now() + Math.max(60, Number(j.expires_in || 3600) - 120) * 1000 };
  return VIVA_TOKEN_.t;
}

function vivaBasic_() {
  vivaNeed_(['VIVA_MERCHANT_ID', 'VIVA_API_KEY']);
  return 'Basic ' + Utilities.base64Encode(prop_('VIVA_MERCHANT_ID', '') + ':' + prop_('VIVA_API_KEY', ''));
}

// Νέα παραγγελία πληρωμής (Smart Checkout) με αποθήκευση κάρτας για τη μηνιαία χρέωση.
function vivaCreateOrder_(K, st, month) {
  const to = String(cprop_(K, 'NOTIFY_TO', '')).split(',')[0].trim();
  const body = {
    amount: st.amount, allowRecurring: true,
    paymentTimeout: Number(prop_('VIVA_LINK_SECONDS', BILL_.LINK_SECONDS)),
    customerTrns: 'okpublisher · ' + st.plan + ' · ' + monthLabel_(month),
    merchantTrns: 'okp ' + K + ' ' + month,
    customer: { email: to, fullName: clientName_(K), countryCode: 'GR', requestLang: 'el-GR' },
    tags: ['okpublisher', K, month],
  };
  const src = String(prop_('VIVA_SOURCE_CODE', '')).trim();
  if (src) body.sourceCode = src;
  const r = UrlFetchApp.fetch(vivaHosts_().api + '/checkout/v2/orders', { method: 'post', muteHttpExceptions: true,
    contentType: 'application/json', payload: JSON.stringify(body), headers: { Authorization: 'Bearer ' + vivaToken_() } });
  const j = vivaJson_(r, 'παραγγελία');
  if (!j.orderCode) throw new Error('Viva παραγγελία: χωρίς orderCode');
  return String(j.orderCode);
}

function vivaLink_(orderCode) { return vivaHosts_().web + '/web/checkout?ref=' + encodeURIComponent(orderCode) + '&color=5B21D6'; }

// Πληρώθηκε η παραγγελία; Επιστρέφει { tx, amount } της πετυχημένης συναλλαγής ή null.
function vivaPaidTx_(orderCode) {
  const r = UrlFetchApp.fetch(vivaHosts_().web + '/api/transactions/?ordercode=' + encodeURIComponent(orderCode),
    { method: 'get', muteHttpExceptions: true, headers: { Authorization: vivaBasic_() } });
  const j = vivaJson_(r, 'έλεγχος πληρωμής');
  const list = j.Transactions || j.transactions || [];
  for (let i = 0; i < list.length; i++) {
    const t = list[i];
    if (String(t.StatusId || t.statusId) === 'F') return { tx: String(t.TransactionId || t.transactionId), amount: Number(t.Amount || t.amount || 0) };
  }
  return null;
}

// Μηνιαία χρέωση με το ID της πρώτης συναλλαγής. { ok, tx, error }
function vivaCharge_(st, K, month) {
  const body = { amount: st.amount, customerTrns: 'okpublisher · ' + st.plan + ' · ' + monthLabel_(month), merchantTrns: 'okp ' + K + ' ' + month };
  const src = String(prop_('VIVA_SOURCE_CODE', '')).trim();
  if (src) body.sourceCode = src;
  const r = UrlFetchApp.fetch(vivaHosts_().web + '/api/transactions/' + encodeURIComponent(st.tx), { method: 'post', muteHttpExceptions: true,
    contentType: 'application/json', payload: JSON.stringify(body), headers: { Authorization: vivaBasic_() } });
  let j = {};
  try { j = JSON.parse(r.getContentText() || '{}'); } catch (e) { j = {}; }
  const ok = r.getResponseCode() < 300 && String(j.StatusId) === 'F';
  return { ok: ok, tx: String(j.TransactionId || ''), error: ok ? '' : ('HTTP ' + r.getResponseCode() + ' ' + (j.ErrorText || j.message || j.StatusId || '')).trim() };
}

// ------------------------------------------------------------------ κατάσταση
function billState_(K) {
  const v = prop_('BILLING_' + K, '');
  if (!v) return null;
  try { return JSON.parse(v); } catch (e) { return null; }
}
function billSave_(K, st) { P_().setProperty('BILLING_' + K, JSON.stringify(st)); }
function billPaused_(K) { return cprop_(K, 'BILLING_PAUSED', 'false') === 'true'; }
function ym_(d) { return athens_(d, 'yyyy-MM'); }
function monthLabel_(ym) { const p = String(ym).split('-'); return BILL_.MONTHS[Number(p[1]) - 1] + ' ' + p[0]; }
function euros_(cents) { return (cents / 100).toFixed(2).replace('.', ','); }
// CLIENTS + TEST_CLIENTS (ο TST δεν δημοσιεύει ποτέ: χρήσιμος για δοκιμή πληρωμών στη demo της Viva).
function billingClients_() {
  return approvalClients_().filter(function (K) { return !!billState_(K); });
}

function billLog_(K, month, cents, action, result, code) {
  try { sheet_(BILL_.SHEET, BILL_.HEAD).appendRow([new Date(), K, month, cents ? cents / 100 : '', action, String(result || '').slice(0, 300), String(code || '')]); }
  catch (e) { console.log('Πληρωμές (Sheet): ' + e.message); }
}

// Νέος σύνδεσμος αν δεν υπάρχει ή αν ο τελευταίος είναι παλιός (λήγει). Επιστρέφει τον σύνδεσμο.
function freshLink_(K, st, month) {
  const rec = st.months[month];
  const age = rec.order_at ? (Date.now() - new Date(rec.order_at).getTime()) / 86400000 : 999;
  if (!rec.order || age > BILL_.LINK_REFRESH_DAYS) {
    if (rec.order) (rec.old_orders = rec.old_orders || []).push(rec.order);
    rec.order = vivaCreateOrder_(K, st, month);
    rec.order_at = new Date().toISOString();
    billLog_(K, month, st.amount, 'σύνδεσμος πληρωμής', 'νέα παραγγελία', rec.order);
  }
  return vivaLink_(rec.order);
}

// ------------------------------------------------------------------ αιτήματα από το outbox
function billingRequest_(K, req, res) {
  if (req.type === 'billing_start') {
    const amount = Math.round(Number(req.amount_eur) * 100);
    if (!(amount >= 100 && amount <= 200000)) throw new Error('billing_start: άκυρο ποσό (amount_eur, με ΦΠΑ)');
    if (!/^\d{4}-\d{2}$/.test(String(req.start || ''))) throw new Error('billing_start: λείπει ο πρώτος μήνας (start: "2027-02")');
    if (!req.plan) throw new Error('billing_start: λείπει το πακέτο');
    if (!String(cprop_(K, 'NOTIFY_TO', '')).trim()) throw new Error('Λείπει το NOTIFY_TO_' + K);
    const old = billState_(K);
    if (old && old.tx && !old.stop_after) throw new Error('billing_start: ο πελάτης έχει ήδη ενεργή συνδρομή');
    const st = { plan: String(req.plan), amount: amount, start: req.start, stop_after: null, tx: (old && old.tx) || null, months: (old && old.months) || {} };
    st.months[req.start] = st.months[req.start] || { st: 'pending' };
    if (st.months[req.start].st === 'paid') throw new Error('billing_start: ο μήνας ' + req.start + ' έχει ήδη πληρωθεί');
    billSave_(K, st);
    const link = freshLink_(K, st, req.start);
    billSave_(K, st);
    notify_(K, 'Πληρωμή συνδρομής για τον ' + monthLabel_(req.start),
      'Ευχαριστούμε που συνεχίζουμε μαζί!\n\n' +
      'Πακέτο: ' + st.plan + ' · €' + euros_(amount) + ' τον μήνα (με ΦΠΑ).\n' +
      'Πληρωμή με κάρτα, με ασφάλεια μέσω Viva: ' + link + '\n\n' +
      'Από τον επόμενο μήνα η χρέωση γίνεται αυτόματα την 1η κάθε μήνα. Τα στοιχεία της κάρτας τα κρατά η Viva, όχι εμείς. ' +
      'Η συνδρομή σταματά όποτε θέλετε, με ένα email έως τις 15 του μήνα.');
    res.order_code = st.months[req.start].order;
    res.link = link;
    return;
  }
  if (req.type === 'billing_stop') {
    const st = billState_(K);
    if (!st) throw new Error('billing_stop: δεν υπάρχει συνδρομή');
    if (!/^\d{4}-\d{2}$/.test(String(req.after || ''))) throw new Error('billing_stop: λείπει ο τελευταίος μήνας (after: "2027-05")');
    st.stop_after = req.after;
    billSave_(K, st);
    billLog_(K, req.after, 0, 'λύση', 'καμία χρέωση μετά τον ' + monthLabel_(req.after), '');
    res.stop_after = req.after;
    return;
  }
  throw new Error('Άγνωστο αίτημα πληρωμής: ' + req.type);
}

// ------------------------------------------------------------------ κύκλος
function setupBilling() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'billingCycle') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('billingCycle').timeBased().everyHours(BILL_.EVERY_H).create();
  sheet_(BILL_.SHEET, BILL_.HEAD);
  console.log('Έτοιμο: ο κύκλος πληρωμών τρέχει κάθε ώρα (χρεώσεις μόνο από τις ' + BILL_.ACT_HOUR + ':00). Τρέχει και τώρα μία φορά…');
  billingCycle();
}

function billingCycle() {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(10000)) return;
  const problems = [];
  try {
    billingClients_().forEach(function (K) {
      try { billingClient_(K, new Date()); } catch (e) { problems.push(K + ': ' + e.message); }
    });
    if (problems.length) reportBilling_(problems);
  } finally {
    lock.releaseLock();
  }
}

// Ένα μήνυμα ανά διαφορετικό πρόβλημα, μία φορά τη μέρα.
function reportBilling_(problems) {
  const key = 'BILLING_REPORTED', today = athens_(new Date(), 'yyyy-MM-dd');
  const sig = today + '|' + problems.join('|').slice(0, 400);
  if (prop_(key, '') === sig) return;
  P_().setProperty(key, sig);
  systemNotify_('Πληρωμές: πρόβλημα', problems.join('\n\n'));
}

function billingClient_(K, now) {
  const st = billState_(K);
  if (!st) return;
  // Χωρίς όλα τα κλειδιά δεν γίνεται τίποτα (και δεν μένει καμία χρέωση «στη μέση»).
  vivaNeed_(['VIVA_CLIENT_ID', 'VIVA_CLIENT_SECRET', 'VIVA_MERCHANT_ID', 'VIVA_API_KEY']);
  st.months = st.months || {};
  const months = Object.keys(st.months).sort();

  // 1. Παραγγελίες σε αναμονή: πληρώθηκαν; (κάθε ώρα, ώστε η επανεκκίνηση να είναι γρήγορη)
  months.forEach(function (m) {
    const rec = st.months[m];
    if (rec.st !== 'pending' || !rec.order) return;
    const orders = [rec.order].concat(rec.old_orders || []);
    for (let i = 0; i < orders.length; i++) {
      const p = vivaPaidTx_(orders[i]);
      if (!p) continue;
      rec.st = 'paid'; rec.tx = p.tx; rec.paid_at = new Date().toISOString();
      st.tx = p.tx;     // η τελευταία πληρωμή με κάρτα γίνεται η βάση για τις επόμενες χρεώσεις
      billSave_(K, st);
      billLog_(K, m, st.amount, 'πληρωμή με σύνδεσμο', 'πληρώθηκε', p.tx);
      if (billPaused_(K) && !months.some(function (x) { return x !== m && st.months[x].st === 'pending'; })) {
        P_().deleteProperty('BILLING_PAUSED_' + K);
        billLog_(K, m, 0, 'επανεκκίνηση', 'οι δημοσιεύσεις συνεχίζονται', '');
        notify_(K, 'Η πληρωμή έγινε: οι δημοσιεύσεις συνεχίζονται', 'Λάβαμε την πληρωμή για τον ' + monthLabel_(m) + '. Οι δημοσιεύσεις σας συνεχίζονται κανονικά. Ευχαριστούμε!');
      }
      return;
    }
  });

  const day = Number(athens_(now, 'd')), hour = Number(athens_(now, 'HH'));
  if (hour < BILL_.ACT_HOUR) return;
  const m = ym_(now);
  if (m < st.start || (st.stop_after && m > st.stop_after)) return;

  // 2. Νέος μήνας: αυτόματη χρέωση (μόνο αν δεν χρωστάει προηγούμενο μήνα).
  let rec = st.months[m];
  if (!rec) {
    if (Object.keys(st.months).some(function (x) { return x < m && st.months[x].st === 'pending'; })) return;
    if (st.tx) {
      st.months[m] = rec = { st: 'charging', at: new Date().toISOString() };
      billSave_(K, st);                                   // πριν από τη χρέωση: ποτέ δεύτερη για τον ίδιο μήνα
      const c = vivaCharge_(st, K, m);
      if (c.ok) {
        rec.st = 'paid'; rec.tx = c.tx; rec.paid_at = new Date().toISOString();
        billSave_(K, st);
        billLog_(K, m, st.amount, 'αυτόματη χρέωση', 'πληρώθηκε', c.tx);
        notify_(K, 'Χρεώθηκε η συνδρομή για τον ' + monthLabel_(m), 'Η συνδρομή σας για τον ' + monthLabel_(m) + ' (' + st.plan + ', €' + euros_(st.amount) + ' με ΦΠΑ) χρεώθηκε στην κάρτα σας. Ευχαριστούμε!');
        return;
      }
      rec.st = 'pending'; rec.charge_error = c.error;
      billSave_(K, st);
      billLog_(K, m, st.amount, 'αυτόματη χρέωση', 'δεν πέρασε: ' + c.error, '');
      const link = freshLink_(K, st, m);
      billSave_(K, st);
      notify_(K, 'Η χρέωση για τον ' + monthLabel_(m) + ' δεν πέρασε',
        'Η αυτόματη χρέωση της συνδρομής σας για τον ' + monthLabel_(m) + ' (€' + euros_(st.amount) + ' με ΦΠΑ) δεν έγινε δεκτή από την κάρτα.\n\n' +
        'Μπορείτε να πληρώσετε εδώ, και με άλλη κάρτα: ' + link + '\n\n' +
        'Αν η πληρωμή δεν γίνει έως τις ' + (BILL_.PAUSE_DAY - 1) + ' του μήνα, οι δημοσιεύσεις σταματούν προσωρινά μέχρι να γίνει.');
      return;
    }
    st.months[m] = rec = { st: 'pending' };
    const link0 = freshLink_(K, st, m);
    billSave_(K, st);
    notify_(K, 'Πληρωμή συνδρομής για τον ' + monthLabel_(m), 'Η συνδρομή σας για τον ' + monthLabel_(m) + ' (' + st.plan + ', €' + euros_(st.amount) + ' με ΦΠΑ). Πληρωμή με κάρτα μέσω Viva: ' + link0);
    return;
  }
  if (rec.st === 'charging') throw new Error('Η χρέωση του ' + m + ' είχε ξεκινήσει και δεν ολοκληρώθηκε. Δεν ξαναδοκιμάζεται: έλεγξε τη Viva και διόρθωσε το BILLING_' + K + '.');
  if (rec.st !== 'pending') return;

  // 3. Απλήρωτος μήνας: υπενθύμιση, μετά παύση.
  if (day >= BILL_.PAUSE_DAY && !rec.paused) {
    P_().setProperty('BILLING_PAUSED_' + K, 'true');
    rec.paused = new Date().toISOString();
    const link = freshLink_(K, st, m);
    billSave_(K, st);
    billLog_(K, m, st.amount, 'παύση', 'απλήρωτη συνδρομή', '');
    notify_(K, 'Οι δημοσιεύσεις σταμάτησαν προσωρινά',
      'Η συνδρομή σας για τον ' + monthLabel_(m) + ' (€' + euros_(st.amount) + ' με ΦΠΑ) δεν έχει πληρωθεί, γι\' αυτό οι δημοσιεύσεις σταμάτησαν προσωρινά.\n\n' +
      'Μόλις γίνει η πληρωμή, ξαναρχίζουν αυτόματα: ' + link);
    return;
  }
  if (day >= BILL_.REMIND_DAY && day < BILL_.PAUSE_DAY && !rec.reminded) {
    rec.reminded = new Date().toISOString();
    const link = freshLink_(K, st, m);
    billSave_(K, st);
    billLog_(K, m, st.amount, 'υπενθύμιση', 'στάλθηκε', '');
    notify_(K, 'Υπενθύμιση πληρωμής για τον ' + monthLabel_(m),
      'Η συνδρομή σας για τον ' + monthLabel_(m) + ' (€' + euros_(st.amount) + ' με ΦΠΑ) δεν έχει πληρωθεί ακόμα.\n\n' +
      'Πληρωμή με κάρτα μέσω Viva: ' + link + '\n\n' +
      'Αν δεν γίνει έως τις ' + (BILL_.PAUSE_DAY - 1) + ' του μήνα, οι δημοσιεύσεις σταματούν προσωρινά μέχρι να γίνει.');
  }
}

// ------------------------------------------------------------------ έλεγχος (χωρίς χρεώσεις)
function checkBilling() {
  const h = vivaHosts_();
  console.log('Viva: ' + (h.live ? 'LIVE (πραγματικές πληρωμές)' : 'demo (δοκιμαστικό περιβάλλον)'));
  try { vivaToken_(); console.log('Smart Checkout (OAuth): OK'); } catch (e) { console.log('Smart Checkout (OAuth): ' + e.message); }
  try {
    const r = UrlFetchApp.fetch(h.web + '/api/transactions/?date=' + athens_(new Date(), 'yyyy-MM-dd'),
      { method: 'get', muteHttpExceptions: true, headers: { Authorization: vivaBasic_() } });
    vivaJson_(r, 'Merchant ID / API key');
    console.log('Merchant ID / API key: OK');
  } catch (e) { console.log('Merchant ID / API key: ' + e.message); }
  const t = ScriptApp.getProjectTriggers().some(function (x) { return x.getHandlerFunction() === 'billingCycle'; });
  console.log(t ? 'Κύκλος πληρωμών: ενεργός' : 'Κύκλος πληρωμών: ΟΧΙ ακόμα (setupBilling)');
  clients_().forEach(function (K) {
    const st = billState_(K);
    if (!st) { console.log('[' + K + '] χωρίς συνδρομή'); return; }
    const last = Object.keys(st.months || {}).sort().slice(-3).map(function (m) { return m + ' ' + st.months[m].st; }).join(', ');
    console.log('[' + K + '] ' + st.plan + ' €' + euros_(st.amount) + ' · από ' + st.start + (st.stop_after ? ' έως ' + st.stop_after : '') +
      ' · κάρτα για αυτόματη χρέωση: ' + (st.tx ? 'ναι' : 'όχι ακόμα') + (billPaused_(K) ? ' · ΣΕ ΠΑΥΣΗ (απλήρωτη)' : '') + (last ? ' · ' + last : ''));
  });
}

// ΜΟΝΟ στη demo της Viva: δοκιμάζει τη μηνιαία χρέωση τώρα (χωρίς να περιμένει την 1η) στον πελάτη BILLING_TEST_CLIENT
// (προεπιλογή TST). Δεν αλλάζει τους μήνες του πελάτη· γράφει μόνο στην καρτέλα «Πληρωμές». Στο live αρνείται.
function demoChargeNow() {
  if (vivaHosts_().live) throw new Error('demoChargeNow: μόνο με VIVA_ENV=demo.');
  const K = String(prop_('BILLING_TEST_CLIENT', 'TST')).trim().toUpperCase();
  const st = billState_(K);
  if (!st || !st.tx) throw new Error('demoChargeNow: ο ' + K + ' δεν έχει ακόμα πληρωμένη πρώτη συναλλαγή (billing_start + πληρωμή με τον σύνδεσμο).');
  const c = vivaCharge_(st, K, 'demo-' + athens_(new Date(), 'yyyyMMddHHmm'));
  billLog_(K, 'demo', st.amount, 'δοκιμαστική χρέωση', c.ok ? 'πέρασε' : 'δεν πέρασε: ' + c.error, c.tx);
  console.log(c.ok ? 'Η δοκιμαστική χρέωση πέρασε: ' + c.tx : 'Η δοκιμαστική χρέωση ΔΕΝ πέρασε: ' + c.error);
  return c;
}
