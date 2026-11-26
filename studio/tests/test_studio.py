"""Δοκιμές studio χωρίς internet και χωρίς στοιχεία πελατών (φτιάχνουν δικό τους δοκιμαστικό πελάτη TST).

    python3 -m unittest discover -s studio/tests -v
"""
import json, os, shutil, subprocess, sys, tempfile, unittest
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
STUDIO = HERE.parent
sys.path.insert(0, str(STUDIO))

from PIL import Image  # noqa: E402

FFMPEG = shutil.which('ffmpeg') and shutil.which('ffprobe')


def make_work(root, key='TST', mode='fill_reel_slots_then_posts_then_next_month', aliases=()):
    """Ψεύτικο publisher-work: clients/<K>/config.json + groups/demo/{group.json, logos/}."""
    root = Path(root)
    (root / 'clients' / key).mkdir(parents=True)
    g = root / 'groups' / 'demo'
    (g / 'logos').mkdir(parents=True)
    Image.new('RGBA', (400, 200), (10, 20, 30, 255)).save(g / 'logos' / 'logo.png')
    Image.new('RGB', (400, 200), (250, 240, 0)).save(g / 'logos' / 'logo_on_primary.png')
    (g / 'group.json').write_text(json.dumps({
        'key': 'demo', 'brand': {'colors': {'primary': '#112233', 'accent': '#445566', 'dark': '#778899', 'text': '#000000'},
                                 'fonts': {'titles': 'M PLUS Rounded 1c', 'text': 'Manrope'},
                                 'logos': {'default': 'logos/logo.png', 'on_primary': 'logos/logo_on_primary.png'},
                                 'language': 'el'},
        'banned_phrases': ['απαγορευμ']}), encoding='utf-8')
    (root / 'clients' / key / 'config.json').write_text(json.dumps({
        'key': key, 'name': 'Δοκιμαστικός πελάτης', 'group': 'demo', 'aliases': list(aliases),
        'post_days': ['Δευτέρα', 'Τετάρτη', 'Παρασκευή', 'Κυριακή'], 'post_time': '21:00', 'story_time': '09:30',
        'cta': {'type': 'phone', 'landline': '210 000 0000', 'mobile': '690 000 0000'},
        'ready_reels_mode': mode}), encoding='utf-8')
    return root


class ClientTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        make_work(self.tmp, aliases=('OLD',))
        import client
        self.client = client

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_load(self):
        c = self.client.load('tst', self.tmp)
        self.assertEqual(c.key, 'TST')
        self.assertEqual(c.accounts, ['TST', 'OLD'])
        self.assertEqual(c.color('primary'), '#112233')
        self.assertEqual(c.color('cream'), '#FFFBEA')                   # προεπιλογή όταν λείπει
        self.assertEqual(c.post_weekdays, {0, 2, 4, 6})
        self.assertEqual((c.post_time, c.story_time), ('21:00', '09:30'))
        self.assertEqual(c.phones, [('Σταθερό', '210 000 0000'), ('Κινητό', '690 000 0000')])
        self.assertTrue(str(c.logo('on_primary')).endswith('logo_on_primary.png'))
        self.assertTrue(str(c.logo('logo.png')).endswith('logo.png'))  # και με όνομα αρχείου
        self.assertEqual(c.banned_phrases, ['απαγορευμ'])

    def _best(self, **kw):
        from datetime import timezone, timedelta
        bt = {'mode': 'auto', 'post_time': '20:00', 'story_time': '11:00',
              'updated': (datetime.now(timezone.utc) - timedelta(days=kw.pop('age', 5))).isoformat().replace('+00:00', 'Z')}
        bt.update(kw)
        (Path(self.tmp) / 'clients' / 'TST' / 'best_times.json').write_text(json.dumps(bt), encoding='utf-8')

    def _times(self, mode):
        p = Path(self.tmp) / 'clients' / 'TST' / 'config.json'
        cfg = json.loads(p.read_text(encoding='utf-8'))
        if mode is None:
            cfg.pop('times', None)
        else:
            cfg['times'] = mode
        p.write_text(json.dumps(cfg), encoding='utf-8')

    def test_times_manual_by_default(self):
        self._best()
        cl = self.client.load('TST', self.tmp)
        self.assertEqual(cl.times_mode, 'manual')
        self.assertEqual((cl.post_time, cl.story_time), ('21:00', '09:30'))

    def test_times_auto(self):
        self._times('auto')
        cl = self.client.load('TST', self.tmp)
        self.assertEqual((cl.post_time, cl.story_time), ('21:00', '09:30'), 'χωρίς αρχείο: ώρες του config')
        self._best()
        cl = self.client.load('TST', self.tmp)
        self.assertEqual((cl.post_time, cl.story_time), ('20:00', '11:00'))
        for bad in ({'mode': 'default'}, {'age': 100}, {'post_time': '25:00'}, {'updated': 'όχι ημερομηνία'}):
            self._best(**bad)
            cl = self.client.load('TST', self.tmp)
            self.assertEqual((cl.post_time, cl.story_time), ('21:00', '09:30'), bad)

    def test_bad_key_and_missing(self):
        with self.assertRaises(SystemExit):
            self.client.load('x', self.tmp)
        with self.assertRaises(SystemExit):
            self.client.load('NOPE', self.tmp)

    def test_batch_dir_and_captions(self):
        c = self.client.load('TST', self.tmp)
        b = Path(self.tmp) / 'batch'
        (b / 'OLD').mkdir(parents=True)
        self.assertEqual(c.batch_dir_name(b), 'OLD')                   # παλιά παρτίδα με alias
        (b / 'TST').mkdir()
        self.assertEqual(c.batch_dir_name(b), 'TST')
        caps = {'OLD|2027-01-04': 'α', 'TST|2027-01-06|reel': {'story': False}}
        self.assertEqual(c.caption(caps, 'TST', '2027-01-04'), 'α')
        self.assertEqual(c.caption(caps, 'TST', '2027-01-06', 'reel'), {'story': False})
        self.assertEqual(self.client.fontsource_id('M PLUS Rounded 1c'), 'm-plus-rounded-1c')


