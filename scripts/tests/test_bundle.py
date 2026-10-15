import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bundle import SERVICES, digest, verify_bundle


class BundleIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.sha = 'a' * 40
        self.url = 'https://gym.humans.tech'
        self.key = 'public-test-key'
        (self.root / 'source.tar').write_bytes(b'canonical git archive')
        self.manifest = {'format': 1, 'sha': self.sha, 'branch': 'main', 'platform': 'linux/arm64',
                         'public_url': self.url, 'anon_key_sha256': hashlib.sha256(self.key.encode()).hexdigest(),
                         'images': {}, 'files': {}}
        self.archive()

    def archive(self, architecture='arm64', foreign_tag=False):
        config = json.dumps({'architecture': architecture, 'os': 'linux'}).encode()
        image_id = hashlib.sha256(config).hexdigest()
        tags = [f'gym-{service}:{self.sha}' for service in sorted(SERVICES)]
        for service in SERVICES:
            self.manifest['images'][service] = {'tag': f'gym-{service}:{self.sha}', 'id': 'sha256:' + image_id, 'size': 1000}
        entry = {'Config': 'config.json', 'RepoTags': tags + (['other-project:latest'] if foreign_tag else []), 'Layers': []}
        with tarfile.open(self.root / 'images.tar.gz', 'w:gz') as archive:
            for name, data in [('config.json', config), ('manifest.json', json.dumps([entry]).encode())]:
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        self.manifest['files'] = {name: digest(self.root / name) for name in ['source.tar', 'images.tar.gz']}
        self.write()

    def write(self):
        (self.root / 'bundle.json').write_text(json.dumps(self.manifest))

    def verify(self, **changes):
        return verify_bundle(self.root, self.sha, changes.get('source_hash', digest(self.root / 'source.tar')),
                             self.url, changes.get('key', self.key))

    def test_accepts_complete_arm_bundle(self):
        self.assertEqual(self.verify()['sha'], self.sha)

    def test_rejects_corruption_and_wrong_source(self):
        with self.assertRaisesRegex(ValueError, 'source differs'):
            self.verify(source_hash='wrong')
        (self.root / 'images.tar.gz').write_bytes(b'truncated transfer')
        with self.assertRaisesRegex(ValueError, 'checksum'):
            self.verify()

    def test_rejects_development_and_wrong_configuration(self):
        with self.assertRaisesRegex(ValueError, 'configuration'):
            self.verify(key='another-installation')
        self.manifest['branch'] = 'development'
        self.write()
        with self.assertRaisesRegex(ValueError, 'main SHA'):
            self.verify()

    def test_rejects_foreign_project_tags(self):
        self.archive(foreign_tag=True)
        with self.assertRaisesRegex(ValueError, 'unexpected image tags'):
            self.verify()

    def test_rejects_emulated_image_even_when_manifest_claims_arm(self):
        self.archive(architecture='amd64')
        with self.assertRaisesRegex(ValueError, 'Non-ARM64'):
            self.verify()


if __name__ == '__main__':
    unittest.main()
