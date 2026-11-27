/**
 * Πληρωμές συνδρομής μέσω Viva (okpublisher, ξεχωριστό αρχείο στο ίδιο project).
 *
 * Περίοδοι (από 26/11/2026, όροι v8 Α.7): κάθε συνδρομή έχει «μέρα» (st.day, 1–28 = η μέρα της πρώτης πληρωμής· 29–31 →
 *   1η του επόμενου μήνα). Οι περίοδοι ξεκινούν κάθε μήνα εκείνη τη μέρα· το κλειδί τους στο st.months μένει «ΕΕΕΕ-ΜΜ» (ο μήνας
 *   όπου ξεκινούν). Χρέωση την 1η μέρα της περιόδου (από τις 09:00), υπενθύμιση την 8η, παύση την 16η, διακοπή/αλλαγή πακέτου
 *   με τις μέρες της περιόδου. Χωρίς st.day (ORE, OKP, παλιές) = από την 1η του μήνα, όπως πριν (ίδια κείμενα). Βλ. «περίοδοι».
 * Μετά τη δωρεάν εβδομάδα (όροι v8 Α.4): billing_start { trial: true, trial_start } χωρίς start → «Συνεχίζουμε;» με σύνδεσμο ανά
 *   πακέτο· η πληρωμή ορίζει τη «μέρα» και την 1η περίοδο (βλ. OFFER_ πιο κάτω).
 * «Χρέωση» από το διαχειριστικό: billing_start { open: true, plan } → το ίδιο, με έναν σύνδεσμο (υπενθυμίσεις 4η/8η, λήγει μετά τη 14η).
 * Ροή (όροι Α.7, παλιά διατύπωση με «1η του μήνα» = περίοδοι με day 1):
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
 *   Νέος πελάτης μετά τη δωρεάν εβδομάδα (όροι v6 Α.4): billing_start { plan, amount_eur, start: "2027-02", trial: true,
 *     not_before: "2027-01-17T10:00:00+02:00" } → την 5η μέρα της εβδομάδας email «Πώς σας φάνηκε; Συνεχίζουμε;» με τον σύνδεσμο.
 *     (not_before: γενικό για κάθε αίτημα, βλ. Approval.gs.)
 *   Παλιότερα (όροι v5): free_month: "2027-01" → email «Καλώς ήρθατε», ο 2ος μήνας πληρώνεται με το σετάρισμα.
 *   billing_stop στέλνει email επιβεβαίωσης στον πελάτη (εκτός αν quiet: true).
 * Κουμπί «Διακοπή συνδρομής» (από 26/11/2026) σε κάθε email πληρωμής → σελίδα του web app (doGet ?a=stop&c=K&k=…) →
 *   επιβεβαίωση με κουμπί (το απλό άνοιγμα δεν σταματά τίποτα: τα προγράμματα email «ανοίγουν» συνδέσμους για έλεγχο)
 *   → billingStopWeb: λύση έως τις 15 → μετά τον τρέχοντα μήνα, μετά τις 15 → μετά τον επόμενο (όροι Α.8)· ό,τι
 *   έχει πληρωθεί παραδίδεται. Email επιβεβαίωσης στον πελάτη + ειδοποίηση στο okpublisher. Κλειδί: BILLING_KEY_<K>.
 *
 * Κουμπί «Αλλαγή πακέτου» (από 26/11/2026, όροι v7 Α.3) σε κάθε email πληρωμής (και {{PLAN_CHANGE_LINE}} στο email έγκρισης)
 *   → σελίδα ?a=plan&c=K&k=… → billingPlanWeb: ισχύει από τον επόμενο μήνα αν γίνει έως τις 19, αλλιώς από τον μεθεπόμενο
 *   (ποτέ για μήνα που έχει ήδη πληρωθεί). Αποθηκεύεται στο BILLING_<K>.change και εφαρμόζεται μόνο του στην αρχή του μήνα
 *   (πριν από τη χρέωση). Email στον πελάτη + «Αλλαγή πακέτου: K» στο okpublisher + clients/<K>/package_change.json
 *   στο publisher-work (η παραγωγή της 20ής αλλάζει config: package και ημέρες). Ίδιο πακέτο ξανά = ακύρωση της αλλαγής.
 *   Μόνο με ενεργή, πληρωμένη συνδρομή χωρίς απλήρωτο μήνα· αλλιώς «γράψτε μας».
 * Κάθε πληρωμή (με σύνδεσμο ή αυτόματη χρέωση) παίρνει μοναδικό κωδικό PAY-0001, PAY-0002, … (μετρητής PAY_SEQ, ποτέ ξανά
 *   ο ίδιος) και γράφεται στην καρτέλα «Πληρωμές» με κωδικό πελάτη (OK-…), όνομα, πακέτο και μήνα· ο κωδικός μπαίνει και
 *   στο email του πελάτη και στο BILLING_<K>.months[μήνας].pay. Κωδικός πελάτη: billing_start { code } ή το config.json.
 * Αίτημα test_client_remove (από 26/11/2026): μόνο για δοκιμαστικό πελάτη (TEST_CLIENTS, όχι CLIENTS) → σβήνει τις
 *   ρυθμίσεις του (*_<K>, και τη συνδρομή του), τον βγάζει από το TEST_CLIENTS και σβήνει τις γραμμές του στις «Πληρωμές».
 *   Τίποτα στο Drive ή στη Viva.
 * Δωρεάν πελάτες (από 26/11/2026): "billing": { "type": "free", "until": "2027-03" } στο clients/<K>/config.json (until =
 *   τελευταίος δωρεάν μήνας· χωρίς until = χωρίς λήξη, π.χ. ORE, OKP). Δεν έχουν συνδρομή, άρα κανένας σύνδεσμος/χρέωση.
 *   Μία φορά τη μέρα (από τις 09:00): στις 15 του τελευταίου δωρεάν μήνα email στο okpublisher «λήγει» (για να αποφασίσει
 *   ο Πέτρος πριν από την παραγωγή της 20ής) και, αν περάσει χωρίς συνδρομή, ένα «έληξε». Μετατροπή σε πληρωμή = billing_start.
 * Στη σελίδα πληρωμής της Viva φαίνεται «OK Publisher» (dynamicDescriptor· αν η Viva το αρνηθεί, η παραγγελία γίνεται χωρίς αυτό).
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
  // Πακέτα (όροι Α.3): τιμή χωρίς ΦΠΑ, posts/stories την εβδομάδα. Χρέωση = τιμή + ΦΠΑ 24%.
  PLANS: [{ name: 'Βασικό', net: 150, week: 2 }, { name: 'Μεσαίο', net: 250, week: 4 }, { name: 'Καθημερινό', net: 400, week: 7 }],
  VAT: 0.24,
  CHANGE_LAST_DAY: 19,  // αλλαγή πακέτου έως τις 19 → από τον επόμενο μήνα (η παραγωγή του γίνεται στις 20)
  HEAD: ['Χρόνος', 'Πελάτης', 'Μήνας', 'Ποσό €', 'Ενέργεια', 'Αποτέλεσμα', 'Κωδικός', 'Κωδικός πληρωμής', 'Κωδικός πελάτη', 'Όνομα πελάτη', 'Πακέτο'],
  PAY_PREFIX: 'PAY-',
  DESCRIPTOR: 'OK Publisher',   // όνομα στη σελίδα πληρωμής της Viva και στην κίνηση της κάρτας
  FREE_REMIND_DAY: 15,
  MONTHS_NOM: ['Ιανουάριος', 'Φεβρουάριος', 'Μάρτιος', 'Απρίλιος', 'Μάιος', 'Ιούνιος', 'Ιούλιος', 'Αύγουστος', 'Σεπτέμβριος', 'Οκτώβριος', 'Νοέμβριος', 'Δεκέμβριος'],
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
function vivaCreateOrder_(K, st, month, label) {
  const to = String(cprop_(K, 'NOTIFY_TO', '')).split(',')[0].trim();
  const body = {
    amount: st.amount, allowRecurring: true,
    paymentTimeout: Number(prop_('VIVA_LINK_SECONDS', BILL_.LINK_SECONDS)),
    customerTrns: 'okpublisher · ' + st.plan + ' · ' + (label || perShort_(st, month)),
    merchantTrns: 'okp ' + K + ' ' + month,
    customer: { email: to, fullName: clientName_(K), countryCode: 'GR', requestLang: 'el-GR' },
    tags: ['okpublisher', K, month],
  };
  const src = String(prop_('VIVA_SOURCE_CODE', '')).trim();
  if (src) body.sourceCode = src;
  body.dynamicDescriptor = BILL_.DESCRIPTOR;
  const send = function () {
    return UrlFetchApp.fetch(vivaHosts_().api + '/checkout/v2/orders', { method: 'post', muteHttpExceptions: true,
      contentType: 'application/json', payload: JSON.stringify(body), headers: { Authorization: 'Bearer ' + vivaToken_() } });
  };
  let r = send();
  if (r.getResponseCode() >= 400) {                  // αν η Viva δεν δεχτεί το όνομα: ξανά χωρίς αυτό (ο σύνδεσμος είναι πιο σημαντικός)
    console.log('Viva παραγγελία ' + r.getResponseCode() + ' με dynamicDescriptor· ξανά χωρίς: ' + r.getContentText().slice(0, 200));
    delete body.dynamicDescriptor;
    r = send();
  }
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
  const body = { amount: st.amount, customerTrns: 'okpublisher · ' + st.plan + ' · ' + perShort_(st, month), merchantTrns: 'okp ' + K + ' ' + month };
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
function billPaused_(K) {
  if (cprop_(K, 'BILLING_PAUSED', 'false') === 'true') return true;
  const a = agencyOf_(K);                                  // πελάτης agency: παύση όταν η agency δεν έχει πληρώσει (Agency.gs)
  return !!a && cprop_(a, 'BILLING_PAUSED', 'false') === 'true';
}
function ym_(d) { return athens_(d, 'yyyy-MM'); }

// ---------------------------------------------------------------- περίοδοι (από 26/11/2026)
// Κάθε πελάτης έχει «τη μέρα του» (st.day, 1–28: η μέρα της πρώτης πληρωμής· 29–31 → 1η του επόμενου μήνα). Μία περίοδος
// ξεκινά κάθε μήνα εκείνη τη μέρα, άρα το κλειδί της (st.months) μένει «ΕΕΕΕ-ΜΜ» = ο μήνας στον οποίο ξεκινά. Χωρίς st.day
// (παλιές συνδρομές, ORE, OKP) = 1η του μήνα, όπως πριν: ίδια κείμενα, ίδιες ημερομηνίες.
function billDay_(st) { const d = Number(st && st.day) || 1; return d >= 1 && d <= 28 ? Math.floor(d) : 1; }
function ymd_(y, m, d) { return y + '-' + ('0' + m).slice(-2) + '-' + ('0' + d).slice(-2); }
function utc_(s) { const p = String(s).split('-').map(Number); return Date.UTC(p[0], p[1] - 1, p[2]); }
function addDays_(s, n) { const d = new Date(utc_(s) + n * 86400000); return ymd_(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()); }
function perStart_(st, ym) { const p = String(ym).split('-').map(Number); return ymd_(p[0], p[1], billDay_(st)); }
function perEnd_(st, ym) { return addDays_(perStart_(st, nextYm_(ym)), -1); }
// Η περίοδος (κλειδί ΕΕΕΕ-ΜΜ) στην οποία είμαστε τώρα.
function periodOf_(st, now) { const m = ym_(now); return Number(athens_(now, 'd')) >= billDay_(st) ? m : prevYm_(m); }
// Πόσο μέσα στην περίοδο είμαστε: 1 = η πρώτη μέρα της.
function periodDay_(st, now, ym) { return Math.round((utc_(athens_(now, 'yyyy-MM-dd')) - utc_(perStart_(st, ym || periodOf_(st, now)))) / 86400000) + 1; }
function dm_(s, withYear) { const p = String(s).split('-').map(Number); return p[2] + '/' + p[1] + (withYear ? '/' + p[0] : ''); }
// «27/1–26/2/2027» (ή «27/12/2026–26/1/2027» όταν αλλάζει ο χρόνος).
function perRange_(st, ym) {
  const a = perStart_(st, ym), b = perEnd_(st, ym);
  return dm_(a, a.slice(0, 4) !== b.slice(0, 4)) + '–' + dm_(b, true);
}
// Το ίδιο, με το όνομα του μήνα / τις ημερομηνίες σε <b> (για τις σελίδες).
function perForB_(st, ym) { return billDay_(st) === 1 ? 'τον <b>' + esc_(monthLabel_(ym)) + '</b>' : 'την περίοδο <b>' + esc_(perRange_(st, ym)) + '</b>'; }
function perFor_(st, ym) { return billDay_(st) === 1 ? 'τον ' + monthLabel_(ym) : 'την περίοδο ' + perRange_(st, ym); }
function perNom_(st, ym) { return billDay_(st) === 1 ? 'Μήνας: ' + monthNom_(ym) : 'Περίοδος: ' + perRange_(st, ym); }
function perShort_(st, ym) { return billDay_(st) === 1 ? monthNom_(ym) : perRange_(st, ym); }
// «έως τις 15 του μήνα» (1η) ή «έως τις 10/3» (η n-οστή μέρα της περιόδου ym).
function perBy_(st, ym, n) { return billDay_(st) === 1 ? 'έως τις ' + n + ' του μήνα' : 'έως τις ' + dm_(addDays_(perStart_(st, ym), n - 1)); }
// Για τη διακοπή (όροι Α.8), χωρίς συγκεκριμένη περίοδο.
function stopRule_(st) { return billDay_(st) === 1 ? 'έως τις 15 του μήνα' : 'μέσα στις πρώτες 15 μέρες της περιόδου'; }
// ---------------------------------------------------------------- διακοπή συνδρομής
function billingStop_(K, st, after, quiet, how) {
  st.stop_after = after;
  billSave_(K, st);
  billLog_(K, after, 0, 'λύση (' + how + ')', 'καμία χρέωση μετά ' + perFor_(st, after), '');
  if (quiet) return;
  notify_(K, 'Η συνδρομή σας σταματά μετά ' + perFor_(st, after),
    'Λάβαμε το αίτημά σας. Η συνδρομή σας (' + st.plan + ') σταματά μετά ' + perFor_(st, after) + ': ' +
    'οι δημοσιεύσεις συνεχίζονται έως το τέλος του μήνα και δεν θα γίνει καμία άλλη χρέωση. ' +
    'Μετά αφαιρούμε την πρόσβασή μας και σβήνουμε τα στοιχεία σας μέσα σε 30 ημέρες. Ό,τι έχει δημοσιευτεί μένει στη σελίδα σας.\n\n' +
    'Ευχαριστούμε για τη συνεργασία! Αν αλλάξετε γνώμη, απαντήστε σε αυτό το email.');
}

function billKey_(K) {
  let k = cprop_(K, 'BILLING_KEY', '');
  if (!k) { k = Utilities.getUuid().replace(/-/g, ''); P_().setProperty('BILLING_KEY_' + K, k); }
  return k;
}

// Η διεύθυνση /exec της εφαρμογής ιστού (WEBAPP_URL, γράφεται μόνη της· βλ. Upload.gs)· '' αν δεν υπάρχει.
function webappUrl_() {
  let u = String(prop_('WEBAPP_URL', '') || prop_('UPLOAD_URL', '') || '').trim();
  if (!u) { try { u = String(ScriptApp.getService().getUrl() || ''); } catch (e) { u = ''; } }
  u = u.replace(/\?.*$/, '');
  return /^https:\/\/script\.google\.com\/.+\/exec$/.test(u) ? u : '';
}

function cancelUrl_(K) { const u = webappUrl_(); return u ? u + '?a=stop&c=' + K + '&k=' + billKey_(K) : ''; }

function esc_(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

// Email πληρωμής με το κουμπί «Διακοπή συνδρομής» (και ως σύνδεσμο στο απλό κείμενο).
function billNotify_(K, subject, text) {
  const st0 = billState_(K), ag = !!(st0 && st0.agency);
  const u = cancelUrl_(K), pu = ag ? '' : planUrl_(K), rule = stopRule_(st0);
  if (ag && st0.agency.lines && st0.agency.lines.length && !/\nΑνάλυση:/.test(text)) {
    text += '\n\nΑνάλυση:\n' + st0.agency.lines.map(function (l) { return '• ' + l; }).join('\n');
  }
  if (st0 && st0.amount_full && st0.referral_use) text += '\n\nΈκπτωση σύστασης: −€' + euros_(st0.referral_use) + ' (κανονικά €' + euros_(st0.amount_full) + ').';
  let rl = '';
  try { rl = referralLine_(K); } catch (e) { rl = ''; }
  if (rl) text += '\n\n' + rl;
  const tail = (pu ? '\n\nΑλλαγή πακέτου: ' + pu : '') +
    (u ? '\n\nΔιακοπή συνδρομής: ' + u : '\n\nΓια διακοπή της συνδρομής, απαντήστε σε αυτό το email ' + rule + '.');
  const btn = function (href, label) {
    return '<a href="' + esc_(href) + '" style="display:inline-block;padding:9px 18px;margin:0 8px 8px 0;border:2px solid #5B21D6;' +
      'border-radius:999px;color:#5B21D6;text-decoration:none;font-weight:bold">' + label + '</a>';
  };
  const html = '<div style="font:15px/1.6 Arial,sans-serif;color:#14162E">' +
    esc_(text).replace(/(https:\/\/[^\s<]+)/g, '<a href="$1">$1</a>').replace(/\n/g, '<br>') +
    (u ? '<p style="margin-top:28px">' + (pu ? btn(pu, 'Αλλαγή πακέτου') : '') + btn(u, 'Διακοπή συνδρομής') + '</p>'
      : '<p style="margin-top:24px;color:#4A4C66">Για διακοπή της συνδρομής, απαντήστε σε αυτό το email ' + rule + '.</p>') + '</div>';
  notify_(K, subject, text + tail, html);
}

// Πότε σταματά αν ζητήσει διακοπή τώρα (όροι Α.8): έως τις 15 → μετά τον τρέχοντα μήνα, αλλιώς μετά τον επόμενο.
// Ό,τι έχει ήδη πληρωθεί (π.χ. ο 1ος μήνας πριν ξεκινήσει) παραδίδεται.
function stopAfterFor_(st, now) {
  const cur = periodOf_(st, now);
  let after = periodDay_(st, now, cur) <= 15 ? cur : nextYm_(cur);
  Object.keys(st.months || {}).forEach(function (m) { if (st.months[m].st === 'paid' && m > after) after = m; });
  return after;
}

// Τι δείχνει η σελίδα: { state: 'bad' | 'none' | 'stopped' | 'active', K, st, after }
function cancelInfo_(c, k) {
  const K = String(c || '').toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(K) || !k || cprop_(K, 'BILLING_KEY', '') !== String(k)) return { state: 'bad' };
  const st = billState_(K);
  const paid = st && Object.keys(st.months || {}).some(function (m) { return st.months[m].st === 'paid'; });
  if (!st || !paid) return { state: 'none', K: K };
  if (st.stop_after) return { state: 'stopped', K: K, st: st, after: st.stop_after };
  return { state: 'active', K: K, st: st, after: stopAfterFor_(st, new Date()) };
}

function billingCancelPage_(q) {
  const i = cancelInfo_(q.c, q.k);
  let body;
  if (i.state === 'bad') body = '<p>Ο σύνδεσμος δεν ισχύει. Γράψτε μας στο <a href="mailto:okpublisher.gr@gmail.com">okpublisher.gr@gmail.com</a>.</p>';
  else if (i.state === 'none') body = '<p>Δεν βρέθηκε ενεργή συνδρομή. Για οτιδήποτε, γράψτε μας στο <a href="mailto:okpublisher.gr@gmail.com">okpublisher.gr@gmail.com</a>.</p>';
  else if (i.state === 'stopped') body = '<p>Η συνδρομή σας σταματά ήδη μετά ' + perForB_(i.st, i.after) + '. Δεν θα γίνει καμία άλλη χρέωση.</p>';
  else body = '<p>Συνδρομή: <b>' + esc_(i.st.plan) + '</b> · €' + euros_(i.st.amount) + ' τον μήνα (με ΦΠΑ).</p>' +
    '<p>Αν τη διακόψετε σήμερα, οι δημοσιεύσεις συνεχίζονται ως και ' + perForB_(i.st, i.after) + ' ' +
    'και μετά δεν γίνεται καμία άλλη χρέωση.</p>' +
    '<p><button id="b">Διακοπή συνδρομής</button></p><p id="m" class="fine">Αν αλλάξατε γνώμη, απλώς κλείστε αυτή τη σελίδα.</p>' +
    '<script>document.getElementById("b").onclick=function(){var b=this;b.disabled=true;b.textContent="Μια στιγμή…";' +
    'google.script.run.withSuccessHandler(function(r){document.getElementById("c").innerHTML=r;})' +
    '.withFailureHandler(function(){b.disabled=false;b.textContent="Διακοπή συνδρομής";document.getElementById("m").textContent=' +
    '"Κάτι πήγε στραβά. Δοκιμάστε ξανά ή γράψτε μας στο okpublisher.gr@gmail.com.";})' +
    '.billingStopWeb(' + JSON.stringify(String(q.c)) + ',' + JSON.stringify(String(q.k)) + ');};</script>';
  const html = '<!doctype html><html lang="el"><head><meta charset="utf-8"><style>' +
    'body{margin:0;font:17px/1.6 Arial,sans-serif;color:#14162E;background:#F2ECFF}' +
    '.w{max-width:520px;margin:40px auto;background:#fff;border-radius:22px;padding:28px}' +
    'h1{font-size:24px;margin:0 0 12px;color:#5B21D6}.fine{color:#4A4C66;font-size:15px}' +
    'button{font:bold 17px Arial,sans-serif;background:#5B21D6;color:#fff;border:0;border-radius:999px;padding:14px 26px;cursor:pointer}' +
    'button:disabled{opacity:.6}</style></head><body><div class="w"><h1>Διακοπή συνδρομής</h1><div id="c">' + body +
    '</div><p class="fine">okpublisher · <a href="https://okpublisher.gr">okpublisher.gr</a></p></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle('Διακοπή συνδρομής · okpublisher')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// Καλείται από το κουμπί της σελίδας (google.script.run). Επιστρέφει το κείμενο που δείχνει η σελίδα.
function billingStopWeb(c, k) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(20000)) throw new Error('busy');
  try {
    const i = cancelInfo_(c, k);
    if (i.state === 'bad' || i.state === 'none') return '<p>Δεν βρέθηκε ενεργή συνδρομή. Γράψτε μας στο okpublisher.gr@gmail.com.</p>';
    if (i.state === 'stopped') return '<p>Η συνδρομή σας σταματά ήδη μετά ' + perForB_(i.st, i.after) + '. Δεν θα γίνει καμία άλλη χρέωση.</p>';
    billingStop_(i.K, i.st, i.after, false, 'κουμπί');
    systemNotify_('Διακοπή συνδρομής: ' + i.K, 'Ο πελάτης ' + i.K + ' (' + i.st.plan + ') διέκοψε τη συνδρομή με το κουμπί. ' +
      'Τελευταία περίοδος: ' + perShort_(i.st, i.after) + '. Μετά: αφαίρεση πρόσβασης και διαγραφή δεδομένων σε 30 ημέρες (όροι Β.11).');
    return '<p><b>Έγινε.</b> Η συνδρομή σας σταματά μετά ' + perForB_(i.st, i.after) + ': οι δημοσιεύσεις συνεχίζονται ' +
      'ως και ' + esc_(perFor_(i.st, i.after)) + ' και δεν θα γίνει καμία άλλη χρέωση. Σας στείλαμε και email επιβεβαίωσης.</p><p>Ευχαριστούμε για τη συνεργασία!</p>';
  } finally { lock.releaseLock(); }
}

// ---------------------------------------------------------------- αλλαγή πακέτου (όροι v7 Α.3)
function planOf_(name) {
  const n = String(name || '').trim().split(/[ ·]/)[0];
  return BILL_.PLANS.filter(function (p) { return p.name === n; })[0] || null;
}
function planCents_(p) { return Math.round(p.net * (1 + BILL_.VAT) * 100); }
function planUrl_(K) { const u = webappUrl_(); return u ? u + '?a=plan&c=' + K + '&k=' + billKey_(K) : ''; }

// Από ποιον μήνα ισχύει μια αλλαγή που ζητείται τώρα: έως τις 19 → ο επόμενος, μετά → ο μεθεπόμενος (η παραγωγή του
// επόμενου μήνα γίνεται στις 20). Ποτέ μήνας που έχει ήδη πληρωθεί. '' αν η συνδρομή λήγει πριν.
function planChangeFrom_(st, now) {
  const cur = periodOf_(st, now), months = st.months || {};
  let from = periodDay_(st, now, cur) <= BILL_.CHANGE_LAST_DAY ? nextYm_(cur) : nextYm_(nextYm_(cur));
  if (st.start && from < st.start) from = st.start;
  for (let i = 0; i < 24 && months[from] && months[from].st === 'paid'; i++) from = nextYm_(from);
  return st.stop_after && from > st.stop_after ? '' : from;
}

// Τι δείχνει η σελίδα: { state: 'bad' | 'none' | 'unpaid' | 'ends' | 'active', K, st, from }
function planInfo_(c, k) {
  const K = String(c || '').toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(K) || !k || cprop_(K, 'BILLING_KEY', '') !== String(k)) return { state: 'bad' };
  const st = billState_(K), months = (st && st.months) || {};
  if (!st || !st.tx || !Object.keys(months).some(function (m) { return months[m].st === 'paid'; })) return { state: 'none', K: K };
  if (Object.keys(months).some(function (m) { return months[m].st !== 'paid'; })) return { state: 'unpaid', K: K, st: st };
  const from = planChangeFrom_(st, new Date());
  if (!from) return { state: 'ends', K: K, st: st };
  return { state: 'active', K: K, st: st, from: from };
}

// Για το email έγκρισης ({{PLAN_CHANGE_LINE}} στο αίτημα email): η γραμμή με τον σύνδεσμο, μόνο με ενεργή συνδρομή.
function planChangeLine_(K, html) {
  const st = billState_(K), u = planUrl_(K);
  if (!u || !st || !st.tx || (st.stop_after && st.stop_after <= periodOf_(st, new Date()))) return '';
  return html ? '<p style="color:#4A4C66">Θέλετε άλλο πακέτο; <a href="' + esc_(u) + '">Αλλαγή πακέτου</a> (ισχύει από ' + (billDay_(st) === 1 ? 'τον επόμενο μήνα' : 'την επόμενη περίοδο') + ').</p>'
    : 'Θέλετε άλλο πακέτο; Αλλαγή πακέτου: ' + u;
}

// Σελίδα για πελάτες (ίδια εμφάνιση με τη «Διακοπή συνδρομής»).
function billPage_(title, body) {
  const html = '<!doctype html><html lang="el"><head><meta charset="utf-8"><style>' +
    'body{margin:0;font:17px/1.6 Arial,sans-serif;color:#14162E;background:#F2ECFF}' +
    '.w{max-width:520px;margin:40px auto;background:#fff;border-radius:22px;padding:28px}' +
    'h1{font-size:24px;margin:0 0 12px;color:#5B21D6}.fine{color:#4A4C66;font-size:15px}.note{background:#FFF6CC;border-radius:12px;padding:10px 14px}' +
    '.pl{display:flex;gap:12px;align-items:flex-start;border:2px solid #E4DCF7;border-radius:16px;padding:12px 14px;margin:0 0 10px;cursor:pointer}' +
    '.pl input{margin-top:6px;accent-color:#5B21D6}.pl i{color:#5B21D6}' +
    'button{font:bold 17px Arial,sans-serif;background:#5B21D6;color:#fff;border:0;border-radius:999px;padding:14px 26px;cursor:pointer}' +
    'button:disabled{opacity:.6}</style></head><body><div class="w"><h1>' + esc_(title) + '</h1><div id="c">' + body +
    '</div><p class="fine">okpublisher · <a href="https://okpublisher.gr">okpublisher.gr</a></p></div></body></html>';
  return HtmlService.createHtmlOutput(html).setTitle(title + ' · okpublisher').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function billingPlanPage_(q) {
  const i = planInfo_(q.c, q.k), mail = '<a href="mailto:okpublisher.gr@gmail.com">okpublisher.gr@gmail.com</a>';
  let body;
  if (i.state === 'bad') body = '<p>Ο σύνδεσμος δεν ισχύει. Γράψτε μας στο ' + mail + '.</p>';
  else if (i.state === 'none') body = '<p>Δεν βρέθηκε ενεργή συνδρομή. Για αλλαγή πακέτου, γράψτε μας στο ' + mail + '.</p>';
  else if (i.state === 'unpaid') body = '<p>Υπάρχει πληρωμή σε εκκρεμότητα. Μόλις γίνει, θα μπορείτε να αλλάξετε πακέτο από εδώ. Ή γράψτε μας στο ' + mail + '.</p>';
  else if (i.state === 'ends') body = '<p>Η συνδρομή σας σταματά μετά ' + perForB_(i.st, i.st.stop_after) + ', οπότε δεν αλλάζει πακέτο. ' +
    'Αν θέλετε να συνεχίσουμε, γράψτε μας στο ' + mail + '.</p>';
  else {
    const cur = planOf_(i.st.plan), ch = i.st.change;
    body = '<p>Τώρα: <b>' + esc_(i.st.plan) + '</b> · €' + euros_(i.st.amount) + ' τον μήνα (με ΦΠΑ).</p>' +
      (ch ? '<p class="note">Έχετε ήδη ζητήσει <b>' + esc_(ch.plan) + '</b> από ' + esc_(perFor_(i.st, ch.from)) + '. Μπορείτε να διαλέξετε άλλο ή να μείνετε στο τρέχον.</p>' : '') +
      BILL_.PLANS.map(function (p) {
        const on = ch ? p.name === ch.plan : !!(cur && p.name === cur.name);
        return '<label class="pl"><input type="radio" name="p" value="' + esc_(p.name) + '"' + (on ? ' checked' : '') + '><span><b>' + esc_(p.name) +
          '</b> · €' + p.net + ' + ΦΠΑ τον μήνα' + (cur && p.name === cur.name ? ' <i>(τρέχον)</i>' : '') + '<br>' + p.week + ' posts και ' + p.week +
          ' stories την εβδομάδα</span></label>';
      }).join('') +
      '<p>Η αλλαγή ισχύει από ' + perForB_(i.st, i.from) + ': το πρόγραμμα και η χρέωσή ' + (billDay_(i.st) === 1 ? 'του (την 1η)' : 'της') + ' βγαίνουν με το νέο πακέτο. ' +
      'Ως τότε όλα μένουν ως έχουν. Χωρίς αναλογικές χρεώσεις ή επιστροφές.</p>' +
      '<p><button id="b">Επιβεβαίωση</button></p><p id="m" class="fine">Αν αλλάξατε γνώμη, απλώς κλείστε αυτή τη σελίδα.</p>' +
      '<script>document.getElementById("b").onclick=function(){var b=this,c=document.querySelector("input[name=p]:checked");if(!c)return;' +
      'b.disabled=true;b.textContent="Μια στιγμή…";google.script.run.withSuccessHandler(function(r){document.getElementById("c").innerHTML=r;})' +
      '.withFailureHandler(function(){b.disabled=false;b.textContent="Επιβεβαίωση";document.getElementById("m").textContent=' +
      '"Κάτι πήγε στραβά. Δοκιμάστε ξανά ή γράψτε μας στο okpublisher.gr@gmail.com.";})' +
      '.billingPlanWeb(' + JSON.stringify(i.K) + ',' + JSON.stringify(String(q.k)) + ',c.value);};</script>';
  }
  return billPage_('Αλλαγή πακέτου', body);
}

// Αλλαγή πακέτου σε ενεργή συνδρομή (σελίδα πελάτη ή διαχειριστικό): 'set' (προγραμματίστηκε από τον from), 'cancelled'
// (ξανά το τρέχον πακέτο → η αλλαγή που περίμενε ακυρώθηκε) ή 'same' (τίποτα). by = ποιος την έκανε (για το email του okpublisher).
function planChangeSet_(K, st, p, from, by) {
  const cur = planOf_(st.plan);
  if (cur && p.name === cur.name) {
    if (!st.change) return 'same';
    const old = st.change;
    delete st.change;
    billSave_(K, st);
    billLog_(K, old.from, 0, 'αλλαγή πακέτου: ακύρωση', 'μένει ' + st.plan + ' (' + by + ')', '');
    const repo = planChangeRepo_(K, { plan: st.plan, previous: st.plan, from: old.from, status: 'cancelled', cancelled: old.plan });
    billNotify_(K, 'Μένετε στο πακέτο ' + st.plan, 'Ακυρώσαμε την αλλαγή σε ' + old.plan + '. Το πακέτο σας μένει ' + st.plan +
      ' (€' + euros_(st.amount) + ' τον μήνα με ΦΠΑ).');
    systemNotify_('Αλλαγή πακέτου: ' + K + ' (ακυρώθηκε)', 'Ακυρώθηκε (' + by + ') η αλλαγή του ' + K + ' σε ' + old.plan + ' από ' +
      perFor_(st, old.from) + '. Μένει ' + st.plan + '.' + repo);
    return 'cancelled';
  }
  st.change = { plan: p.name, amount: planCents_(p), from: from, at: new Date().toISOString(), previous: st.plan };
  billSave_(K, st);
  billLog_(K, from, st.change.amount, 'αλλαγή πακέτου', st.plan + ' → ' + p.name + ' από ' + monthLabel_(from) + ' (' + by + ')', '');
  const repo = planChangeRepo_(K, { plan: p.name, previous: st.plan, from: from, week: p.week, status: 'scheduled' });
  billNotify_(K, 'Αλλαγή πακέτου σε ' + p.name + ' από ' + perFor_(st, from),
    'Από ' + perFor_(st, from) + ' το πακέτο σας γίνεται ' + p.name + ' (' + p.week + ' posts και ' + p.week +
    ' stories την εβδομάδα), €' + euros_(st.change.amount) + ' τον μήνα με ΦΠΑ, με αυτόματη χρέωση ' + chargeDayText_(st) + '. ' +
    'Ως τότε όλα μένουν ως έχουν (' + st.plan + ').');
  systemNotify_('Αλλαγή πακέτου: ' + K, 'Αλλαγή πακέτου του ' + K + ' (' + by + '): ' + st.plan + ' → ' + p.name + ' από ' + perFor_(st, from) +
    '. Η χρέωση αλλάζει μόνη της. Στην παραγωγή εκείνης της περιόδου: config.json (package, ημέρες posts/stories).' + repo);
  return 'set';
}

// Καλείται από το κουμπί της σελίδας (google.script.run). Επιστρέφει το κείμενο που δείχνει η σελίδα.
function billingPlanWeb(c, k, plan) {
  const lock = LockService.getUserLock();
  if (!lock.tryLock(20000)) throw new Error('busy');
  try {
    const i = planInfo_(c, k), p = planOf_(plan);
    if (i.state !== 'active') return '<p>Δεν γίνεται αλλαγή πακέτου από εδώ. Γράψτε μας στο okpublisher.gr@gmail.com.</p>';
    if (!p) throw new Error('Άγνωστο πακέτο');
    const r = planChangeSet_(i.K, i.st, p, i.from, 'από τον πελάτη');
    if (r === 'same') return '<p>Αυτό είναι ήδη το πακέτο σας: δεν αλλάζει τίποτα.</p>';
    if (r === 'cancelled') return '<p><b>Έγινε.</b> Μένετε στο <b>' + esc_(i.st.plan) + '</b>. Σας στείλαμε email επιβεβαίωσης.</p>';
    return '<p><b>Έγινε.</b> Από ' + perForB_(i.st, i.from) + ' το πακέτο σας γίνεται <b>' + esc_(p.name) + '</b> (€' +
      euros_(i.st.change.amount) + ' τον μήνα με ΦΠΑ). Σας στείλαμε email επιβεβαίωσης.</p>';
  } finally { lock.releaseLock(); }
}

// Στην αρχή του μήνα της αλλαγής (πριν από τη χρέωση): το νέο πακέτο και ποσό γίνονται τα τρέχοντα.
function applyPlanChange_(K, st) {
  const ch = st.change;
  st.plan = ch.plan;
  st.amount = ch.amount;
  st.plan_changed = { from: ch.from, previous: ch.previous || '', at: new Date().toISOString() };
  delete st.change;
  billSave_(K, st);
  billLog_(K, ch.from, ch.amount, 'αλλαγή πακέτου: ισχύει', (ch.previous || '') + ' → ' + ch.plan, '');
}

// Σημείωση για την παραγωγή στο publisher-work. Επιστρέφει κείμενο για το email του okpublisher ('' αν όλα καλά).
function planChangeRepo_(K, o) {
  try {
    ghPutJson_('clients/' + K + '/package_change.json', Object.assign({ client: K, requested_at: new Date().toISOString(),
      note: 'Γράφεται από το Apps Script (Billing.gs). Η παραγωγή του μήνα «from» ενημερώνει το config.json (package, ημέρες) και γράφει applied_at.' }, o),
      'Αλλαγή πακέτου ' + K + ': ' + o.status);
    return '';
  } catch (e) { return '\n\n(Δεν γράφτηκε στο publisher-work: ' + e.message + ' — ενημέρωσε το config με το χέρι.)'; }
}

// Δοκιμαστικός πελάτης έξω: ρυθμίσεις *_<K> (και η συνδρομή του), TEST_CLIENTS, γραμμές του στις «Πληρωμές». Μόνο αν δεν
// είναι στο CLIENTS (πραγματικοί πελάτες ποτέ). Το Drive και η Viva μένουν ως έχουν.
function testClientRemove_(K, res) {
  const test = String(prop_('TEST_CLIENTS', '')).split(',').map(function (x) { return x.trim().toUpperCase(); }).filter(String);
  if (!/^[A-Z0-9]{2,12}$/.test(K) || test.indexOf(K) < 0 || clients_().indexOf(K) >= 0) {
    throw new Error('test_client_remove: μόνο για δοκιμαστικό πελάτη (TEST_CLIENTS, όχι CLIENTS)');
  }
  const P = P_(), all = P.getProperties(), removed = [];
  Object.keys(all).forEach(function (k) { if (k.slice(-(K.length + 1)) === '_' + K) { P.deleteProperty(k); removed.push(k); } });
  P.setProperty('TEST_CLIENTS', test.filter(function (x) { return x !== K; }).join(','));
  if (String(prop_('BILLING_TEST_CLIENT', '')).trim().toUpperCase() === K) { P.deleteProperty('BILLING_TEST_CLIENT'); removed.push('BILLING_TEST_CLIENT'); }
  let rows = 0;
  const sh = SpreadsheetApp.getActive().getSheetByName(BILL_.SHEET);
  if (sh) {
    const v = sh.getDataRange().getValues();
    if (v.length > 1) {
      const width = v[0].length, keep = v.slice(1).filter(function (r) { return String(r[1]) !== K; });
      rows = v.length - 1 - keep.length;
      if (rows) {
        sh.getRange(2, 1, v.length - 1, width).clearContent();
        if (keep.length) sh.getRange(2, 1, keep.length, width).setValues(keep);
      }
    }
  }
  res.removed_settings = removed.sort();
  res.removed_payment_rows = rows;
  systemNotify_('Δοκιμαστικός πελάτης ' + K + ': σβήστηκε', 'Σβήστηκαν ' + removed.length + ' ρυθμίσεις (' + removed.join(', ') + ') και ' + rows +
    ' γραμμές στις «Πληρωμές». Το Drive και η Viva δεν άλλαξαν.');
}

// Δωρεάν πελάτες με λήξη: μία φορά τη μέρα, από τις 09:00. Χωρίς GITHUB_TOKEN τίποτα.
function freeCycle_(now) {
  if (Number(athens_(now, 'HH')) < BILL_.ACT_HOUR || !prop_('GITHUB_TOKEN', '')) return;
  const today = athens_(now, 'yyyy-MM-dd');
  if (prop_('FREE_CHECK_DAY', '') === today) return;
  P_().setProperty('FREE_CHECK_DAY', today);
  const cur = ym_(now), day = Number(athens_(now, 'd'));
  ghList_('clients').filter(function (f) { return f.type === 'dir' && /^[A-Z0-9]{2,12}$/.test(f.name); }).forEach(function (f) {
    const K = f.name;
    let cfg = null;
    try { cfg = ghJson_('clients/' + K + '/config.json'); } catch (e) { cfg = null; }
    const b = cfg && cfg.billing;
    if (!b || b.type !== 'free' || !/^\d{4}-\d{2}$/.test(String(b.until || ''))) return;
    const who = (cfg.code ? cfg.code + ' · ' : '') + (cfg.name || clientName_(K)) + ' (' + K + ')';
    const st = billState_(K), paying = !!(st && st.tx && !(st.stop_after && st.stop_after < cur));
    if (cur === b.until && day >= BILL_.FREE_REMIND_DAY && !paying && cprop_(K, 'FREE_REMINDED', '') !== b.until) {
      P_().setProperty('FREE_REMINDED_' + K, b.until);
      systemNotify_('Δωρεάν έως ' + monthLabel_(b.until) + ': ' + who + ' — αποφάσισε πριν τις 20',
        'Ο πελάτης ' + who + ' είναι δωρεάν ως και τον ' + monthLabel_(b.until) + (cfg.package ? ' (πακέτο ' + cfg.package + ')' : '') + '.\n\n' +
        'Στις 20 ετοιμάζεται το πρόγραμμα του ' + monthLabel_(nextYm_(b.until)) + '. Πες στο Claude (Project okpublisher):\n' +
        '• «χρέωσέ τον» (και πακέτο) → του στέλνουμε σύνδεσμο πληρωμής για τον ' + monthLabel_(nextYm_(b.until)) + ', ή\n' +
        '• «δωρεάν έως …» → παράταση, ή\n• τίποτα → μετά τον ' + monthLabel_(b.until) + ' δεν ετοιμάζεται νέο πρόγραμμα.');
    }
    if (cur > b.until && !paying && cprop_(K, 'FREE_ENDED', '') !== b.until) {
      P_().setProperty('FREE_ENDED_' + K, b.until);
      systemNotify_('Δωρεάν: έληξε για ' + who, 'Ο δωρεάν χρόνος του ' + who + ' τελείωσε με τον ' + monthLabel_(b.until) + ' και δεν υπάρχει συνδρομή. ' +
        'Νέο πρόγραμμα δεν ετοιμάζεται. Για συνέχεια: «χρέωσέ τον» ή «δωρεάν έως …» στο Claude.');
    }
  });
}

function prevYm_(ym) { const p = String(ym).split('-').map(Number); return p[1] === 1 ? (p[0] - 1) + '-12' : p[0] + '-' + ('0' + (p[1] - 1)).slice(-2); }

// Ο πελάτης περνά σε «Δωρεάν»: κάθε απλήρωτος μήνας ακυρώνεται, καμία νέα χρέωση/υπενθύμιση/παύση, email στον πελάτη.
// Επιστρέφει τους μήνες που ακυρώθηκαν ([] αν δεν υπήρχε τίποτα απλήρωτο).
function billingCancelUnpaid_(K, by) {
  const st = billState_(K);
  if (!st) return [];
  if (st.offer && !st.offer.closed) {                // ανοιχτό «Συνεχίζουμε;»: κλείνει (οι σύνδεσμοι ελέγχονται ακόμα, βλ. παρακάτω)
    st.offer.closed = new Date().toISOString();
    st.offer.cancelled = true;
    billSave_(K, st);
    billLog_(K, '', 0, 'δωρεάν εβδομάδα: σύνδεσμοι ακυρώθηκαν', 'πέρασε σε «Δωρεάν» (' + by + ')', '');
    return ['offer'];
  }
  const months = st.months || {}, cancelled = [];
  Object.keys(months).sort().forEach(function (m) {
    if (months[m].st === 'pending' || months[m].st === 'charging') { months[m].st = 'cancelled'; months[m].cancelled_at = new Date().toISOString(); cancelled.push(m); }
  });
  const stop = prevYm_(cancelled.length ? cancelled[0] : (st.start || ym_(new Date())));
  if (!st.stop_after || st.stop_after > stop) st.stop_after = stop;
  billSave_(K, st);
  P_().deleteProperty('BILLING_PAUSED_' + K);
  if (cancelled.length) {
    billLog_(K, cancelled.join(', '), 0, 'σύνδεσμος ακυρώθηκε', 'πέρασε σε «Δωρεάν» (' + by + ')', '');
    notify_(K, 'Ο σύνδεσμος πληρωμής ακυρώθηκε', 'Ο σύνδεσμος πληρωμής για ' + cancelled.map(function (x) { return perFor_(st, x); }).join(', ') +
      ' δεν χρειάζεται πια: δεν χρειάζεται να κάνετε τίποτα και δεν θα γίνει καμία χρέωση. Οι δημοσιεύσεις σας συνεχίζονται κανονικά.');
  }
  return cancelled;
}

function nextYm_(ym) { const p = String(ym).split('-').map(Number); return p[1] === 12 ? (p[0] + 1) + '-01' : p[0] + '-' + ('0' + (p[1] + 1)).slice(-2); }
// «Η επόμενη χρέωση…» μόνο αν θα υπάρξει (όχι μετά από λύση).
function nextChargeText_(st, m) {
  const n = nextYm_(m);
  return st.stop_after && n > st.stop_after ? '' : 'Η επόμενη χρέωση, για ' + perFor_(st, n) + ', γίνεται αυτόματα ' +
    (billDay_(st) === 1 ? 'την 1η του μήνα' : 'στις ' + dm_(perStart_(st, n), true)) + '. ';
}
function chargeDayText_(st) { return billDay_(st) === 1 ? 'την 1η του μήνα' : 'στις ' + billDay_(st) + ' κάθε μήνα'; }
function monthNom_(ym) { const p = String(ym).split('-'); return BILL_.MONTHS_NOM[Number(p[1]) - 1] + ' ' + p[0]; }   // «Ο Ιανουάριος 2027 …»
function monthLabel_(ym) { const p = String(ym).split('-'); return BILL_.MONTHS[Number(p[1]) - 1] + ' ' + p[0]; }
function euros_(cents) { return (cents / 100).toFixed(2).replace('.', ','); }
// CLIENTS + TEST_CLIENTS (ο TST δεν δημοσιεύει ποτέ: χρήσιμος για δοκιμή πληρωμών στη demo της Viva).
function billingClients_() {
  return approvalClients_().filter(function (K) { return !!billState_(K); }).concat(agencyKeys_());
}

function billLog_(K, month, cents, action, result, code, pay) {
  try {
    const st = billState_(K) || {};
    billSheet_().appendRow([new Date(), K, month, cents ? cents / 100 : '', action, String(result || '').slice(0, 300), String(code || ''),
      String(pay || ''), String(st.code || ''), clientName_(K), String(st.plan || '')]);
  } catch (e) { console.log('Πληρωμές (Sheet): ' + e.message); }
}

// Η καρτέλα «Πληρωμές»· οι νέες στήλες μπαίνουν στο τέλος της επικεφαλίδας (οι παλιές δεν μετακινούνται).
function billSheet_() {
  const sh = sheet_(BILL_.SHEET, BILL_.HEAD);
  const h = sh.getRange(1, 1, 1, BILL_.HEAD.length).getValues()[0];
  if (String(h[BILL_.HEAD.length - 1] || '') !== BILL_.HEAD[BILL_.HEAD.length - 1]) sh.getRange(1, 1, 1, BILL_.HEAD.length).setValues([BILL_.HEAD]);
  return sh;
}

// Νέος κωδικός πληρωμής: PAY-0001, PAY-0002, … (ποτέ ξανά ο ίδιος· τον καλεί μόνο ο κύκλος πληρωμών, με κλειδαριά).
function newPayId_() {
  const n = Number(prop_('PAY_SEQ', '0')) + 1;
  P_().setProperty('PAY_SEQ', String(n));
  return BILL_.PAY_PREFIX + ('000' + n).slice(-Math.max(4, String(n).length));
}

// Κωδικός πελάτη (OK-…): από τη συνδρομή, αλλιώς από το config.json του publisher-work (και κρατιέται στη συνδρομή).
function billCode_(K, st) {
  if (!st.code) { try { const c = ghJson_('clients/' + K + '/config.json'); if (c && c.code) st.code = String(c.code); } catch (e) { /* χωρίς κωδικό */ } }
  return st.code || '';
}