class EngineTest(unittest.TestCase):
    """Το engine διαβάζει τον πελάτη στο import: τρέχει σε ξεχωριστή διεργασία."""

    def test_brand_in_html(self):
        tmp = tempfile.mkdtemp()
        try:
            make_work(tmp)
            code = ("import engine as e\n"
                    "d = e.cta('Τίτλος', 'Κείμενο') + e.quote('Πολύ καλό', 'Α.Β.') + e.cover('x.jpg', 'Τίτλος')\n"
                    "assert '#445566' in d and '#112233' in d and '#778899' in d, 'χρώματα'\n"
                    "assert 'rgba(119,136,153,.12)' in d, 'σκιά'\n"
                    "assert '210\\u00a0000\\u00a00000' in d, 'τηλέφωνο'\n"
                    "assert 'logo_on_primary.png' in d, 'λογότυπο'\n"
                    "assert '__' not in d.replace('__W__', ''), 'ξεχασμένο σημάδι χρώματος'\n"
                    "assert e.ls_cta is e.cta\n"
                    "print('ok')\n")
            env = dict(os.environ, OKP_CLIENT='TST', OKP_WORK=tmp)
            r = subprocess.run([sys.executable, '-c', code], cwd=STUDIO, env=env, capture_output=True, text=True)
            self.assertEqual(r.returncode, 0, r.stderr)
        finally:
            shutil.rmtree(tmp)


class MakeQueueTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        make_work(self.tmp / 'work', aliases=('OLD',))
        import client, make_queue, privacy_check
        self.mq, self.pc = make_queue, privacy_check
        self.cl = client.load('TST', self.tmp / 'work')
        self.batch = self.tmp / 'batch'
        d = self.batch / 'TST'
        d.mkdir(parents=True)
        for n in ('2027-01-04_post_01.jpg', '2027-01-04_post_02.jpg', '2027-01-05_story_01.jpg', '2027-03-29_post_01.jpg'):
            Image.new('RGB', (108, 135), (200, 100, 50)).save(d / n, 'JPEG')
        (self.batch / 'captions.json').write_text(json.dumps({
            'TST|2027-01-04': 'Καλημέρα #a #b', 'TST|2027-03-29': 'Άνοιξη'}), encoding='utf-8')
        self.mark_all()
        self.repo = self.tmp / 'repo'
        self.repo.mkdir()

    def mark_all(self):
        files = {}
        for p in (self.batch / 'TST').iterdir():
            files[f'TST/{p.name}'] = {'sha256': self.pc.sha256(p), 'reviewed': True, 'status': 'ok', 'metadata': []}
        (self.batch / 'privacy_manifest.json').write_text(json.dumps({'files': files}), encoding='utf-8')

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def test_build(self):
        now = datetime.fromisoformat('2027-01-01T12:00:00+02:00')
        items = self.mq.build(str(self.batch), str(self.repo), self.cl, now=now)
        by = {i['id']: i for i in items}
        self.assertEqual(set(by), {'TST-2027-01-04-post', 'TST-2027-01-05-story', 'TST-2027-03-29-post'})
        self.assertEqual(by['TST-2027-01-04-post']['type'], 'CAROUSEL')
        self.assertEqual(by['TST-2027-01-04-post']['publish_at'], '2027-01-04T21:00:00+02:00')
        self.assertEqual(by['TST-2027-01-05-story']['publish_at'], '2027-01-05T09:30:00+02:00')
        self.assertEqual(by['TST-2027-03-29-post']['publish_at'], '2027-03-29T21:00:00+03:00')   # θερινή ώρα
        self.assertTrue(by['TST-2027-01-04-post']['images'][0].startswith(
            'https://raw.githubusercontent.com/okpublisher/publisher/main/media/2027-01/TST/'))
        self.assertTrue((self.repo / 'media/2027-01/TST/2027-01-04_post_02.jpg').exists())
        self.assertEqual({i['account'] for i in items}, {'TST'})

    def test_refuses_unchecked_file(self):
        Image.new('RGB', (108, 135), (0, 0, 0)).save(self.batch / 'TST' / '2027-01-06_post_01.jpg', 'JPEG')
        with self.assertRaises(SystemExit):
            self.mq.build(str(self.batch), str(self.repo), self.cl, now=datetime.fromisoformat('2027-01-01T12:00:00+02:00'))

    def test_banned_phrase(self):
        (self.batch / 'captions.json').write_text(json.dumps({'TST|2027-01-04': 'Είμαστε απαγορευμένοι', 'TST|2027-03-29': 'x'}),
                                                  encoding='utf-8')
        with self.assertRaises(AssertionError):
            self.mq.build(str(self.batch), str(self.repo), self.cl, now=datetime.fromisoformat('2027-01-01T12:00:00+02:00'))

    def test_late_items_skipped(self):
        items = self.mq.build(str(self.batch), str(self.repo), self.cl, now=datetime.fromisoformat('2027-01-05T09:20:00+02:00'))
        self.assertEqual([i['id'] for i in items], ['TST-2027-03-29-post'])

    def test_clash_guard(self):
        existing = [{'id': 'OLD-2027-01-04-post', 'account': 'OLD', 'type': 'IMAGE', 'publish_at': '2027-01-04T21:00:00+02:00'},
                    {'id': 'XYZ-2027-01-04-post', 'account': 'XYZ', 'type': 'IMAGE', 'publish_at': '2027-01-04T21:00:00+02:00'}]
        new = [{'id': 'TST-2027-01-04-post', 'account': 'TST', 'type': 'REEL', 'publish_at': '2027-01-04T21:00:00+02:00'}]
        self.assertEqual(self.mq.clashes(existing, new, set(self.cl.accounts)), [('TST-2027-01-04-post', 'OLD-2027-01-04-post')])
        with self.assertRaises(SystemExit):
            self.mq.merge({'items': existing}, new, set(self.cl.accounts))
        # ίδιο ID = αντικατάσταση (διόρθωση), όχι σύγκρουση· άλλος πελάτης στην ίδια ώρα = εντάξει
        q = self.mq.merge({'items': existing[1:] + new}, [dict(new[0], caption='νέα')], set(self.cl.accounts))
        self.assertEqual(len(q['items']), 2)


