/**
 * Συστάσεις πελατών (από 27/11/2026, απόφαση Πέτρου· όροι v9 Α.16).
 *
 * Κάθε πελάτης (όχι πελάτης agency) έχει δικό του κωδικό σύστασης REFCODE_<K> (5 χαρακτήρες, όπως των πωλητών) και σύνδεσμο
 * okpublisher.gr/?p=<κωδικός>: η σελίδα τον στέλνει κρυφά όπως τον κωδικό πωλητή (στήλη «Σύσταση», ίδια φόρμα).
 * Μια επιχείρηση που ήρθε ΠΡΩΤΑ από τον σύνδεσμο πελάτη (ο πρώτος σύνδεσμος κερδίζει, όπως στους πωλητές· σύνδεσμος πωλητή
 * ή agency = όχι σύσταση) και πληρώνει τον 1ο της μήνα (offerPaid_) → ο πελάτης που τη σύστησε παίρνει έκπτωση
 * REFERRAL_.CENTS (€150 + ΦΠΑ) που μπαίνει στις επόμενες χρεώσεις του (REFERRAL_CREDIT_<K>, σε λεπτά):
 *   - ολόκληρη η χρέωση καλύπτεται → η περίοδος σημειώνεται πληρωμένη με €0, χωρίς χρέωση κάρτας, email «δεν χρεώνεστε»·
 *   - αλλιώς χρεώνεται λιγότερο εκείνη την περίοδο (st.amount_full = το κανονικό, επιστρέφει στην επόμενη)·
 *   - ό,τι περισσεύει μένει για την επόμενη. Δωρεάν πελάτης: περιμένει ώσπου να πληρώνει. Δεν γίνεται χρήματα.
 * Μία φορά ανά νέο πελάτη (REFERRAL_DONE_<νέος> = ποιος τον σύστησε).
 */
const REFERRAL_ = { CENTS: 18600, SITE: 'https://okpublisher.gr/' };

// Ο κωδικός σύστασης του πελάτη (τον φτιάχνει αν λείπει). '' για πελάτη agency.
function referralCode_(K) {
  if (agencyOf_(K)) return '';
  let c = cprop_(K, 'REFCODE', '');
  if (c) return c;
  const used = {};
  const users = admUsers_();
  Object.keys(users).forEach(function (e) { if (users[e].ref) used[users[e].ref] = 1; });
  approvalClients_().forEach(function (x) { const r = cprop_(x, 'REFCODE', ''); if (r) used[r] = 1; });
  for (let i = 0; i < 50 && !c; i++) {
    let r = '';
    for (let j = 0; j < 5; j++) r += ADM_.REF_ABC.charAt(Math.floor(Math.random() * ADM_.REF_ABC.length));
    if (!used[r]) c = r;
  }
  if (!c) return '';
  P_().setProperty('REFCODE_' + K, c);
  return c;
}
function referralLink_(K) { const c = referralCode_(K); return c ? REFERRAL_.SITE + '?p=' + c : ''; }
function referralCredit_(K) { return Number(cprop_(K, 'REFERRAL_CREDIT', '0')) || 0; }
// Ποιος πελάτης έχει αυτόν τον κωδικό ('' αν κανείς).
function referralOwner_(code) {
  if (!code) return '';
  const hit = approvalClients_().filter(function (K) { return cprop_(K, 'REFCODE', '') === code; })[0];
  return hit || '';
}

// Ο πρώτος σύνδεσμος (κωδικός «Σύσταση») για τον πελάτη με κωδικό OK-…: από τις επαφές και τα σεταρίσματα με το ίδιο email,
// ΑΦΜ ή κωδικό, με τη σειρά του χρόνου (όπως ο admOwners_). '' αν κανένας.
function referralRef_(okCode, L) {
  L = L || admLeads_();
  const s0 = (L.setups || []).filter(function (s) { return s.code === okCode; })[0];
  if (!s0) return '';
  const email = s0.email, afm = String(s0.afm || '').replace(/[^\d]/g, '');
  const rows = (L.leads || []).filter(function (l) { return email && l.email === email; }).map(function (l) { return { t: admTime_(l.at), k: 0, ref: l.ref }; })
    .concat((L.setups || []).filter(function (s) {
      return s.code === okCode || (email && s.email === email) || (afm && String(s.afm || '').replace(/[^\d]/g, '') === afm);
    }).map(function (s) { return { t: admTime_(s.at), k: 1, ref: s.ref }; }));
  rows.sort(function (a, b) { return (a.t - b.t) || (a.k - b.k); });
  const r = rows.filter(function (x) { return !!x.ref; })[0];
  return r ? r.ref : '';
}

