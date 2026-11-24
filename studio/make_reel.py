#!/usr/bin/env python3
"""Reel 1080×1920 από κομμάτια βίντεο/φωτογραφίες + μουσική χωρίς πνευματικά δικαιώματα + κάρτα τέλους.

    python3 make_reel.py <έξοδος.mp4> <track_id> <κομμάτι> [<κομμάτι> …] [--end <κάρτα.jpg>] [--end-sec 3]

κομμάτι:  video.mp4@12.5-16.0   (από–έως σε δευτερόλεπτα)   ή   photo.jpg@3   (φωτογραφία, 3″ με αργό zoom)

Κανόνες:
- Ο ΗΧΟΣ ΤΩΝ ΒΙΝΤΕΟ ΑΦΑΙΡΕΙΤΑΙ ΠΑΝΤΑ (μπορεί να ακούγονται παιδιά ή ονόματα). Μόνο μουσική από το music_library.json.
- Πηγές ΜΟΝΟ από υλικό που πέρασε το privacy_check.py scan, και όπου υπάρχουν παιδιά, η έξοδος του blurfaces
  (θολωμένα πρόσωπα). Το τελικό reel ξαναελέγχεται με verify (κάθε καρέ).
- Το reel χτίζεται από τα κομμάτια ΟΠΩΣ δόθηκαν: κόψε τα σημεία με πρόσωπα/ανθρώπους πριν, με τα χρονολόγια του scan.
- H.264 High 30fps yuv420p, AAC 48kHz, -14 LUFS, faststart, ≤ 60″ (για να μπαίνει και σε story).
"""
import argparse, os, subprocess, sys, tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from story_video import track  # noqa: E402
from privacy_check import clean_file  # noqa: E402

FPS = 30
VF = 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p'


def run(cmd):
    subprocess.run(cmd, check=True)


def piece(spec, i, tmp):
    path, _, rng = spec.rpartition('@')
    if not path:
        path, rng = spec, ''
    out = os.path.join(tmp, f'p{i:02d}.mp4')
    if path.lower().endswith(('.jpg', '.jpeg', '.png')):
        dur = float(rng or 3)
        n = int(dur * FPS)
        vf = (f"scale=2160:3840:force_original_aspect_ratio=increase,crop=2160:3840,"
              f"zoompan=z='1+0.04*on/{n}':d=1:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps={FPS},format=yuv420p")
        run(['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-framerate', str(FPS), '-i', path, '-vf', vf, '-t', f'{dur}',
             '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', out])
    else:
        a, b = (float(x) for x in rng.split('-')) if rng else (0.0, None)
        cmd = ['ffmpeg', '-v', 'error', '-y', '-ss', f'{a}', '-i', path]
        if b is not None:
            cmd += ['-t', f'{b - a}']
        run(cmd + ['-vf', VF, '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', out])
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('out'); ap.add_argument('track'); ap.add_argument('pieces', nargs='+')
    ap.add_argument('--end'); ap.add_argument('--end-sec', type=float, default=3.0)
    a = ap.parse_args()
    with tempfile.TemporaryDirectory() as tmp:
        parts = [piece(s, i, tmp) for i, s in enumerate(a.pieces)]
        if a.end:
            parts.append(piece(f'{a.end}@{a.end_sec}', len(parts), tmp))
        lst = os.path.join(tmp, 'list.txt')
        open(lst, 'w').write(''.join(f"file '{p}'\n" for p in parts))
        silent = os.path.join(tmp, 'silent.mp4')
        run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', lst, '-c', 'copy', silent])
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', silent],
                                   capture_output=True, text=True).stdout)
        if dur > 60:
            sys.exit(f'Reel {dur:.1f}″: πάνω από 60″ (όριο story). Κόψε κομμάτια.')
        t, mp3 = track(a.track)
        start = max(0.0, min(float(t.get('best_start', 0)), float(t.get('dur', 9999)) - dur - 0.5))
        af = (f"atrim=0:{dur},asetpts=PTS-STARTPTS,afade=t=in:st=0:d=0.4,afade=t=out:st={max(0, dur - 2)}:d=2,"
              f"loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000")
        run(['ffmpeg', '-v', 'error', '-y', '-i', silent, '-ss', f'{start:.2f}', '-i', mp3,
             '-filter_complex', f'[1:a]{af}[a]', '-map', '0:v', '-map', '[a]', '-t', f'{dur}',
             '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-profile:v', 'high', '-r', str(FPS),
             '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-map_metadata', '-1', '-movflags', '+faststart', a.out])
        cover = a.out[:-4] + '_cover.jpg'
        raw = os.path.join(tmp, 'cover.png')
        run(['ffmpeg', '-v', 'error', '-y', '-ss', '0.5', '-i', a.out, '-frames:v', '1', raw])
        clean_file(raw, cover)   # JPEG χωρίς σχόλια/metadata
    print(f'{a.out}: {dur:.1f}″, μουσική {t["title"]} ({t["artist"]}) · εξώφυλλο {cover}')
    print('Επόμενο: privacy_check.py verify <παρτίδα> (κάθε καρέ) και οπτικός έλεγχος.')


if __name__ == '__main__':
    main()