class ReadyReelsPlaceTest(unittest.TestCase):
    def setUp(self):
        import ready_reels
        self.rr = ready_reels
        self.post = {0, 2, 4, 6}          # Δευ, Τετ, Παρ, Κυρ
        # Ιανουάριος 2027: Παρ 1, Κυρ 3, Δευ 4, Τετ 6 …
        self.our = ['2027-01-06', '2027-01-15']

    def test_fill_reel_slots_then_posts(self):
        r = self.rr.place('2027-01', self.post, self.our, ['b.mp4', 'a.mp4', 'c.mp4'], 'fill_reel_slots_then_posts_then_next_month')
        self.assertEqual(r['assign'], {'2027-01-01': 'c.mp4', '2027-01-06': 'a.mp4', '2027-01-15': 'b.mp4'})
        self.assertEqual(r['replaces'], {'2027-01-01': 'post', '2027-01-06': 'reel', '2027-01-15': 'reel'})
        self.assertEqual(r['next_month'], [])

    def test_overflow_next_month(self):
        names = [f'{i:02d}.mp4' for i in range(20)]
        r = self.rr.place('2027-01', self.post, self.our, names, 'fill_reel_slots_then_posts_then_next_month')
        self.assertEqual(len(r['assign']), 18)                        # 18 ημέρες post τον Ιανουάριο 2027
        self.assertEqual(r['next_month'], ['18.mp4', '19.mp4'])
        self.assertEqual(len(set(r['assign'])), len(r['assign']))     # ποτέ δύο σε μία ημέρα

    def test_all_in_month(self):
        names = [f'{i:02d}.mp4' for i in range(20)]
        r = self.rr.place('2027-01', self.post, self.our, names, 'all_in_month')
        self.assertEqual(len(r['assign']), 20)
        self.assertEqual(r['next_month'], [])
        self.assertIn('extra', r['replaces'].values())

    def test_period_instead_of_month(self):
        import ready_reels
        r = ready_reels.place('2027-01-22:2027-02-21', {0, 2, 4, 6}, ['2027-01-25'],
                              ['a.mp4', '2027-02-10 b.mp4', '2027-02-25 c.mp4'], 'fill_reel_slots_then_posts_then_next_month')
        self.assertEqual(r['assign'].get('2027-01-25'), 'a.mp4', 'πρώτα στη θέση του δικού μας reel μέσα στην περίοδο')
        self.assertEqual(r['assign'].get('2027-02-10'), '2027-02-10 b.mp4', 'κλειδωμένη ημερομηνία μέσα στην περίοδο (άλλος μήνας)')
        self.assertIn('2027-02-25 c.mp4', r['next_month'], 'μετά το τέλος της περιόδου → επόμενη')
        self.assertTrue(all('2027-01-22' <= d <= '2027-02-21' for d in r['assign']))

    def test_locked_dates(self):
        names = ['2027-01-07 μάθημα.mp4', '2027-01-07 δεύτερο.mp4', '2027-02-03 φεβ.mp4', 'x.mp4']
        r = self.rr.place('2027-01', self.post, self.our, names, 'fill_reel_slots_then_posts_then_next_month')
        self.assertEqual(r['assign']['2027-01-07'], '2027-01-07 δεύτερο.mp4')   # κλειδωμένο (Πέμπτη: επιπλέον θέση)
        self.assertEqual(r['replaces']['2027-01-07'], 'extra')
        self.assertIn('2027-02-03 φεβ.mp4', r['next_month'])
        self.assertEqual(r['assign']['2027-01-06'], '2027-01-07 μάθημα.mp4')     # σύγκρουση → ελεύθερη θέση reel
        self.assertEqual(r['assign']['2027-01-15'], 'x.mp4')


@unittest.skipUnless(FFMPEG, 'χωρίς ffmpeg')
class ReadyReelsVideoTest(unittest.TestCase):
    def setUp(self):
        import ready_reels
        self.rr = ready_reels
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp)

    def video(self, name, w, h, sec, fps=30, extra=()):
        p = self.tmp / name
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f'testsrc=size={w}x{h}:rate={fps}:duration={sec}',
                        '-f', 'lavfi', '-i', f'sine=frequency=440:duration={sec}', '-shortest',
                        '-metadata', 'location=+40.6-022.9/', *extra, str(p)], check=True)
        return p

    def test_check_and_prepare(self):
        ok = self.video('ok.mp4', 540, 960, 4, extra=('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'))
        r = self.rr.check(ok)
        self.assertTrue(r['ok'], r)
        self.assertEqual(r['reencode'], [])
        self.assertTrue(r['story'])
        out = self.tmp / 'out' / 'reel.mp4'
        self.rr.prepare(ok, out)
        import privacy_check
        self.assertEqual(privacy_check.metadata_problems(out), [])     # η τοποθεσία έφυγε

    def test_wrong_ratio_and_short(self):
        r = self.rr.check(self.video('wide.mp4', 640, 360, 2))
        self.assertFalse(r['ok'])
        self.assertEqual(len(r['problems']), 2)
        with self.assertRaises(SystemExit):
            self.rr.prepare(self.tmp / 'wide.mp4', self.tmp / 'x.mp4')

    def test_reencode(self):
        src = self.video('hi.mp4', 1080, 1920, 3.5, fps=15, extra=('-c:v', 'mpeg4', '-c:a', 'aac'))
        r = self.rr.check(src)
        self.assertTrue(r['ok'])
        self.assertTrue(r['reencode'])
        after = self.rr.prepare(src, self.tmp / 'fixed.mp4')
        self.assertEqual(after['reencode'], [])
        self.assertEqual((after['width'], after['height']), (1080, 1920))

    def test_add_to_batch(self):
        tmp = self.tmp
        make_work(tmp / 'work')
        import client
        cl = client.load('TST', tmp / 'work')
        src = self.video('2027-01-07 μάθημα.mp4', 540, 960, 4, extra=('-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac'))
        (tmp / '2027-01-07 μάθημα.txt').write_text('Λεζάντα συνεργάτη', encoding='utf-8')
        batch = tmp / 'batch'
        self.rr.add(batch, '2027-01-07', src, cl)
        self.assertTrue((batch / 'TST' / '2027-01-07_reel.mp4').exists())
        self.assertTrue((batch / 'TST' / '2027-01-07_reel_cover.jpg').exists())
        caps = json.loads((batch / 'captions.json').read_text(encoding='utf-8'))
        self.assertEqual(caps['TST|2027-01-07'], 'Λεζάντα συνεργάτη')
        self.assertTrue(caps['TST|2027-01-07|reel']['ready'])


