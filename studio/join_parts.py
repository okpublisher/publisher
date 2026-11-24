#!/usr/bin/env python3
"""Ξαναενώνει ένα μεγάλο βίντεο από τα κομμάτια του φακέλου «_ΜΕΤΑΦΟΡΑ» (Apps Script: splitBigVideos).

Χρήση:
  join_parts.py <manifest.json> <έξοδος> <αρχεία…>

Τα <αρχεία> είναι ό,τι κατέβηκε με download_file_content (με οποιοδήποτε όνομα και σε οποιαδήποτε σειρά): κάθε
κομμάτι αναγνωρίζεται από το MD5 του στο manifest. Στο τέλος ελέγχεται το MD5 και το μέγεθος ΟΛΟΥ του αρχείου
απέναντι στο πρωτότυπο του Drive. Αν κάτι λείπει ή δεν ταιριάζει: exit 1 και δεν γράφεται έξοδος.
"""
import hashlib
import json
import os
import sys


def md5(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1 << 20), b''):
            h.update(b)
    return h.hexdigest()


def main():
    if len(sys.argv) < 4:
        print(__doc__)
        sys.exit(2)
    man = json.load(open(sys.argv[1], encoding='utf-8'))
    out = sys.argv[2]
    by_md5 = {}
    for p in sys.argv[3:]:
        if os.path.isfile(p):
            by_md5.setdefault(md5(p), p)
    missing = [x['name'] for x in man['parts'] if x['md5'] not in by_md5]
    if missing:
        print('ΛΕΙΠΟΥΝ κομμάτια:', ', '.join(missing))
        sys.exit(1)
    tmp = out + '.part'
    with open(tmp, 'wb') as w:
        for x in man['parts']:
            p = by_md5[x['md5']]
            if os.path.getsize(p) != x['size']:
                os.unlink(tmp)
                print('Λάθος μέγεθος:', x['name'])
                sys.exit(1)
            with open(p, 'rb') as f:
                w.write(f.read())
    if os.path.getsize(tmp) != int(man['size']) or (man.get('md5') and md5(tmp) != man['md5']):
        os.unlink(tmp)
        print('ΑΠΟΤΥΧΙΑ: το ενωμένο αρχείο δεν ταιριάζει με το πρωτότυπο (μέγεθος/MD5).')
        sys.exit(1)
    os.replace(tmp, out)
    print(f"OK: {man['name']} ({int(man['size']) / 1e6:.1f} MB, {len(man['parts'])} κομμάτια, MD5 ίδιο με το Drive) → {out}")


if __name__ == '__main__':
    main()
