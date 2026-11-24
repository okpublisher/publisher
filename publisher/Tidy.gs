/**
 * Φάκελοι υλικού των πελατών (okpublisher, ξεχωριστό αρχείο στο ίδιο project).
 *
 * dedupeMaterial(): για κάθε πελάτη με FOLDER_<K>, ψάχνει ακριβή διπλότυπα (ίδιο περιεχόμενο, MD5 + μέγεθος) σε ΟΛΟ
 *   τον φάκελο υλικού (και στους υποφακέλους), εκτός από όσα φτιάχνει το ίδιο το σύστημα (ΕΓΚΡΙΣΗ, _ΜΕΤΑΦΟΡΑ).
 *   Κρατάει ένα αντίγραφο: πρώτα όσα ανήκουν στον λογαριασμό του okpublisher, μετά το παλιότερο. Έτσι, αν ξανανέβει
 *   κάτι που έχει ήδη χρησιμοποιηθεί (ΧΡΗΣΙΜΟΠΟΙΗΜΕΝΑ) ή απορριφθεί (ΑΠΟΡΡΙΦΘΗΚΑΝ), το νέο αντίγραφο φεύγει.
 *   Τα υπόλοιπα: του okpublisher → κάδος (30 ημέρες) · όλων των άλλων → βγαίνουν μόνο από τον φάκελο (μένουν στο
 *   Drive αυτού που τα ανέβασε). Τίποτα δεν σβήνεται οριστικά. Email στον πελάτη μόνο όταν βρει κάτι.
 * setupDailyDedupe(): τρέχει τον έλεγχο τώρα και μετά κάθε βράδυ (~04:00). Την ίδια νύχτα, στον χρόνο που μένει,
 *   κόβει και τα μεγάλα βίντεο για τον Claude (splitBigVideos, Transfer.gs).
 * setupClientFolders(): φτιάχνει στον φάκελο υλικού κάθε πελάτη τον υποφάκελο «REELS ΕΤΟΙΜΑ», αν δεν υπάρχει.
 */
const TIDY_ = {
  BUDGET_MS: 4.5 * 60 * 1000,    // ασφαλώς κάτω από το όριο των 6 λεπτών του Apps Script
  API: 'https://www.googleapis.com/drive/v3/files',
  FOLDER: 'application/vnd.google-apps.folder',
};
const DEDUPE_SKIP_ = ['ΕΓΚΡΙΣΗ', '_ΜΕΤΑΦΟΡΑ'];   // αρχεία που φτιάχνει το ίδιο το σύστημα· δεν πειράζονται
const READY_REELS_DIR = 'REELS ΕΤΟΙΜΑ';           // τελικά reels του πελάτη: δημοσιεύονται όπως είναι

function setupDailyDedupe() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'dedupeMaterial') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('dedupeMaterial').timeBased().everyDays(1).atHour(4).create();
  console.log('Έτοιμο: ο έλεγχος διπλοτύπων θα τρέχει κάθε βράδυ. Τρέχει και τώρα μία φορά…');
  dedupeMaterial();
}

// Πελάτες με φάκελο υλικού.
function folderClients_() {
  return clients_().filter(function (K) { return !!folderId_(K); });
}

// Κάθε βράδυ: διπλότυπα όλων των πελατών και μετά κόψιμο μεγάλων βίντεο για τον Claude, στον χρόνο που μένει.
function dedupeMaterial() {
  const start = Date.now();
  const dedupeUntil = start + TIDY_.BUDGET_MS - 90 * 1000;
  let n = 0;
  folderClients_().forEach(function (K) {
    if (Date.now() > dedupeUntil) return;
    try { n += dedupeOnly_(K, dedupeUntil); }
    catch (e) { systemNotify_('Σφάλμα στα διπλότυπα (' + K + ')', e.message); }
  });
  try {
    splitBigVideos(start + TIDY_.BUDGET_MS);
  } catch (e) {
    systemNotify_('Σφάλμα στο κόψιμο μεγάλων βίντεο', 'Η splitBigVideos σταμάτησε: ' + e.message);
  }
  return n;
}

