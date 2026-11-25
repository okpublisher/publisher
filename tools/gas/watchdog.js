// Φύλακας: τρέχει ακόμα το Apps Script του okpublisher;
// Το run() γράφει σε κάθε κύκλο (κάθε 10′) το «Τελευταίος κύκλος» στο Sheet, άρα αλλάζει η ώρα τροποποίησής του.
// Αν το Sheet δεν άλλαξε για πάνω από MAX_MIN λεπτά, οι triggers έχουν σταματήσει (π.χ. χάθηκε η άδεια της Google)
// → το workflow αποτυγχάνει και το GitHub στέλνει email.
// Χρειάζεται: CLASPRC_JSON, SCRIPT_ID (secrets). Δεν γράφει IDs ή κλειδιά στο log (δημόσιο repo).
const MAX_MIN = Number(process.env.MAX_MIN || 40);

function creds() {
  const j = JSON.parse(process.env.CLASPRC_JSON || '{}');
  const t = (j.tokens && (j.tokens.default || j.tokens[Object.keys(j.tokens)[0]])) || j.token || {};
  const s = j.oauth2ClientSettings || {};
  const c = { client_id: t.client_id || s.clientId, client_secret: t.client_secret || s.clientSecret, refresh_token: t.refresh_token };
  if (!c.client_id || !c.client_secret || !c.refresh_token) throw new Error('Το CLASPRC_JSON δεν έχει τα στοιχεία που χρειάζονται.');
  return c;
}

async function json(res, what) {
  const text = await res.text();
  if (!res.ok) throw new Error(what + ': HTTP ' + res.status);
  return JSON.parse(text);
}

async function main() {
  const scriptId = String(process.env.SCRIPT_ID || '').trim();
  if (!scriptId) throw new Error('Λείπει το SCRIPT_ID.');
  const c = creds();
  const tok = await json(await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ grant_type: 'refresh_token' }, c)).toString(),
  }), 'Κλειδί Google (ίσως έληξε το CLASPRC_JSON)');
  const H = { Authorization: 'Bearer ' + tok.access_token };
  const proj = await json(await fetch('https://script.googleapis.com/v1/projects/' + encodeURIComponent(scriptId), { headers: H }), 'Apps Script API');
  if (!proj.parentId) throw new Error('Το project δεν είναι δεμένο σε Sheet.');
  const f = await json(await fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(proj.parentId) +
    '?fields=modifiedTime&supportsAllDrives=true', { headers: H }), 'Drive');
  const mins = Math.round((Date.now() - new Date(f.modifiedTime).getTime()) / 60000);
  const when = new Date(f.modifiedTime).toLocaleString('el-GR', { timeZone: 'Europe/Athens' });
  if (mins > MAX_MIN) {
    console.log('::error::Το Apps Script του okpublisher δεν έχει τρέξει εδώ και ' + mins + ' λεπτά (τελευταίος κύκλος ' + when +
      '). Πιθανόν χάθηκε η άδεια της Google: Apps Script → Triggers / Executions, και Run της «setup».');
    process.exit(1);
  }
  console.log('✓ Το Apps Script τρέχει (τελευταίος κύκλος πριν από ' + mins + ' λεπτά, ' + when + ').');
}

main().catch(function (e) { console.log('::error::Φύλακας: ' + e.message); process.exit(1); });
