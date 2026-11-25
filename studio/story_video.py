#!/usr/bin/env python3
"""Στατικό story (jpg 1080x1920) → video story με μουσική (για να έχει ήχο στο Instagram/Facebook).

  python3 story_video.py <story.jpg> <track_id> <out.mp4> [διάρκεια_s=12]

track_id από το music_library.json (π.χ. ls_01· διάλεξέ το με `music.py pick`). Το κομμάτι κατεβαίνει από το url του
(cdn.pixabay.com) σε cache έξω από το repo· ΠΟΤΕ δεν μπαίνει ήχος στο repo.
Βίντεο: πολύ αργό zoom 1.00→1.025 στο κέντρο (το περιθώριο των σχεδίων καλύπτει την περικοπή),
H.264 30fps yuv420p, AAC 128k 48kHz, -16 LUFS, fade in 0,4″ / fade out 1,5″, faststart.
Όρια story: 3–60″, ≤100MB (Instagram) — εδώ ~12″, ~2–4MB.
"""
import hashlib, json, os, subprocess, sys
HERE = os.path.dirname(os.path.abspath(__file__))
CACHE = os.environ.get('MUSIC_CACHE', '/tmp/music_cache')

def library():
    path = os.environ.get('MUSIC_LIBRARY') or os.path.join(HERE, 'music_library.json')
    return json.load(open(path, encoding='utf-8'))['tracks']

def download(url, name='track'):
    """Το mp3 στο cache (εκτός repo)· κατεβαίνει μόνο την πρώτη φορά."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, name + '_' + hashlib.sha1(url.encode()).hexdigest()[:8] + '.mp3')
    if not os.path.exists(path) or os.path.getsize(path) < 10000:
        subprocess.run(['curl', '-sSfL', '-A', 'Mozilla/5.0', '-o', path, url], check=True)
    return path

def track(tid):
    """(κομμάτι, mp3). Αρνείται άγνωστα και αποκλεισμένα κομμάτια (music.py block)."""
    t = next((x for x in library() if x['id'] == tid), None)
    if t is None:
        raise SystemExit(f'Δεν υπάρχει κομμάτι «{tid}» στο music_library.json (music.py list).')
    if t.get('blocked'):
        raise SystemExit(f'Το κομμάτι {tid} είναι αποκλεισμένο ({t["blocked"]}). Διάλεξε άλλο: music.py pick …')
    return t, download(t['url'], tid)

def make(img, tid, out, dur=12.0):
    if tid == 'none':
        raise SystemExit('Χωρίς μουσική (επιλογή του πελάτη): το story μένει εικόνα (jpg), χωρίς βίντεο.')
    t, mp3 = track(tid)
    start = max(0.0, min(float(t.get('best_start', 0)), float(t.get('dur', 9999)) - dur - 0.5))
    fps, z = 30, 0.025
    n = int(dur * fps)
    vf = (f"scale=2160:3840:flags=lanczos,zoompan=z='1+{z}*on/{n}':d=1:"
          f"x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps={fps},format=yuv420p")
    af = (f"atrim=0:{dur},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.4,afade=t=out:st={dur - 1.5}:d=1.5,"
          f"loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000")
    cmd = ['ffmpeg', '-y', '-loglevel', 'error', '-loop', '1', '-framerate', str(fps), '-i', img,
           '-ss', f'{start:.2f}', '-i', mp3, '-filter_complex', f'[0:v]{vf}[v];[1:a]{af}[a]',
           '-map', '[v]', '-map', '[a]', '-t', f'{dur}', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
           '-profile:v', 'high', '-r', str(fps), '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
           '-movflags', '+faststart', out]
    subprocess.run(cmd, check=True)
    return t

if __name__ == '__main__':
    a = sys.argv[1:]
    t = make(a[0], a[1], a[2], float(a[3]) if len(a) > 3 else 12.0)
    print(f"{a[2]}: {t['title']} ({t['artist']}) από {t.get('best_start')}s")
