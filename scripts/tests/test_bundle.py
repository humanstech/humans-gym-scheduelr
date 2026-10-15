import hashlib
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from bundle import SERVICES, digest, image_matches, verify_bundle


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

    def archive(self, architecture='arm64', foreign_tag=False, oci=False, wrong_config=False):
        config = json.dumps({'architecture': architecture, 'os': 'linux'}).encode()
        image_id = hashlib.sha256(config).hexdigest()
        tags = [f'gym-{service}:{self.sha}' for service in sorted(SERVICES)]
        for service in SERVICES:
            self.manifest['images'][service] = {'tag': f'gym-{service}:{self.sha}', 'id': 'sha256:' + image_id, 'size': 1000}
        entry = {'Config': 'config.json', 'RepoTags': tags + (['other-project:latest'] if foreign_tag else []), 'Layers': []}
        files = [('config.json', config), ('manifest.json', json.dumps([entry]).encode())]
        if oci:
            content = json.dumps({'config': {'digest': 'sha256:' + ('0' * 64 if wrong_config else image_id)}}).encode()
            oci_id = hashlib.sha256(content).hexdigest()
            index = {'manifests': [{'digest': 'sha256:' + oci_id, 'annotations': {'io.containerd.image.name': 'docker.io/library/' + tag}} for tag in tags]}
            files += [('index.json', json.dumps(index).encode()), ('blobs/sha256/' + oci_id, content)]
        with tarfile.open(self.root / 'images.tar.gz', 'w:gz') as archive:
            for name, data in files:
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

    def test_derives_containerd_identity_from_checked_oci_content(self):
        self.archive(oci=True)
        self.assertTrue(all(info.get('manifest_id', '').startswith('sha256:') for info in self.verify()['images'].values()))
        self.archive(oci=True, wrong_config=True)
        with self.assertRaisesRegex(ValueError, 'different image configuration'):
            self.verify()

    def test_classic_and_containerd_image_identity(self):
        expected = {'id': 'sha256:config', 'manifest_id': 'sha256:manifest'}
        for identity in ['sha256:config', 'sha256:manifest']:
            self.assertTrue(image_matches({'Id': identity, 'Os': 'linux', 'Architecture': 'arm64'}, expected))
        self.assertFalse(image_matches({'Id': 'sha256:other', 'Os': 'linux', 'Architecture': 'arm64'}, expected))
        self.assertFalse(image_matches({'Id': 'sha256:manifest', 'Os': 'linux', 'Architecture': 'amd64'}, expected))

    def test_does_not_trust_manifest_id_supplied_in_bundle_json(self):
        for info in self.manifest['images'].values():
            info['manifest_id'] = 'sha256:unchecked'
        self.write()
        self.assertTrue(all('manifest_id' not in info for info in self.verify()['images'].values()))

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
