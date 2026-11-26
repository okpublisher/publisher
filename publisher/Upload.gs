/**
 * Ανέβασμα από iPhone στον φάκελο υλικού κάθε πελάτη (okpublisher, ξεχωριστό αρχείο στο ίδιο project).
 * Προαιρετικό: το ίδιο γίνεται και με την εφαρμογή Google Drive (+ → Μεταφόρτωση).
 *
 * Η συντόμευση iPhone «Στείλε στο ΥΛΙΚΟ» ζητάει εδώ, για κάθε φωτογραφία/βίντεο, μια διεύθυνση ανεβάσματος
 * του Drive (resumable upload) και στέλνει εκεί το αρχείο απευθείας, σε πρωτότυπη ποιότητα. Το αρχείο δεν
 * περνάει από το Apps Script, οπότε δεν υπάρχει όριο μεγέθους από εδώ.
 * Κάθε πελάτης έχει δικό του κλειδί (UPLOAD_KEY_<K>) και ανεβάζει μόνο στον δικό του φάκελο (FOLDER_<K>).
 * Με &dir=reels το αρχείο πάει στον υποφάκελο «REELS ΕΤΟΙΜΑ».
 *
 * Ρύθμιση μία φορά:
 *   1. Ανάπτυξη → Νέα ανάπτυξη → Εφαρμογή ιστού · Εκτέλεση ως: Εγώ · Πρόσβαση: Οποιοσδήποτε → Ανάπτυξη.
 *   2. Ανάπτυξη → Διαχείριση αναπτύξεων → αντιγραφή «URL εφαρμογής ιστού» (/exec) → Ιδιότητα σεναρίου UPLOAD_URL.
 *   3. Εκτέλεση sendUploadLink() → κάθε πελάτης παίρνει email (στο NOTIFY_TO_<K>) με τον δικό του σύνδεσμο.
 * Για να ακυρώσεις τον σύνδεσμο ενός πελάτη: σβήσε το UPLOAD_KEY_<K> και ξανατρέξε sendUploadLink().
 */

function uploadKey_(K) {
  let k = cprop_(K, 'UPLOAD_KEY', '');
  if (!k) {
    k = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
    P_().setProperty('UPLOAD_KEY_' + K, k);
  }
  return k;
}

function uploadFolder_(K, dir) {
  const root = DriveApp.getFolderById(folderId_(K));
  if (dir !== 'reels') return root;
  const it = root.getFoldersByName(READY_REELS_DIR);
  return it.hasNext() ? it.next() : root.createFolder(READY_REELS_DIR);
}

function uploadOut_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

// Βρίσκει τον πελάτη από το κλειδί (χρονικά σταθερή σύγκριση δεν χρειάζεται: τα κλειδιά είναι τυχαία 20 χαρακτήρων).
function uploadClient_(c, key) {
  if (!key) return '';
  const list = c ? [String(c).toUpperCase()] : clients_();
  for (let i = 0; i < list.length; i++) {
    if (clients_().indexOf(list[i]) >= 0 && cprop_(list[i], 'UPLOAD_KEY', '') === key && folderId_(list[i])) return list[i];
  }
  return '';
}

