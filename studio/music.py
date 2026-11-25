#!/usr/bin/env python3
"""Μουσική για reels και stories: σετ ανά κλάδο, αυτόματη επιλογή χωρίς επαναλήψεις, αποκλεισμός κομματιών με σίγαση.

    python3 music.py list [--set kids]
    python3 music.py pick --client K --date ΕΕΕΕ-ΜΜ-ΗΗ [--mood playful] [--min-dur 20] [--record <αρχείο>]
    python3 music.py where <track_id>
    python3 music.py block <track_id> --reason "σίγαση στο Instagram (Rights Manager)"
    python3 music.py add --set <σετ> --mood <διάθεση> --title <τίτλος> --artist <καλλιτέχνης> --page <σελίδα> --url <mp3>
    python3 music.py check

- Βιβλιοθήκη: music_library.json (ή MUSIC_LIBRARY). Μόνο Pixabay (Pixabay Content License: εμπορική χρήση, χωρίς
  αναφορά δημιουργού). Μόνο links· ποτέ mp3 στο repo (cache εκτός repo, MUSIC_CACHE).
- Κάθε κομμάτι ανήκει σε ένα σετ (κλάδο, π.χ. kids) και έχει μία διάθεση (mood). Ο πελάτης παίρνει σετ και διαθέσεις
  από το "music" της ομάδας του (group.json) ή του config.json του. "none": true = χωρίς μουσική.
- pick: κομμάτι του σετ, στη διάθεση που ζητήθηκε (αλλιώς στις διαθέσεις του πελάτη, με τη σειρά τους), όχι αποκλεισμένο,
  αρκετά μεγάλο, και όχι ίδιο με όσα μπήκαν ±avoid_days ημέρες. Από αυτά: το λιγότερο χρησιμοποιημένο του πελάτη.
  Με --record γράφεται στο clients/<K>/music_log.json (ιδιωτικό repo): ημέρα, κομμάτι, αρχείο.
- block: αν ένα κομμάτι πάθει σίγαση ή διεκδίκηση, δεν ξαναμπαίνει πουθενά. Το where δείχνει πού έχει ήδη μπει.
"""
import argparse, hashlib, json, os, subprocess, sys
from array import array
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import client as client_mod  # noqa: E402

URL_PREFIX = 'https://cdn.pixabay.com/audio/'
PAGE_PREFIX = 'https://pixabay.com/music/'
WINDOW = 30.0      # δευτερόλεπτα: το πιο «γεμάτο» κομμάτι του τραγουδιού γίνεται best_start
STEP = 0.5


def library_path():
    return Path(os.environ.get('MUSIC_LIBRARY') or HERE / 'music_library.json')


def load_library():
    return json.loads(library_path().read_text(encoding='utf-8'))