// Ο νέος πελάτης K2 πλήρωσε τον 1ο του μήνα: έκπτωση στον πελάτη που τον σύστησε (αν υπάρχει). Επιστρέφει τον K ή ''.
function referralAward_(K2, st) {
  if (cprop_(K2, 'REFERRAL_DONE', '')) return '';
  const code = billCode_(K2, st || billState_(K2) || {});
  if (!code) return '';
  const ref = referralRef_(code);
  if (!ref) return '';
  const users = admUsers_();
  if (Object.keys(users).some(function (e) { return users[e].ref === ref; })) return '';   // σύνδεσμος πωλητή/agency: όχι σύσταση
  const K = referralOwner_(ref);
  if (!K || K === K2 || agencyOf_(K)) return '';
  const credit = referralCredit_(K) + REFERRAL_.CENTS;
  P_().setProperty('REFERRAL_CREDIT_' + K, String(credit));
  P_().setProperty('REFERRAL_COUNT_' + K, String((Number(cprop_(K, 'REFERRAL_COUNT', '0')) || 0) + 1));
  P_().setProperty('REFERRAL_DONE_' + K2, K);
  billLog_(K, '', REFERRAL_.CENTS, 'σύσταση: έκπτωση', 'από ' + K2 + ' (' + code + ')· σε αναμονή €' + euros_(credit), '');
  notify_(K, 'Ευχαριστούμε για τη σύσταση!', 'Μια επιχείρηση που ήρθε από τον σύνδεσμό σας ξεκίνησε συνεργασία μαζί μας. Ευχαριστούμε!\n\n' +
    'Σας χαρίζουμε €' + euros_(REFERRAL_.CENTS) + ' (με ΦΠΑ): αφαιρούνται αυτόματα από την επόμενη χρέωσή σας' +
    (credit > REFERRAL_.CENTS ? ' (σύνολο σε αναμονή: €' + euros_(credit) + ')' : '') + '. Δεν χρειάζεται να κάνετε τίποτα.\n\n' +
    'Ο σύνδεσμός σας για κάθε επόμενη σύσταση: ' + referralLink_(K));
  systemNotify_('Σύσταση: ' + K + ' ← ' + K2, clientName_(K) + ' (' + K + ') σύστησε ' + clientName_(K2) + ' (' + K2 + ', ' + code + '), που πλήρωσε. ' +
    'Έκπτωση €' + euros_(REFERRAL_.CENTS) + ' στην επόμενη χρέωση του ' + K + ' (σε αναμονή: €' + euros_(credit) + ').');
  return K;
}

// Νέα περίοδος m του K (από τον billingClient_, πριν από τη χρέωση): έκπτωση σύστασης αν υπάρχει.
// true = η περίοδος καλύφθηκε ολόκληρη (σημειώθηκε πληρωμένη με €0, χωρίς χρέωση κάρτας).
function referralApply_(K, st, m) {
  const credit = referralCredit_(K);
  if (!credit || !(st.amount > 0)) return false;
  const use = Math.min(credit, st.amount);
  P_().setProperty('REFERRAL_CREDIT_' + K, String(credit - use));
  if (use >= st.amount) {
    const rec = st.months[m] = { st: 'paid', paid_at: new Date().toISOString(), plan: st.plan, amount: 0, credit: use, pay: newPayId_() };
    billCode_(K, st);
    billSave_(K, st);
    billLog_(K, m, 0, 'σύσταση: χωρίς χρέωση', 'έκπτωση €' + euros_(use), '', rec.pay);
    billNotify_(K, 'Αυτόν τον μήνα δεν χρεώνεστε', 'Ευχαριστούμε για τη σύστασή σας! Η συνδρομή σας για ' + perFor_(st, m) + ' (' + st.plan + ', €' +
      euros_(st.amount) + ' με ΦΠΑ) καλύπτεται από την έκπτωση σύστασης, οπότε δεν χρεώνουμε την κάρτα σας. Οι δημοσιεύσεις συνεχίζονται κανονικά.' +
      (credit - use > 0 ? ' Σας μένουν €' + euros_(credit - use) + ' για την επόμενη χρέωση.' : '') + '\n\n' + nextChargeText_(st, m) +
      '\n\nΚωδικός πληρωμής: ' + rec.pay + (st.code ? ' · Πελάτης: ' + st.code : '') + ' · Πακέτο: ' + st.plan + ' · ' + perNom_(st, m) + ' · €0,00.');
    return true;
  }
  st.amount_full = st.amount;
  st.amount = st.amount - use;
  st.referral_use = use;
  billLog_(K, m, -use, 'σύσταση: έκπτωση', 'χρεώνεται €' + euros_(st.amount) + ' αντί για €' + euros_(st.amount_full), '');
  return false;
}

// Γραμμή για τα email πληρωμής πελάτη (όχι agency): ο σύνδεσμός του και τι κερδίζει. '' αν δεν ισχύει.
function referralLine_(K) {
  const st = billState_(K);
  if (agencyOf_(K) || (st && st.agency)) return '';
  let link = '';
  try { link = referralLink_(K); } catch (e) { link = ''; }
  return link ? 'Συστήστε μας: για κάθε επιχείρηση που ξεκινά από τον σύνδεσμό σας, €' + euros_(REFERRAL_.CENTS) +
    ' (με ΦΠΑ) έκπτωση στην επόμενη χρέωσή σας: ' + link : '';
}
