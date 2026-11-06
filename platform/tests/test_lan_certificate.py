import http.client
from functools import partial
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import lan_certificate
import serve


def certificate_text(certificate_path):
    result = subprocess.run(
        ['openssl', 'x509', '-in', str(certificate_path), '-noout', '-text'],
        check=True, capture_output=True, text=True,
    )
    return result.stdout


class LanCertificateTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.root = Path(directory.name)
        self.authority_directory = self.root / 'authority'
        self.output_directory = self.root / 'server'
        self.hosts = ['192.168.1.20', 'laptop.local', 'localhost', '127.0.0.1']

    def issue(self):
        return lan_certificate.issue_server_certificate(self.authority_directory, self.output_directory, self.hosts)

    def test_server_certificate_chains_to_the_authority_and_names_every_host(self):
        public_authority_path = self.issue()
        server_certificate = self.output_directory / 'server.crt'
        subprocess.run(
            ['openssl', 'verify', '-x509_strict', '-CAfile', str(public_authority_path), str(server_certificate)],
            check=True, capture_output=True,
        )
        text = certificate_text(server_certificate)
        for expected in ['IP Address:192.168.1.20', 'DNS:laptop.local', 'DNS:localhost', 'IP Address:127.0.0.1']:
            self.assertIn(expected, text)

    def test_authority_cannot_vouch_for_a_public_name(self):
        public_authority_path = self.issue()
        lan_certificate.issue_server_certificate(self.authority_directory, self.root / 'public', ['example.com'])
        refused = subprocess.run(
            ['openssl', 'verify', '-CAfile', str(public_authority_path), str(self.root / 'public' / 'server.crt')],
            capture_output=True, text=True,
        )
        self.assertNotEqual(refused.returncode, 0)
        self.assertIn('permitted subtree violation', refused.stdout + refused.stderr)

    def test_reissuing_keeps_the_authority_that_devices_already_trust(self):
        first_authority = self.issue().read_bytes()
        first_server = (self.output_directory / 'server.crt').read_bytes()
        second_authority = self.issue().read_bytes()
        self.assertEqual(first_authority, second_authority)
        self.assertNotEqual(first_server, (self.output_directory / 'server.crt').read_bytes())

    def test_private_keys_are_readable_only_by_their_owner(self):
        self.issue()
        for key_path in [self.authority_directory / 'ca.key', self.output_directory / 'server.key']:
            self.assertEqual(key_path.stat().st_mode & 0o077, 0)

    def test_fingerprint_matches_openssl(self):
        public_authority_path = self.issue()
        result = subprocess.run(
            ['openssl', 'x509', '-in', str(public_authority_path), '-noout', '-fingerprint', '-sha256'],
            check=True, capture_output=True, text=True,
        )
        self.assertEqual(result.stdout.strip().split('=')[1], lan_certificate.certificate_fingerprint(public_authority_path))

    def test_tls_server_is_trusted_serves_ranges_and_offers_the_authority(self):
        public_authority_path = self.issue()
        artifact = self.root / 'artifact'
        artifact.mkdir()
        (artifact / 'data.bin').write_bytes(b'0123456789')
        handler = partial(serve.TlsHandler, directory=str(artifact), authority_certificate=public_authority_path)
        server = serve.create_tls_server(
            ('127.0.0.1', 0), handler, self.output_directory / 'server.crt', self.output_directory / 'server.key',
        )
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        self.addCleanup(server.server_close)
        self.addCleanup(server.shutdown)
        trusting_context = ssl.create_default_context(cafile=str(public_authority_path))
        connection = http.client.HTTPSConnection('localhost', server.server_address[1], context=trusting_context)
        self.addCleanup(connection.close)
        connection.request('GET', '/data.bin', headers={'Range': 'bytes=2-4'})
        response = connection.getresponse()
        self.assertEqual((response.status, response.read()), (206, b'234'))
        connection.request('GET', '/lan-ca.crt')
        response = connection.getresponse()
        self.assertEqual(response.status, 200)
        self.assertEqual(response.getheader('Content-Type'), 'application/x-x509-ca-cert')
        self.assertEqual(response.read(), public_authority_path.read_bytes())


if __name__ == '__main__':
    unittest.main()
