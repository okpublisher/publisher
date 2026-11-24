#!/usr/bin/env python3
"""Σβήνει από το δημόσιο repo ό,τι δημοσιεύτηκε πριν από N ημέρες (προεπιλογή 3) — και από το ιστορικό του git.

    python3 cleanup_repo.py <φάκελος repo> [--days 3] [--dry-run] [--purge-history] [--raw URL]

Δουλεύει σε κάθε repo με queue.json + media/ (okpublisher/publisher ή το παλιό repo ενός πελάτη): η διεύθυνση raw
βγαίνει από το origin του repo (ή --raw).

1. Βγάζει από το queue.json τις εγγραφές με ώρα δημοσίευσης παλιότερη από N ημέρες.
2. Σβήνει τα αρχεία τους από το media/ (και ό,τι άλλο στο media/ δεν το χρησιμοποιεί πια καμία εγγραφή και έχει
   ημερομηνία παλιότερη από N ημέρες) → commit.
3. ΜΟΝΟ με --purge-history (θέλει ρητή έγκριση του διαχειριστή του okpublisher, γιατί κάνει force push στο main): ξαναγράφει το
   ιστορικό με git filter-repo ώστε τα σβησμένα αρχεία να μη μένουν σε κανένα παλιό commit (ο κώδικας και το
   ιστορικό του μένουν). Χωρίς τη σημαία: απλό commit + push (τα αρχεία μένουν στο ιστορικό του git).
Σημείωση: όποιος είχε ήδη κατεβάσει το repo κρατάει το αντίγραφό του, και το GitHub μπορεί να κρατά για λίγο
αόρατα commits στην cache του. Το Instagram/Facebook δεν επηρεάζονται (έχουν ήδη δικό τους αντίγραφο).
"""
import argparse, json, os, re, subprocess, sys, tempfile
from datetime import datetime, timedelta, timezone

def raw_base(repo, branch='main'):
    """https://github.com/<owner>/<repo>(.git) → https://raw.githubusercontent.com/<owner>/<repo>/<branch>/"""
    url = git(repo, 'remote', 'get-url', 'origin', capture=True)
    m = re.search(r'github\.com[/:]([^/]+)/([^/]+?)(?:\.git)?/?$', url) or re.search(r'/git/([^/]+)/([^/]+?)(?:\.git)?/?$', url)
    if not m:
        sys.exit(f'Δεν βγαίνει η διεύθυνση raw από το origin «{url}»: δώσε --raw')
    return f'https://raw.githubusercontent.com/{m.group(1)}/{m.group(2)}/{branch}/'


def git(repo, *args, check=True, capture=False):
    r = subprocess.run(['git', '-C', repo, *args], check=check, text=True,
                       stdout=subprocess.PIPE if capture else None, stderr=subprocess.PIPE if capture else None)
    return (r.stdout or '').strip() if capture else r


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('repo'); ap.add_argument('--days', type=float, default=3); ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--purge-history', action='store_true'); ap.add_argument('--raw')
    a = ap.parse_args()
    repo = os.path.abspath(a.repo)
    RAW = a.raw or raw_base(repo)
    qpath = os.path.join(repo, 'queue.json')
    q = json.load(open(qpath, encoding='utf-8')) if os.path.exists(qpath) else {'items': []}
    cutoff = datetime.now(timezone.utc) - timedelta(days=a.days)

    old = [i for i in q['items'] if datetime.fromisoformat(i['publish_at']) < cutoff]
    keep = [i for i in q['items'] if i not in old]
    urls = lambda it: (it.get('images') or []) + [it[k] for k in ('video', 'cover') if it.get(k)]
    still = {u[len(RAW):] for it in keep for u in urls(it) if u.startswith(RAW)}
    gone = {u[len(RAW):] for it in old for u in urls(it) if u.startswith(RAW)} - still
    # ορφανά αρχεία στο media/ με παλιά ημερομηνία στο όνομα (π.χ. από ακυρωμένη εγγραφή)
    for root, _, files in os.walk(os.path.join(repo, 'media')):
        for f in files:
            rel = os.path.relpath(os.path.join(root, f), repo)
            m = re.match(r'(\d{4}-\d{2}-\d{2})', f)
            if rel not in still and m and datetime.fromisoformat(m.group(1) + 'T23:59:59+02:00') < cutoff:
                gone.add(rel)
    gone = sorted(g for g in gone if os.path.exists(os.path.join(repo, g)) or True)
    print(f'Εγγραφές προς αφαίρεση: {len(old)} · αρχεία προς σβήσιμο: {len(gone)} · μένουν {len(keep)} εγγραφές')
    if a.dry_run or (not old and not gone):
        for g in gone[:30]:
            print('  -', g)
        return

    if a.purge_history and git(repo, 'rev-parse', '--is-shallow-repository', capture=True) == 'true':
        git(repo, 'fetch', '--unshallow', 'origin')
    q['items'] = keep
    json.dump(q, open(qpath, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    for g in gone:
        if os.path.exists(os.path.join(repo, g)):
            git(repo, 'rm', '-q', '--', g)
    git(repo, 'add', 'queue.json')
    git(repo, 'commit', '-q', '-m', f'Καθαρισμός: σβήστηκαν {len(gone)} αρχεία που δημοσιεύτηκαν πριν από {a.days:g}+ ημέρες')

    if not a.purge_history:
        git(repo, '-c', 'push.negotiate=true', 'push', 'origin', 'HEAD:main')
        print(f'Έγινε: {len(gone)} αρχεία σβήστηκαν (μένουν στο ιστορικό του git· --purge-history για πλήρη αφαίρεση).')
        return
    # Τα σβησμένα αρχεία φεύγουν από ΟΛΟ το ιστορικό. Και όλα τα media/ που δεν υπάρχουν πια στο τελευταίο commit.
    current = set(git(repo, 'ls-files', 'media', capture=True).splitlines())
    ever = set(git(repo, 'log', '--all', '--name-only', '--pretty=format:', '--', 'media', capture=True).split())
    purge = sorted((ever - current) | set(gone))
    if purge:
        remote = git(repo, 'remote', 'get-url', 'origin', capture=True)
        with tempfile.NamedTemporaryFile('w', delete=False, suffix='.txt') as f:
            f.write('\n'.join(purge) + '\n')
        subprocess.run(['git', 'filter-repo', '--force', '--invert-paths', '--paths-from-file', f.name], cwd=repo, check=True,
                       stdout=subprocess.DEVNULL)
        os.unlink(f.name)
        git(repo, 'remote', 'add', 'origin', remote, check=False)   # το filter-repo αφαιρεί το origin
    git(repo, 'push', '--force', 'origin', 'HEAD:main')
    print(f'Έγινε: {len(purge)} διαδρομές έφυγαν από το ιστορικό, force push στο main.')


if __name__ == '__main__':
    main()