class CleanupTest(unittest.TestCase):
    def test_raw_base(self):
        import cleanup_repo
        tmp = tempfile.mkdtemp()
        try:
            subprocess.run(['git', 'init', '-q', tmp], check=True)
            for url, want in (('https://github.com/okpublisher/publisher', 'okpublisher/publisher'),
                              ('git@github.com:someone/old-repo.git', 'someone/old-repo'),
                              ('http://127.0.0.1:1234/git/owner/name', 'owner/name')):
                subprocess.run(['git', '-C', tmp, 'remote', 'remove', 'origin'], capture_output=True)
                subprocess.run(['git', '-C', tmp, 'remote', 'add', 'origin', url], check=True)
                self.assertEqual(cleanup_repo.raw_base(tmp), f'https://raw.githubusercontent.com/{want}/main/')
        finally:
            shutil.rmtree(tmp)


class MusicTest(unittest.TestCase):
    """music.py: σετ ανά κλάδο, διαθέσεις, όχι επαναλήψεις, αποκλεισμός, «χωρίς μουσική» (χωρίς internet)."""

    def setUp(self):
        import client, music, story_video
        self.client, self.music, self.story_video = client, music, story_video
        self.tmp = tempfile.mkdtemp()
        make_work(self.tmp)
        def tr(tid, s, mood, dur=120.0, **kw):
            return {'id': tid, 'set': s, 'mood': mood, 'title': tid, 'artist': 'x', 'dur': dur, 'best_start': 10.0,
                    'page': 'https://pixabay.com/music/x-1/', 'url': f'https://cdn.pixabay.com/audio/{tid}.mp3', **kw}
        self.lib = {'sets': {'kids': 'παιδικά', 'cafe': 'καφέ'},
                    'moods': {'playful': '', 'calm': '', 'warm': '', 'elegant': ''},
                    'tracks': [tr('k1', 'kids', 'playful'), tr('k2', 'kids', 'playful'), tr('k3', 'kids', 'calm'),
                               tr('k4', 'kids', 'playful', blocked='2026-12-01: σίγαση'), tr('k5', 'kids', 'playful', dur=15.0),
                               tr('c1', 'cafe', 'warm')]}
        self.libfile = Path(self.tmp) / 'music_library.json'
        self.libfile.write_text(json.dumps(self.lib), encoding='utf-8')
        self.old_env = os.environ.get('MUSIC_LIBRARY')
        os.environ['MUSIC_LIBRARY'] = str(self.libfile)

    def tearDown(self):
        if self.old_env is None:
            os.environ.pop('MUSIC_LIBRARY', None)
        else:
            os.environ['MUSIC_LIBRARY'] = self.old_env
        shutil.rmtree(self.tmp)

    def cl(self, music=None, group_music=None):
        root = Path(self.tmp)
        cfg_p = root / 'clients' / 'TST' / 'config.json'
        cfg = json.loads(cfg_p.read_text(encoding='utf-8'))
        cfg.pop('music', None)
        if music is not None:
            cfg['music'] = music
        cfg_p.write_text(json.dumps(cfg), encoding='utf-8')
        g_p = root / 'groups' / 'demo' / 'group.json'
        g = json.loads(g_p.read_text(encoding='utf-8'))
        g.pop('music', None)
        if group_music is not None:
            g['music'] = group_music
        g_p.write_text(json.dumps(g), encoding='utf-8')
        return self.client.load('TST', self.tmp)

    def test_real_library_is_valid(self):
        real = json.loads((STUDIO / 'music_library.json').read_text(encoding='utf-8'))
        self.assertEqual(self.music.problems(real), [])
        self.assertIn('kids', real['sets'])
        self.assertTrue(all(t['set'] in real['sets'] for t in real['tracks']))

    def test_problems_found(self):
        bad = json.loads(json.dumps(self.lib))
        bad['tracks'].append(dict(bad['tracks'][0]))                        # διπλό id
        bad['tracks'][1]['url'] = 'https://example.com/a.mp3'                # όχι Pixabay
        bad['tracks'][2]['mood'] = 'sad'                                     # άγνωστη διάθεση
        p = self.music.problems(bad)
        self.assertTrue(any('διπλό' in x for x in p) and any('url' in x for x in p) and any('διάθεση' in x for x in p))

    def test_group_music_and_client_override(self):
        c = self.cl(group_music={'set': 'kids', 'moods': ['playful', 'calm']}, music={'avoid_days': 5})
        self.assertEqual(c.music, {'set': 'kids', 'moods': ['playful', 'calm'], 'avoid_days': 5})
        self.assertEqual(self.cl().music, {'avoid_days': 10, 'moods': []})

    def test_pick_set_mood_blocked_and_length(self):
        c = self.cl(group_music={'set': 'kids', 'moods': ['playful', 'calm']})
        seen = {self.music.pick(c, f'2027-01-{d:02d}', 'playful', min_dur=20, lib=self.lib, log=[])[0]['id'] for d in range(1, 29)}
        self.assertEqual(seen, {'k1', 'k2'})           # όχι το αποκλεισμένο k4, όχι το μικρό k5, όχι άλλο σετ
        t, notes = self.music.pick(c, '2027-01-03', 'calm', lib=self.lib, log=[])
        self.assertEqual(t['id'], 'k3')
        t, notes = self.music.pick(c, '2027-01-03', 'elegant', lib=self.lib, log=[])
        self.assertEqual(t['mood'], 'playful')         # δεν υπάρχει elegant στο σετ → η 1η διάθεση του πελάτη
        self.assertTrue(notes)

    def test_no_repeat_within_avoid_days(self):
        c = self.cl(music={'set': 'kids', 'moods': ['playful'], 'avoid_days': 10})
        log = [{'date': '2027-01-01', 'track': 'k1', 'item': 'a.mp4'}]
        self.assertEqual(self.music.pick(c, '2027-01-05', 'playful', min_dur=20, lib=self.lib, log=log)[0]['id'], 'k2')
        log.append({'date': '2027-01-06', 'track': 'k2', 'item': 'b.mp4'})
        t, notes = self.music.pick(c, '2027-01-08', 'playful', min_dur=20, lib=self.lib, log=log)
        self.assertEqual(t['id'], 'k1')                # όλα πρόσφατα → το πιο «μακρινό»
        self.assertTrue(notes)

    def test_prefers_tracks_without_content_id(self):
        lib = json.loads(json.dumps(self.lib))
        next(x for x in lib['tracks'] if x['id'] == 'k1')['youtube_content_id'] = True
        c = self.cl(music={'set': 'kids', 'moods': ['playful']})
        picks = {self.music.pick(c, f'2027-02-{d:02d}', 'playful', min_dur=20, lib=lib, log=[])[0]['id'] for d in range(1, 29)}
        self.assertEqual(picks, {'k2'})                # ίδια χρήση → πάντα αυτό χωρίς Content ID

    def test_none_and_missing_set(self):
        c = self.cl(music={'none': True})
        t, notes = self.music.pick(c, '2027-01-05', lib=self.lib, log=[])
        self.assertIsNone(t)
        with self.assertRaises(SystemExit):
            self.music.pick(self.cl(), '2027-01-05', lib=self.lib, log=[])                  # χωρίς σετ
        with self.assertRaises(SystemExit):
            self.music.pick(self.cl(music={'set': 'beauty'}), '2027-01-05', lib=self.lib, log=[])  # σετ που δεν υπάρχει

    def test_record_and_cli(self):
        self.cl(music={'set': 'kids', 'moods': ['playful']})
        env = dict(os.environ, OKP_WORK=self.tmp, OKP_CLIENT='TST', MUSIC_LIBRARY=str(self.libfile))
        out = subprocess.run([sys.executable, str(STUDIO / 'music.py'), 'pick', '--date', '2027-01-04', '--mood', 'playful',
                              '--record', '2027-01-04_reel.mp4'], env=env, capture_output=True, text=True, check=True).stdout
        tid = out.split('\t')[0]
        log = json.loads((Path(self.tmp) / 'clients' / 'TST' / 'music_log.json').read_text(encoding='utf-8'))
        self.assertEqual([(e['date'], e['track'], e['item']) for e in log], [('2027-01-04', tid, '2027-01-04_reel.mp4')])
        out2 = subprocess.run([sys.executable, str(STUDIO / 'music.py'), 'pick', '--date', '2027-01-07', '--mood', 'playful'],
                              env=env, capture_output=True, text=True, check=True).stdout
        self.assertNotEqual(out2.split('\t')[0], tid)  # όχι το ίδιο 3 ημέρες μετά
        where = subprocess.run([sys.executable, str(STUDIO / 'music.py'), 'where', tid], env=env,
                               capture_output=True, text=True, check=True).stdout
        self.assertIn('TST\t2027-01-04\t2027-01-04_reel.mp4', where)
        subprocess.run([sys.executable, str(STUDIO / 'music.py'), 'block', tid, '--reason', 'σίγαση στο Instagram'],
                       env=env, capture_output=True, text=True, check=True)
        lib = json.loads(self.libfile.read_text(encoding='utf-8'))
        self.assertIn('σίγαση', next(t for t in lib['tracks'] if t['id'] == tid)['blocked'])

    def test_track_refuses_blocked_and_unknown(self):
        with self.assertRaises(SystemExit):
            self.story_video.track('k4')               # αποκλεισμένο: σταματά πριν από οποιοδήποτε κατέβασμα
        with self.assertRaises(SystemExit):
            self.story_video.track('xx')
        with self.assertRaises(SystemExit):
            self.story_video.make('a.jpg', 'none', 'out.mp4')

    def test_best_window_and_ids(self):
        levels = [0.1] * 40 + [1.0] * 60 + [0.1] * 40   # δυνατό κομμάτι 20″–50″ (βήμα 0,5″)
        self.assertEqual(self.music.best_window(levels), 20.0)
        self.assertEqual(self.music.best_window([1.0] * 10), 0.0)
        self.assertEqual(self.music.next_id({'id_prefix': {'kids': 'ls'}, 'tracks': [{'id': 'ls_16'}, {'id': 'k1'}]}, 'kids'), 'ls_17')
        self.assertEqual(self.music.next_id({'tracks': []}, 'cafe'), 'cafe_01')

    @unittest.skipUnless(FFMPEG, 'χρειάζεται ffmpeg')
    def test_reel_without_music(self):
        img = Path(self.tmp) / 'p.jpg'
        Image.new('RGB', (1080, 1920), (200, 100, 50)).save(img)
        out = Path(self.tmp) / 'r.mp4'
        subprocess.run([sys.executable, str(STUDIO / 'make_reel.py'), str(out), 'none', f'{img}@1'],
                       check=True, capture_output=True)
        streams = subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', str(out)],
                                 capture_output=True, text=True).stdout.split()
        self.assertEqual(sorted(streams), ['audio', 'video'])