// Η συντόμευση στέλνει POST στη διεύθυνση ?c=<K>&key=… με JSON { "name": "IMG_1234.HEIC" }.
// Απάντηση: { "upload_url": "https://www.googleapis.com/upload/drive/v3/files?…" } → εκεί γίνεται PUT το αρχείο.
function doPost(e) {
  let p = {};
  try { p = JSON.parse((e.postData && e.postData.contents) || '{}'); } catch (x) { p = {}; }
  const q = (e && e.parameter) || {};
  const K = uploadClient_(q.c || p.c, q.key || p.key || '');
  if (!K) return uploadOut_({ error: 'Λάθος κλειδί' });
  const name = String(p.name || q.name || ('iPhone ' + Utilities.formatDate(new Date(), 'Europe/Athens', 'yyyy-MM-dd HH.mm.ss')))
    .replace(/[\\/]/g, '_').slice(0, 200);
  const headers = { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
  if (p.mime) headers['X-Upload-Content-Type'] = String(p.mime);
  const res = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&supportsAllDrives=true&fields=id,name', {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    payload: JSON.stringify({ name: name, parents: [uploadFolder_(K, q.dir || p.dir).getId()] }),
    headers: headers,
    muteHttpExceptions: true,
  });
  const h = res.getAllHeaders();
  const loc = h.Location || h.location;
  if (res.getResponseCode() >= 300 || !loc) {
    return uploadOut_({ error: 'Drive ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 200) });
  }
  return uploadOut_({ upload_url: loc, name: name });
}

// Άνοιγμα της διεύθυνσης σε browser: απλός έλεγχος ότι η εφαρμογή ιστού δουλεύει.
function doGet(e) {
  const q = (e && e.parameter) || {};
  rememberWebappUrl_();
  if (q.a === 'stop') return billingCancelPage_(q);   // «Διακοπή συνδρομής» (Billing.gs)
  const K = uploadClient_(q.c, q.key);
  return uploadOut_(K ? { ok: true, client: K } : { error: 'Λάθος κλειδί', service: 'okpublisher' });
}

// Η εφαρμογή ιστού γράφει μόνη της τη διεύθυνσή της (/exec) στο WEBAPP_URL, την πρώτη φορά που ανοίγει (το workflow
// την ανοίγει σε κάθε ανέβασμα). Από εκεί τη χρησιμοποιούν τα email (π.χ. «Διακοπή συνδρομής»), που φεύγουν από triggers.
function rememberWebappUrl_() {
  try {
    const u = String(ScriptApp.getService().getUrl() || '').replace(/\?.*$/, '');
    if (/^https:\/\/script\.google\.com\/.+\/exec$/.test(u) && prop_('WEBAPP_URL', '') !== u) P_().setProperty('WEBAPP_URL', u);
  } catch (e) { /* χωρίς διεύθυνση: τα email γράφουν «απαντήστε σε αυτό το email» */ }
}

// Στέλνει σε κάθε πελάτη (NOTIFY_TO_<K>) τον δικό του σύνδεσμο για τη συντόμευση.
// Το Apps Script, όταν τρέχει από τον επεξεργαστή, δίνει μόνο τη διεύθυνση δοκιμής (/dev). Τη σωστή (/exec) την
// παίρνει από την Ιδιότητα σεναρίου UPLOAD_URL: Ανάπτυξη → Διαχείριση αναπτύξεων → αντιγραφή «URL εφαρμογής ιστού».
function sendUploadLink() {
  let url = String(prop_('UPLOAD_URL', '') || ScriptApp.getService().getUrl() || '').trim().replace(/\?.*$/, '');
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(url)) {
    console.log('Χρειάζομαι τη διεύθυνση της εφαρμογής ιστού που τελειώνει σε /exec:\n' +
      '1. Ανάπτυξη → Διαχείριση αναπτύξεων → αντέγραψε το «URL εφαρμογής ιστού» (αν δεν υπάρχει: Ανάπτυξη → Νέα ανάπτυξη → ' +
      'Εφαρμογή ιστού, Εκτέλεση ως: Εγώ, Πρόσβαση: Οποιοσδήποτε).\n' +
      '2. Ρυθμίσεις έργου (γρανάζι) → Ιδιότητες σεναρίου → Προσθήκη: UPLOAD_URL = αυτή η διεύθυνση.\n' +
      '3. Ξανατρέξε sendUploadLink().  (τώρα βρέθηκε: ' + url + ')');
    return;
  }
  folderClients_().forEach(function (K) {
    if (!cprop_(K, 'NOTIFY_TO', '')) { console.log('[' + K + '] Λείπει NOTIFY_TO_' + K + ', δεν στάλθηκε σύνδεσμος.'); return; }
    const link = url + '?c=' + K + '&key=' + uploadKey_(K);
    notify_(K, 'Σύνδεσμος για τη συντόμευση «Στείλε στο ΥΛΙΚΟ»',
      'Αντιγράψτε από το κινητό αυτόν τον σύνδεσμο και επικολλήστε τον στη συντόμευση (στην πρώτη «Λήψη περιεχομένων URL»):\n\n' +
      link + '\n\nΓια έτοιμα reels (υποφάκελος «' + READY_REELS_DIR + '»):\n\n' + link + '&dir=reels' +
      '\n\nΜην τον μοιράζεστε εκτός ομάδας: όποιος τον έχει μπορεί να ανεβάσει αρχεία στον φάκελό σας.');
    console.log('[' + K + '] Στάλθηκε email με τον σύνδεσμο. Δοκιμή σε browser: ' + link + ' → πρέπει να γράφει "ok": true');
  });
}