function dedupeOnly_(K, deadline) {
  const files = tidyWalk_(folderId_(K)).files.filter(function (f) {
    return f.md5 && DEDUPE_SKIP_.indexOf(f.path[0]) < 0;
  });
  const groups = {};
  files.forEach(function (f) { const k = f.md5 + '|' + f.size; (groups[k] = groups[k] || []).push(f); });
  const ops = [], lines = [];
  Object.keys(groups).forEach(function (k) {
    const g = groups[k];
    if (g.length < 2) return;
    g.sort(function (a, b) {
      if (a.mine !== b.mine) return a.mine ? -1 : 1;
      return new Date(a.created) - new Date(b.created);
    });
    const keep = g[0];
    g.slice(1).forEach(function (f) {
      ops.push(f.mine ? { type: 'trash', id: f.id } : { type: 'unlink', id: f.id, from: f.parent });
      lines.push('• ' + f.path.join(' / ') + '  (ίδιο με: ' + keep.path.join(' / ') + ')');
    });
  });
  if (!ops.length) { console.log('[' + K + '] Κανένα διπλότυπο σε ' + files.length + ' αρχεία.'); return 0; }
  const x = tidyExec_(ops, deadline);
  console.log('[' + K + '] Διπλότυπα: ' + x.ok + '/' + ops.length + ' αφαιρέθηκαν (σε ' + files.length + ' αρχεία).');
  notify_(K, 'Διπλότυπα στο υλικό: ' + x.ok,
    'Βρέθηκαν και αφαιρέθηκαν από τον φάκελο υλικού ' + x.ok + ' αρχεία που υπήρχαν ήδη (ίδιο ακριβώς περιεχόμενο):\n\n' +
    lines.slice(0, 60).join('\n') + (lines.length > 60 ? '\n… και άλλα ' + (lines.length - 60) : '') +
    '\n\nΤίποτα δεν σβήστηκε: όσα είχατε ανεβάσει εσείς βγήκαν μόνο από τον φάκελο και μένουν στο Drive σας.' +
    (x.ok < ops.length ? '\n\nΚάποια δεν αφαιρέθηκαν (' + (ops.length - x.ok) + '), θα ξαναδοκιμάσει αύριο.' : ''));
  return x.ok;
}

function setupClientFolders() {
  folderClients_().forEach(function (K) {
    try {
      const root = DriveApp.getFolderById(folderId_(K));
      const it = root.getFoldersByName(READY_REELS_DIR);
      if (it.hasNext()) console.log('[' + K + '] «' + READY_REELS_DIR + '» υπάρχει ήδη στο «' + root.getName() + '».');
      else { root.createFolder(READY_REELS_DIR); console.log('[' + K + '] Φτιάχτηκε το «' + READY_REELS_DIR + '» στο «' + root.getName() + '».'); }
    } catch (e) { console.log('[' + K + '] ΣΦΑΛΜΑ: ' + e.message); }
  });
}

// ------------------------------------------------------------------ helpers (Drive API v3)
function tidyReq_(method, url, body) {
  const r = { url: url, method: method, headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true };
  if (body) { r.contentType = 'application/json'; r.payload = JSON.stringify(body); }
  return r;
}

function tidyJson_(res) {
  if (res.getResponseCode() >= 300) throw new Error('Drive API ' + res.getResponseCode() + ': ' + res.getContentText().slice(0, 300));
  return JSON.parse(res.getContentText() || '{}');
}

function tidyListUrl_(folderId, pageToken, extraQ) {
  return TIDY_.API + '?pageSize=1000&supportsAllDrives=true&includeItemsFromAllDrives=true&q=' +
    encodeURIComponent("'" + folderId + "' in parents and trashed = false" + (extraQ || '')) +
    '&fields=' + encodeURIComponent('nextPageToken,files(id,name,mimeType,md5Checksum,size,createdTime,ownedByMe)') +
    (pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : '');
}

// Διαβάζει όλο το δέντρο (ανά επίπεδο, 20 φάκελοι παράλληλα).
function tidyWalk_(rootId) {
  const root = { id: rootId, name: '', folder: true, children: [], path: [] };
  const files = [];
  let level = [root];
  while (level.length) {
    const next = [];
    for (let i = 0; i < level.length; i += 20) {
      let todo = level.slice(i, i + 20).map(function (n) { return { node: n, tok: '' }; });
      while (todo.length) {
        const res = UrlFetchApp.fetchAll(todo.map(function (t) { return tidyReq_('get', tidyListUrl_(t.node.id, t.tok)); }));
        const again = [];
        res.forEach(function (r, k) {
          const t = todo[k], j = tidyJson_(r);
          (j.files || []).forEach(function (x) {
            const c = { id: x.id, name: x.name, folder: x.mimeType === TIDY_.FOLDER, children: [], parent: t.node.id, mine: !!x.ownedByMe,
              md5: x.md5Checksum || '', size: x.size || '', created: x.createdTime, path: t.node.path.concat([x.name]) };
            t.node.children.push(c);
            (c.folder ? next : files).push(c);
          });
          if (j.nextPageToken) again.push({ node: t.node, tok: j.nextPageToken });
        });
        todo = again;
      }
    }
    level = next;
  }
  return { root: root, files: files };
}

function tidyExec_(ops, deadline) {
  let ok = 0;
  for (let i = 0; i < ops.length; i += 20) {
    if (Date.now() > deadline) break;
    const chunk = ops.slice(i, i + 20);
    const res = UrlFetchApp.fetchAll(chunk.map(function (o) {
      if (o.type === 'unlink') return tidyReq_('patch', TIDY_.API + '/' + o.id + '?removeParents=' + o.from + '&fields=id', {});
      return tidyReq_('patch', TIDY_.API + '/' + o.id + '?fields=id', { trashed: true });
    }));
    res.forEach(function (r) {
      if (r.getResponseCode() < 300) ok++;
      else console.log('Drive API ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
    });
  }
  return { ok: ok };
}