// Η πληρωμή του μήνα m έγινε: κωδικός πληρωμής, πακέτο και ποσό εκείνης της πληρωμής. Επιστρέφει τη γραμμή για το email.
function markPaid_(K, st, m, tx) {
  const rec = st.months[m];
  rec.st = 'paid'; rec.tx = tx; rec.paid_at = new Date().toISOString();
  rec.pay = newPayId_(); rec.plan = st.plan; rec.amount = st.amount;
  billCode_(K, st);
  billSave_(K, st);
  return 'Κωδικός πληρωμής: ' + rec.pay + (st.code ? ' · Πελάτης: ' + st.code : '') + ' · Πακέτο: ' + st.plan + ' · ' + perNom_(st, m) + '.';
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

// ---------------------------------------------------------------- «Συνεχίζουμε;» μετά τη δωρεάν εβδομάδα (από 26/11/2026)
// billing_start { trial: true, trial_start: "2027-01-12", plan, code } με not_before = 5η μέρα 10:00 και ΧΩΡΙΣ start:
// email με ένα κουμπί πληρωμής για κάθε πακέτο (σύνδεσμοι Viva). Υπενθυμίσεις την 6η, την 7η (τελευταία μέρα της
// εβδομάδας) και τη 10η· ο σύνδεσμος μένει ανοιχτός ως και τη 14η μέρα, μετά κλείνει (email + ειδοποίηση στο okpublisher).
// Μόλις πληρώσει: «η μέρα του» = η μέρα της πληρωμής (29–31 → 1η του επόμενου), η 1η περίοδος πληρωμένη, config.json
// στο publisher-work (billing.day, package) και η παραγωγή της 1ης περιόδου ξεκινά αμέσως (RUNBOOK §2).
// «Χρέωση» από το διαχειριστικό (billing_start { open: true, plan }): το ίδιο με ένα πακέτο, από σήμερα· υπενθυμίσεις
// την 4η και την 8η μέρα, κλείσιμο μετά τη 14η. Πληρωμή → όπως πάνω (μέρα πελάτη, 1η περίοδος, άμεση παραγωγή).
const OFFER_ = { REMIND: [6, 7, 10], REMIND_CHARGE: [4, 8], LAST_DAY: 14, HOUR: 10 };

function offerStart_(K, req, res) {
  const kind = req.trial ? 'trial' : 'charge';
  if (kind === 'trial' && !/^\d{4}-\d{2}-\d{2}$/.test(String(req.trial_start || ''))) throw new Error('billing_start (δωρεάν εβδομάδα): λείπει το trial_start ("2027-01-12")');
  if (!String(cprop_(K, 'NOTIFY_TO', '')).trim()) throw new Error('Λείπει το NOTIFY_TO_' + K);
  const old = billState_(K);
  if (old && old.tx && old.start && !old.offer && !old.stop_after) throw new Error('billing_start: ο πελάτης έχει ήδη ενεργή συνδρομή');
  const p = planOf_(req.plan) || (kind === 'trial' ? planOf_('Μεσαίο') : null);
  if (!p) throw new Error('billing_start: άγνωστο πακέτο');
  const months = {};
  Object.keys((old && old.months) || {}).forEach(function (m) { if (old.months[m].st === 'paid') months[m] = old.months[m]; });
  const st = { plan: p.name, amount: planCents_(p), start: null, stop_after: null, tx: (old && old.tx) || null, months: months,
    offer: { kind: kind, trial_start: kind === 'trial' ? String(req.trial_start) : athens_(new Date(), 'yyyy-MM-dd'), chosen: p.name,
      plans: kind === 'trial' ? BILL_.PLANS.map(function (x) { return x.name; }) : [p.name],
      orders: (old && old.offer && old.offer.orders) || {}, sent: {}, at: new Date().toISOString() } };   // παλιοί σύνδεσμοι: ελέγχονται ακόμα
  if (req.code && /^OK-\d{4,}$/.test(String(req.code))) st.code = String(req.code);
  else if (old && old.code) st.code = old.code;
  const links = offerLinks_(K, st);              // αν η Viva αρνηθεί, δεν αποθηκεύεται τίποτα
  const idx = offerDay_(st, new Date());
  offerRemind_(st).concat([1, 5]).forEach(function (d) { if (d <= idx) st.offer.sent['d' + d] = new Date().toISOString(); });
  billSave_(K, st);
  P_().deleteProperty('BILLING_PAUSED_' + K);
  offerEmail_(K, st, kind === 'charge' ? 'c1' : (idx >= 7 ? 'd7' : 'd5'), links);
  billLog_(K, '', kind === 'charge' ? st.amount : 0, kind === 'charge' ? 'σύνδεσμος πληρωμής (ξεκινά με την πληρωμή)' : 'δωρεάν εβδομάδα: «Συνεχίζουμε;»',
    'σύνδεσμοι για ' + Object.keys(links).join(', '), '');
  res.links = links;
  if (kind === 'charge') res.link = links[p.name];
}
function offerRemind_(st) { return st.offer.kind === 'charge' ? OFFER_.REMIND_CHARGE : OFFER_.REMIND; }

// Πόσο μέσα στη δωρεάν εβδομάδα (1 = η πρώτη μέρα της).
function offerDay_(st, now) { return Math.round((utc_(athens_(now, 'yyyy-MM-dd')) - utc_(st.offer.trial_start)) / 86400000) + 1; }

// Ένας σύνδεσμος πληρωμής ανά πακέτο· νέος αν ο προηγούμενος είναι παλιός (λήγει σε 5 ημέρες).
function offerLinks_(K, st) {
  const out = {};
  if (st.agency) {                                   // agency: ένας σύνδεσμος για το άθροισμα (Agency.gs)
    const rec = st.offer.orders.Agency = st.offer.orders.Agency || {};
    const age = rec.order_at ? (Date.now() - new Date(rec.order_at).getTime()) / 86400000 : 999;
    if (!rec.order || age > BILL_.LINK_REFRESH_DAYS || rec.amount !== st.amount) {
      if (rec.order) (rec.old_orders = rec.old_orders || []).push(rec.order);
      rec.order = vivaCreateOrder_(K, { plan: st.plan, amount: st.amount }, 'start', 'πρώτος μήνας');
      rec.order_at = new Date().toISOString();
      rec.amount = st.amount;
    }
    out.Agency = vivaLink_(rec.order);
    return out;
  }
  BILL_.PLANS.filter(function (p) { return (st.offer.plans || BILL_.PLANS.map(function (x) { return x.name; })).indexOf(p.name) >= 0; }).forEach(function (p) {
    const rec = st.offer.orders[p.name] = st.offer.orders[p.name] || {};
    const age = rec.order_at ? (Date.now() - new Date(rec.order_at).getTime()) / 86400000 : 999;
    if (!rec.order || age > BILL_.LINK_REFRESH_DAYS) {
      if (rec.order) (rec.old_orders = rec.old_orders || []).push(rec.order);
      rec.order = vivaCreateOrder_(K, { plan: p.name, amount: planCents_(p) }, 'start', 'πρώτος μήνας');
      rec.order_at = new Date().toISOString();
    }
    out[p.name] = vivaLink_(rec.order);
  });
  return out;
}

function offerEmail_(K, st, kind, links) {
  if (st.agency) { agencyOfferEmail_(K, st, kind, links); return; }
  const until = dm_(addDays_(st.offer.trial_start, OFFER_.LAST_DAY - 1));
  const T = {
    d5: ['Πώς σας φάνηκε η δωρεάν εβδομάδα; Συνεχίζουμε;', 'Ελπίζουμε να σας αρέσουν οι δημοσιεύσεις της δωρεάν εβδομάδας!\n\n' +
      'Αν θέλετε να συνεχίσουμε, διαλέξτε πακέτο και πληρώστε με κάρτα: ξεκινάμε αμέσως. Ετοιμάζουμε το πρόγραμμα των επόμενων 30 ημερών ' +
      'και σας το στέλνουμε για ΟΚ μέσα σε 1–2 μέρες.'],
    d6: ['Συνεχίζουμε;', 'Μια μικρή υπενθύμιση: αν θέλετε να συνεχίσουμε μετά τη δωρεάν εβδομάδα, διαλέξτε πακέτο και πληρώστε με κάρτα. Ξεκινάμε αμέσως.'],
    d7: ['Σήμερα τελειώνει η δωρεάν εβδομάδα', 'Σήμερα είναι η τελευταία μέρα της δωρεάν εβδομάδας. Αν θέλετε να συνεχίσουμε, διαλέξτε πακέτο ' +
      'και πληρώστε με κάρτα (οι σύνδεσμοι ισχύουν ως τις ' + until + '). Ξεκινάμε αμέσως.'],
    d10: ['Τελευταία υπενθύμιση: συνεχίζουμε;', 'Οι σύνδεσμοι για να συνεχίσουμε ισχύουν ως τις ' + until + '. Μόλις πληρώσετε, ξεκινάμε αμέσως.'],
    c1: ['Πληρωμή συνδρομής: ξεκινάμε μόλις πληρώσετε', 'Για να ξεκινήσει η συνδρομή σας, πληρώστε με κάρτα με τον σύνδεσμο παρακάτω. ' +
      'Μόλις γίνει η πληρωμή, ετοιμάζουμε το πρόγραμμα των επόμενων 30 ημερών και σας το στέλνουμε για ΟΚ μέσα σε 1–2 μέρες. ' +
      'Ο σύνδεσμος ισχύει ως τις ' + until + '.'],
    c4: ['Υπενθύμιση πληρωμής', 'Μια μικρή υπενθύμιση: η συνδρομή σας ξεκινά μόλις πληρώσετε με τον σύνδεσμο παρακάτω (ισχύει ως τις ' + until + ').'],
    c8: ['Τελευταία υπενθύμιση πληρωμής', 'Ο σύνδεσμος πληρωμής ισχύει ως τις ' + until + '. Μόλις πληρώσετε, ξεκινάμε αμέσως.'],
  }[kind];
  const charge = st.offer.kind === 'charge';
  const pl = BILL_.PLANS.map(function (p) {
    return p.name + ' · €' + euros_(planCents_(p)) + ' τον μήνα με ΦΠΑ (' + p.week + ' posts + ' + p.week + ' stories την εβδομάδα)' +
      (p.name === st.offer.chosen && !charge ? ' · αυτό που διαλέξατε' : '') + ': ' + links[p.name];
  }).filter(function (x, i) { return !!links[BILL_.PLANS[i].name]; });
  const rest = 'Η χρέωση γίνεται μετά αυτόματα κάθε μήνα, την ίδια μέρα με την πρώτη πληρωμή. Τα στοιχεία της κάρτας τα κρατά η Viva, όχι εμείς. ' +
    'Η συνδρομή σταματά όποτε θέλετε, με ένα κουμπί σε κάθε email πληρωμής.\n\n' + (charge
      ? 'Θέλετε άλλο πακέτο ή έχετε απορία; Απαντήστε σε αυτό το email.'
      : 'Αν δεν συνεχίσουμε, δεν χρειάζεται να κάνετε τίποτα: μετά τις ' + until + ' αφαιρούμε την πρόσβασή μας και σβήνουμε τα στοιχεία σας ' +
        'μέσα σε 30 ημέρες. Ό,τι δημοσιεύτηκε μένει στη σελίδα σας. Για οτιδήποτε, απαντήστε σε αυτό το email.');
  const btn = function (p) {
    const on = p.name === st.offer.chosen;
    if (!links[p.name]) return '';
    return '<a href="' + esc_(links[p.name]) + '" style="display:block;max-width:420px;padding:12px 18px;margin:0 0 10px;border:2px solid #5B21D6;' +
      'border-radius:16px;text-decoration:none;color:' + (on ? '#fff' : '#5B21D6') + ';background:' + (on ? '#5B21D6' : '#fff') + '"><b>' + esc_(p.name) +
      '</b> · €' + euros_(planCents_(p)) + ' τον μήνα με ΦΠΑ<br><span style="font-size:14px">' + p.week + ' posts + ' + p.week + ' stories την εβδομάδα' +
      (on && !charge ? ' · αυτό που διαλέξατε' : '') + '</span></a>';
  };
  const html = '<div style="font:15px/1.6 Arial,sans-serif;color:#14162E"><p>' + esc_(T[1]).replace(/\n/g, '<br>') + '</p>' +
    BILL_.PLANS.map(btn).join('') + '<p style="color:#4A4C66">' + esc_(rest).replace(/\n/g, '<br>') + '</p></div>';
  notify_(K, T[0], T[1] + '\n\n' + pl.join('\n') + '\n\n' + rest, html);
}

// Κάθε ώρα: πληρώθηκε κάποιος σύνδεσμος; Αλλιώς υπενθυμίσεις (από τις 10:00) και κλείσιμο μετά τη 14η μέρα.
function offerClient_(K, st, now) {
  vivaNeed_(['VIVA_CLIENT_ID', 'VIVA_CLIENT_SECRET', 'VIVA_MERCHANT_ID', 'VIVA_API_KEY']);
  const o = st.offer;
  // Πληρωμή: και μετά το κλείσιμο, όσο ένας σύνδεσμος μπορεί ακόμα να πληρωθεί (για να μη χαθεί πληρωμή).
  const fresh = function (at) { return Date.now() - new Date(at || 0).getTime() < (BILL_.LINK_SECONDS / 86400 + 2) * 86400000; };
  const names = Object.keys(o.orders);
  for (let i = 0; i < names.length; i++) {
    const rec = o.orders[names[i]], codes = [rec.order].concat(rec.old_orders || []).filter(String);
    if (!fresh(rec.order_at)) continue;
    for (let j = 0; j < codes.length; j++) {
      const paid = vivaPaidTx_(codes[j]);
      if (paid) {
        const late = o.closed ? (o.cancelled ? 'ακυρωμένο (πέρασε σε «Δωρεάν»)' : 'κλειστό (μετά τη 14η μέρα)') : '';
        offerPaid_(K, st, names[i], codes[j], paid, now);
        if (late) systemNotify_('Πληρώθηκε σύνδεσμος που είχε κλείσει: ' + K, 'Ο ' + K + ' πλήρωσε σύνδεσμο που ήταν ' + late + '. Η συνδρομή ξεκίνησε ' +
          'κανονικά (config «paid»). Αν δεν το θέλεις: «Διακοπή συνδρομής» στο διαχειριστικό και επιστροφή από τη Viva.');
        return;
      }
    }
  }
  if (o.closed) return;
  const idx = offerDay_(st, now);
  if (Number(athens_(now, 'HH')) < OFFER_.HOUR) return;
  if (idx > OFFER_.LAST_DAY) {
    o.closed = new Date().toISOString();
    billSave_(K, st);
    const who = (st.code ? st.code + ' · ' : '') + clientName_(K) + ' (' + K + ')';
    if (o.kind === 'charge') {
      billLog_(K, '', 0, 'σύνδεσμος πληρωμής: έκλεισε', 'δεν πληρώθηκε έως τη ' + OFFER_.LAST_DAY + 'η μέρα', '');
      notify_(K, 'Ο σύνδεσμος πληρωμής έληξε', 'Ο σύνδεσμος πληρωμής της συνδρομής σας έληξε χωρίς πληρωμή, οπότε η συνδρομή δεν ξεκίνησε και δεν χρωστάτε τίποτα. ' +
        'Αν θέλετε να ξεκινήσουμε, απαντήστε σε αυτό το email και σας στέλνουμε νέο σύνδεσμο.');
      systemNotify_('Δεν πλήρωσε τη «Χρέωση»: ' + K, 'Ο ' + who + ' δεν πλήρωσε ως τη ' + OFFER_.LAST_DAY + 'η μέρα (' + o.chosen + '). Πήρε email ότι ο σύνδεσμος έληξε. ' +
        'Αν ήταν δωρεάν, μένει όπως ήταν. Νέα «Χρέωση» από το διαχειριστικό όποτε θέλεις.');
      return;
    }
    billLog_(K, '', 0, 'δωρεάν εβδομάδα: έκλεισε', 'δεν πληρώθηκε έως τη ' + OFFER_.LAST_DAY + 'η μέρα', '');
    notify_(K, 'Ευχαριστούμε που δοκιμάσατε το okpublisher', 'Ευχαριστούμε που δοκιμάσατε το okpublisher! Κλείσαμε τους συνδέσμους πληρωμής ' +
      'και δεν χρωστάτε τίποτα. Αφαιρούμε την πρόσβασή μας και σβήνουμε τα στοιχεία σας μέσα σε 30 ημέρες· ό,τι δημοσιεύτηκε μένει στη σελίδα σας.\n\n' +
      'Αν θέλετε να συνεχίσουμε κάποια στιγμή, απλώς απαντήστε σε αυτό το email.');
    systemNotify_('Δεν συνέχισε μετά τη δωρεάν εβδομάδα: ' + K, 'Ο ' + who + ' δεν πλήρωσε ως τη ' +
      OFFER_.LAST_DAY + 'η μέρα. Πήρε email ευχαριστίας. Επόμενα (όροι Α.4/Α.8): αφαίρεση πρόσβασης (σελίδα, Instagram, Drive), «active»: false στο config, ' +
      'διαγραφή δεδομένων σε 30 ημέρες.');
    return;
  }
  const due = offerRemind_(st).filter(function (d) { return idx >= d && !o.sent['d' + d]; });
  if (!due.length) return;
  due.forEach(function (d) { o.sent['d' + d] = new Date().toISOString(); });
  const links = offerLinks_(K, st);
  billSave_(K, st);
  offerEmail_(K, st, (o.kind === 'charge' ? 'c' : 'd') + due[due.length - 1], links);
}

function offerPaid_(K, st, planName, order, paid, now) {
  if (st.agency) { agencyPaid_(K, st, order, paid, now); return; }
  const p = planOf_(planName);
  let m = ym_(now), d = Number(athens_(now, 'd'));
  if (d > 28) { m = nextYm_(m); d = 1; }       // 29–31: η μέρα του γίνεται η 1η (κερδίζει 1–3 μέρες)
  st.plan = p.name; st.amount = planCents_(p); st.start = m; st.tx = paid.tx;
  if (d > 1) st.day = d; else delete st.day;
  st.trial = { kind: st.offer.kind || 'trial', start: st.offer.trial_start, paid_at: new Date().toISOString(), chosen: st.offer.chosen };
  delete st.offer;
  st.months[m] = { st: 'pending', order: order };
  const payLine = markPaid_(K, st, m, paid.tx);
  const trial = st.trial.kind !== 'charge';
  billLog_(K, m, st.amount, trial ? 'πληρωμή μετά τη δωρεάν εβδομάδα' : 'πρώτη πληρωμή (σύνδεσμος)', 'πληρώθηκε · μέρα χρέωσης ' + billDay_(st), paid.tx, st.months[m].pay);
  const cfg = offerRepo_(K, st);
  billNotify_(K, 'Ξεκινάμε! Λάβαμε την πληρωμή', 'Ευχαριστούμε! Λάβαμε την πληρωμή (' + st.plan + ', €' + euros_(st.amount) + ' με ΦΠΑ) και ξεκινάμε. ' +
    'Ετοιμάζουμε τώρα το πρόγραμμα της πρώτης περιόδου (' + perRange_(st, m) + ') και σας το στέλνουμε για ΟΚ μέσα σε 1–2 μέρες. ' +
    nextChargeText_(st, m) + '\n\n' + payLine);
  try { referralAward_(K, st); } catch (e) { console.log('σύσταση ' + K + ': ' + e.message); }
  systemNotify_((trial ? 'Πλήρωσε μετά τη δωρεάν εβδομάδα: ' : 'Πλήρωσε: ') + K, (st.code ? st.code + ' · ' : '') + clientName_(K) + ' (' + K + '): ' + st.plan + ', περίοδος ' +
    perRange_(st, m) + ', χρέωση ' + chargeDayText_(st) + '. Η παραγωγή της 1ης περιόδου ξεκινά στον επόμενο κύκλο (RUNBOOK §2).' + cfg);
}

// clients/<K>/config.json στο publisher-work: billing { type: paid, day, start } και package (για την παραγωγή). '' αν όλα καλά.
function offerRepo_(K, st) {
  try {
    if (!prop_('GITHUB_TOKEN', '')) return '\n\n(Χωρίς GITHUB_TOKEN: ενημέρωσε το config.json με το χέρι.)';
    const path = 'clients/' + K + '/config.json', cfg = ghJson_(path);
    if (!cfg) return '\n\n(Δεν βρέθηκε ' + path + ': ενημέρωσέ το με το χέρι.)';
    cfg.billing = { type: 'paid', day: billDay_(st), start: perStart_(st, st.start) };
    cfg.package = st.plan;
    ghPutJson_(path, cfg, 'Πληρωμή ' + K + ': ' + st.plan + ', μέρα ' + billDay_(st));
    try { CacheService.getScriptCache().remove(ADM_.CLIENTS_KEY); } catch (e) { /* μένει 5′ */ }
    return '';
  } catch (e) { return '\n\n(config.json: ' + e.message + ' — ενημέρωσέ το με το χέρι.)'; }
}

// ------------------------------------------------------------------ αιτήματα από το outbox
function billingRequest_(K, req, res) {
  if (req.type === 'billing_start') {
    if ((req.trial || req.open) && !req.start) { offerStart_(K, req, res); return; }
    const amount = Math.round(Number(req.amount_eur) * 100);
    if (!(amount >= 100 && amount <= 200000)) throw new Error('billing_start: άκυρο ποσό (amount_eur, με ΦΠΑ)');
    // start: "ΕΕΕΕ-ΜΜ" (από την 1η) ή "ΕΕΕΕ-ΜΜ-ΗΗ" (η μέρα του πελάτη· 29–31 → 1η του επόμενου μήνα).
    let day = 1;
    const sd = /^(\d{4}-\d{2})-(\d{2})$/.exec(String(req.start || ''));
    if (sd) { day = Number(sd[2]); req.start = sd[1]; if (day > 28) { req.start = nextYm_(req.start); day = 1; } }
    if (!/^\d{4}-\d{2}$/.test(String(req.start || '')) || day < 1) throw new Error('billing_start: λείπει ο πρώτος μήνας (start: "2027-02" ή "2027-02-14")');
    if (!req.plan) throw new Error('billing_start: λείπει το πακέτο');
    const free = req.free_month == null ? null : String(req.free_month);
    if (free !== null && (!/^\d{4}-\d{2}$/.test(free) || free >= req.start)) throw new Error('billing_start: ο δωρεάν μήνας (free_month) πρέπει να είναι πριν από τον start');
    if (!String(cprop_(K, 'NOTIFY_TO', '')).trim()) throw new Error('Λείπει το NOTIFY_TO_' + K);
    const old = billState_(K);
    if (old && old.tx && !old.stop_after) throw new Error('billing_start: ο πελάτης έχει ήδη ενεργή συνδρομή');
    // Από την παλιά κατάσταση κρατάμε μόνο ό,τι πληρώθηκε (ιστορικό)· τίποτα μισό ή απλήρωτο.
    const months = {};
    Object.keys((old && old.months) || {}).forEach(function (m) { if (old.months[m].st === 'paid') months[m] = old.months[m]; });
    if (months[req.start]) throw new Error('billing_start: ο μήνας ' + req.start + ' έχει ήδη πληρωθεί');
    const st = { plan: String(req.plan), amount: amount, start: req.start, stop_after: null, tx: (old && old.tx) || null, months: months };
    if (day > 1) st.day = day;
    if (req.code && /^OK-\d{4,}$/.test(String(req.code))) st.code = String(req.code);
    else if (old && old.code) st.code = old.code;
    if (free) st.free_month = free;
    st.months[req.start] = { st: 'pending' };
    const link = freshLink_(K, st, req.start);   // αν η Viva αρνηθεί, δεν αποθηκεύεται τίποτα
    billSave_(K, st);
    P_().deleteProperty('BILLING_PAUSED_' + K);  // οι απλήρωτοι μήνες της παλιάς κατάστασης δεν μετράνε πια
    const plan = 'Πακέτο: ' + st.plan + ' · €' + euros_(amount) + ' τον μήνα (με ΦΠΑ).\n' +
      'Πληρωμή με κάρτα, με ασφάλεια μέσω Viva: ' + link + '\n\n';
    const card = 'Τα στοιχεία της κάρτας τα κρατά η Viva, όχι εμείς. ';
    if (req.trial) {
      notify_(K, 'Πώς σας φάνηκε η δωρεάν εβδομάδα; Συνεχίζουμε;',
        'Ελπίζουμε να σας άρεσαν οι δημοσιεύσεις της δωρεάν εβδομάδας!\n\n' +
        'Αν θέλετε να συνεχίσουμε, πληρώνετε ' + perFor_(st, req.start) + ' και ξεκινάμε την 1η του μήνα.\n\n' + plan +
        nextChargeText_(st, req.start) + card + 'Η συνδρομή σταματά όποτε θέλετε, με ένα email ' + stopRule_(st) + '.\n\n' +
        'Θέλετε άλλο πακέτο; Απαντήστε σε αυτό το email. Αν δεν συνεχίσουμε, δεν χρειάζεται να κάνετε τίποτα: ' +
        'αφαιρούμε την πρόσβασή μας και σβήνουμε τα στοιχεία σας μέσα σε 30 ημέρες.');
    } else if (free) {
      notify_(K, 'Καλώς ήρθατε: πληρωμή για ' + perFor_(st, req.start),
        'Καλώς ήρθατε στο okpublisher!\n\n' +
        'Ο ' + monthNom_(free) + ' είναι δώρο μας. Για να ξεκινήσει, πληρώνετε τώρα ' + perFor_(st, req.start) + ' (όροι, Α.4).\n\n' + plan +
        'Μόλις γίνει η πληρωμή, ξεκινάμε να ετοιμάζουμε ' + perFor_(st, free) + '. ' + nextChargeText_(st, req.start) + card +
        'Μετά ' + perFor_(st, req.start) + ' η συνδρομή σταματά όποτε θέλετε, με ένα email ' + stopRule_(st) + '.');
    } else {
      billNotify_(K, 'Πληρωμή συνδρομής για ' + perFor_(st, req.start),
        'Ευχαριστούμε που συνεχίζουμε μαζί!\n\n' + plan + nextChargeText_(st, req.start) + card +
        'Η συνδρομή σταματά όποτε θέλετε, με ένα email ' + stopRule_(st) + '.');
    }
    res.order_code = st.months[req.start].order;
    res.link = link;
    return;
  }
  if (req.type === 'test_client_remove') {
    testClientRemove_(K, res);
    return;
  }
  if (req.type === 'billing_stop') {
    const st = billState_(K);
    if (!st) throw new Error('billing_stop: δεν υπάρχει συνδρομή');
    if (!/^\d{4}-\d{2}$/.test(String(req.after || ''))) throw new Error('billing_stop: λείπει ο τελευταίος μήνας (after: "2027-05")');
    billingStop_(K, st, req.after, !!req.quiet, 'αίτημα');
    res.stop_after = req.after;
    return;
  }
  throw new Error('Άγνωστο αίτημα πληρωμής: ' + req.type);
}

// ------------------------------------------------------------------ κύκλος
function setupBilling() { manualOnly_('setupBilling');
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'billingCycle') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('billingCycle').timeBased().everyHours(BILL_.EVERY_H).create();
  billSheet_();
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
    try { freeCycle_(new Date()); } catch (e) { console.log('Δωρεάν πελάτες: ' + e.message); }
    try { admRefNotify_(); } catch (e) { console.log('Email πωλητών: ' + e.message); }
    try { agencySync_(); } catch (e) { console.log('Agencies: ' + e.message); }
    try { siteScanCycle_(); } catch (e) { console.log('Ιστοσελίδες πελατών: ' + e.message); }
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
  if (st.offer) { offerClient_(K, st, now); return; }                      // μετά τη δωρεάν εβδομάδα: «Συνεχίζουμε;»
  if (!st.start) return;
  if (st.change && periodOf_(st, now) >= st.change.from) applyPlanChange_(K, st);   // αλλαγή πακέτου: πριν από κάθε χρέωση της περιόδου
  // Χωρίς όλα τα κλειδιά δεν γίνεται τίποτα (και δεν μένει καμία χρέωση «στη μέση»).
  vivaNeed_(['VIVA_CLIENT_ID', 'VIVA_CLIENT_SECRET', 'VIVA_MERCHANT_ID', 'VIVA_API_KEY']);
  st.months = st.months || {};
  const months = Object.keys(st.months).sort();

  // 1. Παραγγελίες σε αναμονή: πληρώθηκαν; (κάθε ώρα, ώστε η επανεκκίνηση να είναι γρήγορη)
  months.forEach(function (m) {
    const rec = st.months[m];
    // Ακυρωμένος σύνδεσμος (ο πελάτης πέρασε σε «Δωρεάν»): ελέγχεται ακόμα όσο μπορεί να πληρωθεί, για να μη χαθεί πληρωμή.
    const late = rec.st === 'cancelled' && rec.order && rec.cancelled_at &&
      Date.now() - new Date(rec.cancelled_at).getTime() < (BILL_.LINK_SECONDS / 86400 + 2) * 86400000;
    if (late) {
      const orders0 = [rec.order].concat(rec.old_orders || []);
      for (let i = 0; i < orders0.length; i++) {
        const p0 = vivaPaidTx_(orders0[i]);
        if (!p0) continue;
        st.tx = p0.tx;
        markPaid_(K, st, m, p0.tx);
        billLog_(K, m, st.amount, 'πληρωμή ακυρωμένου συνδέσμου', 'πληρώθηκε', p0.tx, rec.pay);
        systemNotify_('Πληρώθηκε ακυρωμένος σύνδεσμος: ' + K, 'Ο ' + K + ' πλήρωσε ' + perFor_(st, m) + ' (' + rec.pay + ', €' + euros_(st.amount) +
          ') με σύνδεσμο που είχε ακυρωθεί (πέρασε σε «Δωρεάν»). Αποφάσισε: επιστροφή από τη Viva ή κανονική συνδρομή από το διαχειριστικό.');
        return;
      }
      return;
    }
    if (rec.st !== 'pending' || !rec.order) return;
    const orders = [rec.order].concat(rec.old_orders || []);
    for (let i = 0; i < orders.length; i++) {
      const p = vivaPaidTx_(orders[i]);
      if (!p) continue;
      st.tx = p.tx;     // η τελευταία πληρωμή με κάρτα γίνεται η βάση για τις επόμενες χρεώσεις
      const payLine = markPaid_(K, st, m, p.tx);
      billLog_(K, m, st.amount, 'πληρωμή με σύνδεσμο', 'πληρώθηκε', p.tx, rec.pay);
      if (billPaused_(K) && !months.some(function (x) { return x !== m && st.months[x].st === 'pending'; })) {
        P_().deleteProperty('BILLING_PAUSED_' + K);
        billLog_(K, m, 0, 'επανεκκίνηση', 'οι δημοσιεύσεις συνεχίζονται', '');
        billNotify_(K, 'Η πληρωμή έγινε: οι δημοσιεύσεις συνεχίζονται', 'Λάβαμε την πληρωμή για ' + perFor_(st, m) + ' (€' + euros_(st.amount) + ' με ΦΠΑ). Οι δημοσιεύσεις σας συνεχίζονται κανονικά. Ευχαριστούμε!\n\n' + payLine);
      } else {
        billNotify_(K, 'Λάβαμε την πληρωμή για ' + perFor_(st, m), 'Λάβαμε την πληρωμή της συνδρομής σας για ' + perFor_(st, m) + ' (' + st.plan + ', €' + euros_(st.amount) + ' με ΦΠΑ). ' +
          (st.free_month && m === st.start ? 'Ο ' + monthNom_(st.free_month) + ' είναι δώρο μας: ξεκινάμε να τον ετοιμάζουμε. ' : '') +
          nextChargeText_(st, m) + 'Ευχαριστούμε!\n\n' + payLine);
      }
      return;
    }
  });

  const hour = Number(athens_(now, 'HH'));
  if (hour < BILL_.ACT_HOUR) return;
  const m = periodOf_(st, now), day = periodDay_(st, now, m);   // day: πόσο μέσα στην περίοδο (1 = η μέρα χρέωσης)
  if (m < st.start || (st.stop_after && m > st.stop_after)) return;

  // 2. Νέος μήνας: αυτόματη χρέωση (μόνο αν δεν χρωστάει προηγούμενο μήνα).
  let rec = st.months[m];
  if (!rec) {
    if (Object.keys(st.months).some(function (x) { return x < m && st.months[x].st === 'pending'; })) return;
    if (st.amount_full) { st.amount = st.amount_full; delete st.amount_full; delete st.referral_use; }   // μετά από περίοδο με έκπτωση σύστασης
    if (st.agency && !agencyPeriod_(K, st, m)) return;   // agency: ποσό από τους πελάτες της τώρα (Agency.gs)
    if (!st.agency && referralApply_(K, st, m)) return;  // έκπτωση σύστασης (Referral.gs): όλη η περίοδος → χωρίς χρέωση
    if (st.tx) {
      st.months[m] = rec = { st: 'charging', at: new Date().toISOString() };
      billSave_(K, st);                                   // πριν από τη χρέωση: ποτέ δεύτερη για τον ίδιο μήνα
      const c = vivaCharge_(st, K, m);
      if (c.ok) {
        const payLine = markPaid_(K, st, m, c.tx);
        billLog_(K, m, st.amount, 'αυτόματη χρέωση', 'πληρώθηκε', c.tx, rec.pay);
        billNotify_(K, 'Χρεώθηκε η συνδρομή για ' + perFor_(st, m), 'Η συνδρομή σας για ' + perFor_(st, m) + ' (' + st.plan + ', €' + euros_(st.amount) + ' με ΦΠΑ) χρεώθηκε στην κάρτα σας. Ευχαριστούμε!\n\n' + payLine);
        return;
      }
      rec.st = 'pending'; rec.charge_error = c.error;
      billSave_(K, st);
      billLog_(K, m, st.amount, 'αυτόματη χρέωση', 'δεν πέρασε: ' + c.error, '');
      const link = freshLink_(K, st, m);
      billSave_(K, st);
      billNotify_(K, 'Η χρέωση για ' + perFor_(st, m) + ' δεν πέρασε',
        'Η αυτόματη χρέωση της συνδρομής σας για ' + perFor_(st, m) + ' (€' + euros_(st.amount) + ' με ΦΠΑ) δεν έγινε δεκτή από την κάρτα.\n\n' +
        'Μπορείτε να πληρώσετε εδώ, και με άλλη κάρτα: ' + link + '\n\n' +
        'Αν η πληρωμή δεν γίνει ' + perBy_(st, m, BILL_.PAUSE_DAY - 1) + ', οι δημοσιεύσεις σταματούν προσωρινά μέχρι να γίνει.');
      return;
    }
    st.months[m] = rec = { st: 'pending' };
    const link0 = freshLink_(K, st, m);
    billSave_(K, st);
    billNotify_(K, 'Πληρωμή συνδρομής για ' + perFor_(st, m), 'Η συνδρομή σας για ' + perFor_(st, m) + ' (' + st.plan + ', €' + euros_(st.amount) + ' με ΦΠΑ). Πληρωμή με κάρτα μέσω Viva: ' + link0);
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
    billNotify_(K, 'Οι δημοσιεύσεις σταμάτησαν προσωρινά',
      'Η συνδρομή σας για ' + perFor_(st, m) + ' (€' + euros_(st.amount) + ' με ΦΠΑ) δεν έχει πληρωθεί, γι\' αυτό οι δημοσιεύσεις σταμάτησαν προσωρινά.\n\n' +
      'Μόλις γίνει η πληρωμή, ξαναρχίζουν αυτόματα: ' + link);
    return;
  }
  if (day >= BILL_.REMIND_DAY && day < BILL_.PAUSE_DAY && !rec.reminded) {
    rec.reminded = new Date().toISOString();
    const link = freshLink_(K, st, m);
    billSave_(K, st);
    billLog_(K, m, st.amount, 'υπενθύμιση', 'στάλθηκε', '');
    billNotify_(K, 'Υπενθύμιση πληρωμής για ' + perFor_(st, m),
      'Η συνδρομή σας για ' + perFor_(st, m) + ' (€' + euros_(st.amount) + ' με ΦΠΑ) δεν έχει πληρωθεί ακόμα.\n\n' +
      'Πληρωμή με κάρτα μέσω Viva: ' + link + '\n\n' +
      'Αν δεν γίνει ' + perBy_(st, m, BILL_.PAUSE_DAY - 1) + ', οι δημοσιεύσεις σταματούν προσωρινά μέχρι να γίνει.');
  }
}

// ------------------------------------------------------------------ έλεγχος (χωρίς χρεώσεις)
function checkBilling() { manualOnly_('checkBilling');
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
function demoChargeNow() { manualOnly_('demoChargeNow');
  if (vivaHosts_().live) throw new Error('demoChargeNow: μόνο με VIVA_ENV=demo.');
  const K = String(prop_('BILLING_TEST_CLIENT', 'TST')).trim().toUpperCase();
  const st = billState_(K);
  if (!st || !st.tx) throw new Error('demoChargeNow: ο ' + K + ' δεν έχει ακόμα πληρωμένη πρώτη συναλλαγή (billing_start + πληρωμή με τον σύνδεσμο).');
  const c = vivaCharge_(st, K, 'demo-' + athens_(new Date(), 'yyyyMMddHHmm'));
  billLog_(K, 'demo', st.amount, 'δοκιμαστική χρέωση', c.ok ? 'πέρασε' : 'δεν πέρασε: ' + c.error, c.tx);
  console.log(c.ok ? 'Η δοκιμαστική χρέωση πέρασε: ' + c.tx : 'Η δοκιμαστική χρέωση ΔΕΝ πέρασε: ' + c.error);
  return c;
}
