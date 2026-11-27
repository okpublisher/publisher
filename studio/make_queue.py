#!/usr/bin/env python3
"""Από μια εγκεκριμένη παρτίδα → αρχεία στο repo (media/<ΕΕΕΕ-ΜΜ>/<K>/) + εγγραφές στο queue.json.

    python3 make_queue.py <φάκελος παρτίδας> <φάκελος repo> [--client K]   (ή OKP_CLIENT=K)

Τρέχει ΜΟΝΟ μετά την έγκριση του πελάτη. Δομή παρτίδας (<K> = κλειδί πελάτη· σε παλιές παρτίδες ένα alias, π.χ. LS):
  <παρτίδα>/<K>/<ΕΕΕΕ-ΜΜ-ΗΗ>_post_01.jpg …    εικόνες post (2+ = carousel)· ποτέ .mp4 δίπλα τους (posts χωρίς μουσική)
  <παρτίδα>/<K>/<ΕΕΕΕ-ΜΜ-ΗΗ>_reel.mp4           reel (στη θέση του post της ημέρας) + προαιρετικά _reel_cover.jpg
  <παρτίδα>/<K>/<ΕΕΕΕ-ΜΜ-ΗΗ>_story_01.jpg       story (+ ίδιο όνομα .mp4 με μουσική από story_video.py, μόνο αν ο πελάτης έχει
                                                "music": {"stories": true}· αλλιώς σταματάει)
  <παρτίδα>/captions.json                       '<K>|<ημ/νία>' = λεζάντα post/reel
                                                '<K>|<ημ/νία>|reel' = {"story": false} αν το reel > 60″
  <παρτίδα>/privacy_manifest.json               από privacy_check.py verify + mark

ΦΡΑΓΜΟΣ: κάθε αρχείο πρέπει να είναι «ok» στο privacy_manifest.json (οπτικά ελεγμένο, χωρίς metadata, ίδιο
sha256). Αλλιώς σταματάει και δεν γράφει τίποτα.
Ώρες και ημέρες: από το config.json του πελάτη (post_days, post_time, story_time).
Ασφάλεια: αν η ουρά έχει ήδη άλλη εγγραφή του ίδιου πελάτη στην ίδια θέση (ίδια ώρα, post ή story) με άλλο ID,
σταματάει — ώστε να μη βγει ποτέ διπλή ανάρτηση.
"""
import argparse, glob, json, os, shutil, sys
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import client as clientlib  # noqa: E402
from privacy_check import cleared, metadata_problems  # noqa: E402

ATH = ZoneInfo('Europe/Athens')
REPO_RAW = clientlib.REPO_RAW
IG_CAPTION_MAX = 2200
DAYS_SHORT = ['Δευ', 'Τρι', 'Τετ', 'Πεμ', 'Παρ', 'Σαβ', 'Κυρ']


def at(d, hm):
    """Ώρα Αθήνας με τη σωστή μετατόπιση (χειμερινή/θερινή ώρα)."""
    return datetime.fromisoformat(f'{d}T{hm}:00').replace(tzinfo=ATH).isoformat()


def check_caption(cap, where, banned=()):
    assert cap and cap.strip(), f'{where}: λείπει λεζάντα'
    assert len(cap) <= IG_CAPTION_MAX, f'{where}: λεζάντα {len(cap)} χαρακτήρες (όριο {IG_CAPTION_MAX})'
    low = cap.lower()
    for b in banned:
        assert b not in low, f'{where}: απαγορευμένη διατύπωση «{b}…» (κανόνες πελάτη/ομάδας)'
    assert cap.count('#') <= 8, f'{where}: πάνω από 8 hashtags'