def save_library(lib):
    library_path().write_text(json.dumps(lib, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def problems(lib):
    """Λάθη της βιβλιοθήκης (κενή λίστα = εντάξει)."""
    out, seen = [], set()
    sets, moods = lib.get('sets') or {}, lib.get('moods') or {}
    for t in lib.get('tracks') or []:
        tid = t.get('id')
        if not tid or tid in seen:
            out.append(f'διπλό ή κενό id: {tid!r}')
        seen.add(tid)
        if t.get('set') not in sets:
            out.append(f'{tid}: άγνωστο σετ {t.get("set")!r}')
        if t.get('mood') not in moods:
            out.append(f'{tid}: άγνωστη διάθεση {t.get("mood")!r}')
        if not str(t.get('url', '')).startswith(URL_PREFIX):
            out.append(f'{tid}: url εκτός {URL_PREFIX}')
        if not str(t.get('page', '')).startswith(PAGE_PREFIX):
            out.append(f'{tid}: σελίδα εκτός {PAGE_PREFIX} (χρειάζεται για την άδεια)')
        try:
            dur, start = float(t['dur']), float(t.get('best_start', 0))
            if dur <= 0 or not 0 <= start < dur:
                out.append(f'{tid}: dur/best_start εκτός ορίων')
        except (KeyError, TypeError, ValueError):
            out.append(f'{tid}: λείπει dur')
    return out


# ------------------------------------------------------------ ιστορικό ανά πελάτη (ιδιωτικό repo)
def log_path(cl):
    return cl.dir / 'music_log.json'


def read_log(cl):
    p = log_path(cl)
    return json.loads(p.read_text(encoding='utf-8')) if p.exists() else []


def write_log(cl, log):
    log.sort(key=lambda e: (e['date'], e.get('item', '')))
    log_path(cl).write_text(json.dumps(log, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


def _days(a, b):
    return abs((date.fromisoformat(a) - date.fromisoformat(b)).days)


def pick(cl, day, mood=None, min_dur=0.0, lib=None, log=None):
    """Επιστρέφει (κομμάτι ή None για «χωρίς μουσική», σημειώσεις). Δεν γράφει τίποτα."""
    date.fromisoformat(day)
    lib = lib or load_library()
    log = read_log(cl) if log is None else log
    cfg = cl.music
    if cfg.get('none'):
        return None, ['ο πελάτης θέλει χωρίς μουσική']
    s = cfg.get('set')
    if not s:
        raise SystemExit(f'{cl.key}: δεν έχει σετ μουσικής ("music": {{"set": …}} στο group.json ή στο config.json). '
                         'Βλ. RUNBOOK «Μουσική».')
    if s not in (lib.get('sets') or {}):
        raise SystemExit(f'{cl.key}: το σετ «{s}» δεν υπάρχει ακόμα στο music_library.json. Βλ. RUNBOOK «Μουσική νέου κλάδου».')
    notes = []
    pool = [t for t in lib['tracks'] if t.get('set') == s and not t.get('blocked')
            and float(t['dur']) - float(t.get('best_start', 0)) >= min_dur + 0.5]
    order = ([mood] if mood else []) + [m for m in cfg['moods'] if m != mood]
    cands = []
    for m in order:
        cands = [t for t in pool if t['mood'] == m]
        if cands:
            if mood and m != mood:
                notes.append(f'καμία «{mood}» στο σετ «{s}»· μπήκε «{m}»')
            break
    if not cands:
        if order:
            notes.append(f'καμία από τις διαθέσεις {order} στο σετ «{s}»· μπήκε οποιαδήποτε')
        cands = pool
    if not cands:
        raise SystemExit(f'{cl.key}: κανένα διαθέσιμο κομμάτι στο σετ «{s}» (όλα αποκλεισμένα ή πολύ μικρά για {min_dur}″).')
    uses = {}
    for e in log:
        if e.get('track') and e['track'] != 'none':
            uses.setdefault(e['track'], []).append(e['date'])
    avoid = int(cfg.get('avoid_days', 10))

    def near(t):
        return min((_days(d, day) for d in uses.get(t['id'], [])), default=10 ** 6)

    fresh = [t for t in cands if near(t) >= avoid]
    if not fresh:
        notes.append(f'όλα τα κομμάτια έχουν μπει τις τελευταίες {avoid} ημέρες· μπήκε το πιο «μακρινό»')
        fresh = sorted(cands, key=lambda t: -near(t))[:1]
    best = min(fresh, key=lambda t: (len(uses.get(t['id'], [])),
                                     hashlib.sha1((day + t['id']).encode()).hexdigest()))
    return best, notes


def record(cl, day, track_id, item, mood=None):
    log = [e for e in read_log(cl) if e.get('item') != item]
    log.append({'date': day, 'track': track_id, 'item': item, **({'mood': mood} if mood else {})})
    write_log(cl, log)


# ------------------------------------------------------------ νέο κομμάτι: διάρκεια και best_start από τον ήχο
def best_window(levels, step=STEP, window=WINDOW):
    """levels: ένταση ανά `step` δευτερόλεπτα. Επιστρέφει την αρχή (s) του πιο δυνατού παραθύρου `window`."""
    n = max(1, int(round(window / step)))
    if len(levels) <= n:
        return 0.0
    run = sum(levels[:n])
    best, at = run, 0
    for i in range(1, len(levels) - n + 1):
        run += levels[i + n - 1] - levels[i - 1]
        if run > best + 1e-9:
            best, at = run, i
    return round(at * step * 2) / 2


def analyse(mp3):
    """(διάρκεια, best_start) από το ίδιο το αρχείο (ffmpeg → mono 8 kHz → RMS ανά 0,5″)."""
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(mp3), '-ac', '1', '-ar', '8000', '-f', 's16le', '-'],
                         check=True, capture_output=True).stdout
    a = array('h'); a.frombytes(pcm[:len(pcm) // 2 * 2])
    per = int(8000 * STEP)
    levels = [(sum(x * x for x in a[i:i + per]) / per) ** 0.5 for i in range(0, len(a) - per + 1, per)]
    dur = round(len(a) / 8000, 1)
    return dur, min(best_window(levels), max(0.0, dur - WINDOW))


def next_id(lib, s):
    prefix = (lib.get('id_prefix') or {}).get(s, s)
    n = 1 + max((int(t['id'].rsplit('_', 1)[1]) for t in lib['tracks']
                 if t['id'].rsplit('_', 1)[0] == prefix and t['id'].rsplit('_', 1)[1].isdigit()), default=0)
    return f'{prefix}_{n:02d}'


# ------------------------------------------------------------ εντολές
def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    p = sub.add_parser('list'); p.add_argument('--set')
    p = sub.add_parser('pick'); p.add_argument('--client'); p.add_argument('--date', required=True)
    p.add_argument('--mood'); p.add_argument('--min-dur', type=float, default=0.0); p.add_argument('--record')
    p = sub.add_parser('where'); p.add_argument('track')
    p = sub.add_parser('block'); p.add_argument('track'); p.add_argument('--reason', required=True)
    p = sub.add_parser('add')
    for k in ('set', 'mood', 'title', 'artist', 'page', 'url'):
        p.add_argument('--' + k, required=True)
    sub.add_parser('check')
    a = ap.parse_args(argv)
    lib = load_library()

    if a.cmd == 'list':
        for t in lib['tracks']:
            if not a.set or t.get('set') == a.set:
                print(f"{t['id']:8} {t['set']:8} {t['mood']:10} {float(t['dur']):6.1f}″  {t['title']} ({t['artist']})"
                      + (f"  ⛔ {t['blocked']}" if t.get('blocked') else ''))
    elif a.cmd == 'pick':
        cl = client_mod.load(a.client)
        t, notes = pick(cl, a.date, a.mood, a.min_dur, lib)
        tid = t['id'] if t else 'none'
        if a.record:
            record(cl, a.date, tid, a.record, t and t['mood'])
        for n in notes:
            print('σημείωση: ' + n, file=sys.stderr)
        print(tid if not t else f"{tid}\t{t['mood']}\t{t['title']} ({t['artist']})")
    elif a.cmd == 'where':
        for f in sorted(client_mod.WORK.glob('clients/*/music_log.json')):
            for e in json.loads(f.read_text(encoding='utf-8')):
                if e.get('track') == a.track:
                    print(f"{f.parent.name}\t{e['date']}\t{e.get('item', '')}")
    elif a.cmd == 'block':
        t = next((x for x in lib['tracks'] if x['id'] == a.track), None)
        if not t:
            sys.exit(f'Δεν υπάρχει κομμάτι {a.track}')
        t['blocked'] = f'{date.today().isoformat()}: {a.reason}'
        save_library(lib)
        print(f"{a.track} αποκλείστηκε. Πού έχει ήδη μπει: python3 music.py where {a.track}")
    elif a.cmd == 'add':
        if a.set not in (lib.get('sets') or {}):
            sys.exit(f'Άγνωστο σετ «{a.set}». Πρόσθεσέ το πρώτα στα "sets" του music_library.json.')
        if a.mood not in (lib.get('moods') or {}):
            sys.exit(f'Άγνωστη διάθεση «{a.mood}». Επιτρέπονται: {", ".join(lib["moods"])}')
        if not a.url.startswith(URL_PREFIX) or not a.page.startswith(PAGE_PREFIX):
            sys.exit(f'Μόνο Pixabay: url {URL_PREFIX}… και σελίδα {PAGE_PREFIX}…')
        if any(t['url'] == a.url for t in lib['tracks']):
            sys.exit('Το κομμάτι υπάρχει ήδη στη βιβλιοθήκη.')
        from story_video import download
        dur, start = analyse(download(a.url))
        t = {'id': next_id(lib, a.set), 'set': a.set, 'title': a.title, 'artist': a.artist, 'mood': a.mood,
             'dur': dur, 'best_start': start, 'page': a.page, 'url': a.url}
        lib['tracks'].append(t)
        save_library(lib)
        print(f"{t['id']}: {a.title} ({a.artist}) · {dur}″ · best_start {start}″")
    elif a.cmd == 'check':
        errs = problems(lib)
        for e in errs:
            print(e)
        if errs:
            sys.exit(1)
        print(f"music_library.json: {len(lib['tracks'])} κομμάτια, σετ: {', '.join(lib['sets'])} ✓")


if __name__ == '__main__':
    main()