class LogoPrepTest(unittest.TestCase):
    """Λογότυπο σε οποιαδήποτε μορφή → διάφανο PNG + παραλλαγές (logo_prep.py)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _jpg_logo(self, bg=(255, 255, 255)):
        from PIL import ImageDraw
        im = Image.new('RGB', (800, 500), bg)
        d = ImageDraw.Draw(im)
        d.ellipse((150, 100, 450, 400), fill=(200, 30, 40))
        d.ellipse((250, 200, 350, 300), fill=bg)          # «τρύπα» στο χρώμα του φόντου
        d.rectangle((500, 200, 700, 300), fill=(20, 60, 160))
        p = self.tmp / 'Λογότυπο φούρνου.jpg'
        im.save(p, quality=92)
        return p

    def test_jpg_white_background_removed_holes_too_trimmed(self):
        import logo_prep
        r = logo_prep.prepare([self._jpg_logo()], self.tmp / 'out', primary=(200, 30, 40))
        self.assertTrue(r['ok'])
        self.assertIn('αφαιρέθηκε', r['background'])
        im = Image.open(r['files']['default'])
        self.assertEqual(im.mode, 'RGBA')
        self.assertLess(im.width, 650, 'κομμένα περιθώρια')
        a = im.getchannel('A')
        self.assertEqual(a.getpixel((0, 0)), 0, 'διάφανη γωνία')
        self.assertFalse([p for p in im.getdata() if p[3] == 255 and min(p[:3]) > 240], 'και η λευκή «τρύπα» διάφανη (γράμματα Ο, ρ…)')
        self.assertEqual(r['logos']['default'], 'logos/logo.png')
        self.assertEqual(r['logos']['on_primary'], 'logos/logo_white.png', 'κόκκινο λογότυπο σε κόκκινο φόντο → λευκό')
        self.assertTrue(any(c['hex'].startswith('#C') for c in r['colors']), r['colors'])
        self.assertTrue(Path(r['files']['preview']).exists())
        r2 = logo_prep.prepare([self._jpg_logo()], self.tmp / 'out2', keep_holes=True)
        im2 = Image.open(r2['files']['default'])
        self.assertTrue([p for p in im2.getdata() if p[3] == 255 and min(p[:3]) > 240], '--keep-holes: η λευκή τρύπα μένει')

    def test_white_logo_gets_dark_default(self):
        import logo_prep
        im = Image.new('RGBA', (600, 300), (0, 0, 0, 0))
        from PIL import ImageDraw
        ImageDraw.Draw(im).rectangle((100, 100, 500, 200), fill=(255, 255, 255, 255))
        p = self.tmp / 'logo_white.png'
        im.save(p)
        r = logo_prep.prepare([p], self.tmp / 'out', primary=(91, 33, 214))
        self.assertEqual(r['background'], 'είχε ήδη διαφάνεια')
        self.assertEqual(r['logos']['default'], 'logos/logo_dark.png')
        self.assertEqual(r['logos']['on_primary'], 'logos/logo.png')
        self.assertTrue(any('ανοιχτόχρωμο' in w for w in r['warnings']))

    def test_photo_background_warns(self):
        import logo_prep
        rng = __import__('numpy').random.default_rng(1)
        p = self.tmp / 'tampela.jpg'
        Image.fromarray(rng.integers(0, 255, (270, 360, 3), dtype='uint8')).save(p)
        r = logo_prep.prepare([p], self.tmp / 'out')
        self.assertTrue(any('Οι άκρες δεν έχουν ένα χρώμα' in w for w in r['warnings']))
        self.assertTrue(any('Μικρό λογότυπο' in w for w in r['warnings']))

    @unittest.skipUnless(shutil.which('rsvg-convert'), 'χωρίς rsvg-convert')
    def test_svg_preferred_over_jpg(self):
        import logo_prep
        svg = self.tmp / 'logo.svg'
        svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect x="20" y="20" width="160" height="60" fill="#0A7"/></svg>')
        r = logo_prep.prepare([self._jpg_logo(), svg], self.tmp / 'out')
        self.assertEqual(r['source'], 'logo.svg')
        self.assertEqual(r['kind'], 'svg')
        self.assertGreater(max(r['size']), 1000, 'διανυσματικό σε μεγάλη ανάλυση')
        self.assertTrue(any('Πολλά αρχεία' in w for w in r['warnings']))

    @unittest.skipUnless(shutil.which('pdftocairo'), 'χωρίς pdftocairo')
    def test_pdf_and_ai(self):
        import logo_prep
        from reportlab.pdfgen import canvas
        p = self.tmp / 'logo.pdf'
        c = canvas.Canvas(str(p), pagesize=(300, 150))
        c.setFillColorRGB(0.1, 0.3, 0.8)
        c.rect(50, 40, 200, 70, fill=1, stroke=0)
        c.save()
        ai = self.tmp / 'logo.ai'
        shutil.copy(p, ai)
        for f in (p, ai):
            r = logo_prep.prepare([f], self.tmp / ('out_' + f.suffix[1:]))
            self.assertEqual(r['kind'], 'pdf')
            self.assertEqual(r['background'], 'είχε ήδη διαφάνεια', 'pdftocairo -transp')
            im = Image.open(r['files']['default'])
            self.assertEqual(im.getchannel('A').getpixel((0, 0)), 0)

    def test_broken_file_is_reported(self):
        import logo_prep
        bad = self.tmp / 'logo.png'
        bad.write_bytes(b'not an image')
        with self.assertRaises(SystemExit) as cm:
            logo_prep.prepare([bad], self.tmp / 'out')
        self.assertIn('δεν άνοιξε', str(cm.exception))


if __name__ == '__main__':
    unittest.main()