def build(batch, repo, cl, now=None):
    with open(f'{batch}/captions.json', encoding='utf-8') as fh:
        caps = json.load(fh)
    ACC = cl.batch_dir_name(batch)          # <K>/ ή, σε παλιές παρτίδες, το alias (π.χ. LS) — κρατά τα ίδια ID
    POST_DAYS, POST_TIME, STORY_TIME = cl.post_weekdays, cl.post_time, cl.story_time
    banned = cl.banned_phrases
    music_stories = cl.music_stories   # επιλογή του πελάτη (RUNBOOK §6)
    cap = lambda d, suffix='': cl.caption(caps, ACC, d, suffix)
    src = f'{batch}/{ACC}'
    files = sorted(glob.glob(f'{src}/*.jpg') + glob.glob(f'{src}/*.mp4'))
    bad = [f for f in files if not cleared(batch, f)]
    if bad:
        sys.exit('ΣΤΑΜΑΤΗΣΑ: αρχεία χωρίς έγκριση απορρήτου (privacy_check.py verify + mark ok):\n  ' +
                 '\n  '.join(os.path.relpath(f, batch) for f in bad))
    meta = [(f, metadata_problems(f)) for f in files]
    meta = [(f, m) for f, m in meta if m]
    if meta:
        sys.exit('ΣΤΑΜΑΤΗΣΑ: metadata σε ' + ', '.join(f'{os.path.basename(f)} ({m})' for f, m in meta))

    items, copies = [], []
    for d in sorted({os.path.basename(f)[:10] for f in files}):
        day = date.fromisoformat(d)
        month = d[:7]
        dst = f'{repo}/media/{month}/{cl.key}'
        url = lambda f, month=month: f'{REPO_RAW}media/{month}/{cl.key}/{os.path.basename(f)}'
        reel = f'{src}/{d}_reel.mp4'
        posts = sorted(glob.glob(f'{src}/{d}_post_*.jpg'))
        stories = sorted(glob.glob(f'{src}/{d}_story_*.jpg'))
        if (os.path.exists(reel) or posts) and day.weekday() not in POST_DAYS:
            print(f'Προσοχή: post στις {d} ({DAYS_SHORT[day.weekday()]}), εκτός των ημερών post του πελάτη')
        if os.path.exists(reel):
            check_caption(cap(d), f'{ACC}|{d}', banned)
            m = cap(d, 'reel') or {}
            it = {'id': f'{ACC}-{d}-post', 'account': ACC, 'type': 'REEL', 'publish_at': at(d, POST_TIME),
                  'video': url(reel), 'caption': cap(d)}
            if m.get('story') is False:
                it['story'] = False
            copies.append((reel, dst))
            cover = f'{src}/{d}_reel_cover.jpg'
            if os.path.exists(cover):
                copies.append((cover, dst)); it['cover'] = url(cover)
            items.append(it)
        elif posts:
            check_caption(cap(d), f'{ACC}|{d}', banned)
            assert len(posts) <= 10, f'{d}: carousel με {len(posts)} εικόνες (όριο 10)'
            pv = [p[:-4] + '.mp4' for p in posts if os.path.exists(p[:-4] + '.mp4')]
            if pv:   # απόφαση Πέτρου 27/11/2026: τα posts μένουν εικόνες, ποτέ βίντεο με μουσική
                sys.exit(f'ΣΤΑΜΑΤΗΣΑ: {d}: βίντεο σε post ({os.path.basename(pv[0])}). Τα posts μένουν εικόνες, χωρίς μουσική.')
            copies += [(p, dst) for p in posts]
            items.append({'id': f'{ACC}-{d}-post', 'account': ACC, 'type': 'CAROUSEL' if len(posts) > 1 else 'IMAGE',
                          'publish_at': at(d, POST_TIME), 'images': [url(p) for p in posts], 'caption': cap(d)})
        for i, s in enumerate(stories):
            it = {'id': f'{ACC}-{d}-story' + (f'-{i + 1}' if i else ''), 'account': ACC, 'type': 'STORY',
                  'publish_at': at(d, STORY_TIME if not i else f'{9 + i * 3:02d}:30'), 'images': [url(s)]}
            copies.append((s, dst))
            mp4 = s[:-4] + '.mp4'
            if os.path.exists(mp4):
                if not music_stories:
                    sys.exit(f'ΣΤΑΜΑΤΗΣΑ: {os.path.basename(mp4)}: story με μουσική, ενώ ο πελάτης θέλει τα stories χωρίς μουσική.')
                copies.append((mp4, dst)); it['video'] = url(mp4)
            elif music_stories:
                print(f'Προσοχή: {os.path.basename(s)}: story χωρίς μουσική, ενώ ο πελάτης θέλει μουσική στα stories (story_video.py)')
            items.append(it)
    # Αν η έγκριση ήρθε αργά: ό,τι έχει ήδη περάσει (ή είναι σε < 20′) ΔΕΝ μπαίνει, ούτε τα αρχεία του.
    soon = (now or datetime.now(ATH)) + timedelta(minutes=20)
    late = [i for i in items if datetime.fromisoformat(i['publish_at']) < soon]
    if late:
        print('Παραλείπονται (η ώρα τους πέρασε):', ', '.join(i['id'] for i in late))
    items = [i for i in items if i not in late]
    used = {u.rsplit('/', 1)[-1] for i in items for u in (i.get('images') or []) + [i[k] for k in ('video', 'cover') if i.get(k)]}
    for f, dst in copies:
        if os.path.basename(f) in used:
            os.makedirs(dst, exist_ok=True)
            shutil.copy(f, dst)
    return items


def slot(it):
    return ('story' if it['type'] == 'STORY' else 'post', datetime.fromisoformat(it['publish_at']))


def clashes(existing, new, accounts):
    """Εγγραφές της ουράς του ίδιου πελάτη στην ίδια θέση (ίδια ώρα, post ή story) με άλλο ID."""
    ids = {i['id'] for i in new}
    taken = {slot(i): i['id'] for i in existing if i.get('account') in accounts and i['id'] not in ids}
    return [(i['id'], taken[slot(i)]) for i in new if slot(i) in taken]


def merge(q, new, accounts):
    bad = clashes(q['items'], new, accounts)
    if bad:
        sys.exit('ΣΤΑΜΑΤΗΣΑ: η ουρά έχει ήδη άλλη εγγραφή στην ίδια θέση (θα έβγαινε διπλή ανάρτηση):\n  ' +
                 '\n  '.join(f'{a} ↔ {b}' for a, b in bad))
    ids = {i['id'] for i in new}
    q['items'] = [i for i in q['items'] if i['id'] not in ids] + new
    q['items'].sort(key=lambda i: i['publish_at'])
    return q


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('batch'); ap.add_argument('repo'); ap.add_argument('--client')
    a = ap.parse_args()
    cl = clientlib.load(a.client)
    qpath = f'{a.repo}/queue.json'
    q = json.load(open(qpath, encoding='utf-8')) if os.path.exists(qpath) else {'version': 1, 'timezone': 'Europe/Athens', 'items': []}
    new = build(a.batch, a.repo, cl)
    q = merge(q, new, set(cl.accounts))
    json.dump(q, open(qpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print(len(new), 'εγγραφές προστέθηκαν ·', len(q['items']), 'συνολικά στην ουρά')
