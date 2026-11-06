import http.client
from functools import partial
from pathlib import Path
import ssl
import subprocess
import sys
import tempfile
import threading
import unittest
from unittest import mock

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

    def issue_for(self, hosts):
        return lan_certificate.issue_server_certificate(self.authority_directory, self.output_directory, hosts)

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

    def verify_with_openssl(self, public_authority_path, output_directory):
        return subprocess.run(
            ['openssl', 'verify', '-x509_strict', '-CAfile', str(public_authority_path), str(output_directory / 'server.crt')],
            capture_output=True, text=True,
        )

    def test_even_the_authority_key_cannot_sign_a_trusted_certificate_for_a_public_name(self):
        for public_host in ['example.com', 'internal.example.com', '8.8.8.8', '2001:4860:4860::8888']:
            output_directory = self.root / 'public'
            public_authority_path = lan_certificate.write_server_certificate(
                self.authority_directory, output_directory, [public_host],
            )
            refused = self.verify_with_openssl(public_authority_path, output_directory)
            self.assertNotEqual(refused.returncode, 0, public_host)
            self.assertIn('permitted subtree violation', refused.stdout + refused.stderr, public_host)

    def test_every_kind_of_lan_host_verifies_on_its_own(self):
        lan_hosts = [
            '192.168.1.20', '10.1.2.3', '172.16.0.9', '100.100.1.1', 'fd00::1', '::1',
            'nas.lan', 'printer.local', 'router.home', 'nas.localdomain', 'pi.home.arpa', 'db.internal', 'localhost',
        ]
        for lan_host in lan_hosts:
            output_directory = self.root / 'lan'
            public_authority_path = lan_certificate.issue_server_certificate(
                self.authority_directory, output_directory, [lan_host],
            )
            verified = self.verify_with_openssl(public_authority_path, output_directory)
            self.assertEqual(verified.returncode, 0, f'{lan_host}: {verified.stdout}{verified.stderr}')

    def test_a_host_the_authority_cannot_cover_is_refused_before_anything_is_signed(self):
        for refused_host in ['example.com', 'evillan', 'lan.example.com', 'router.fritz.box', '8.8.8.8', '2001:db8::1']:
            with self.assertRaises(SystemExit) as refusal:
                lan_certificate.issue_server_certificate(self.authority_directory, self.output_directory, [refused_host])
            self.assertIn(refused_host, str(refusal.exception))
        self.assertFalse((self.output_directory / 'server.crt').exists())

    def test_an_authority_with_an_older_permitted_list_is_reported_rather_than_issuing_a_useless_certificate(self):
        with mock.patch.object(lan_certificate, 'PERMITTED_DOMAINS', ['localhost', 'lan']):
            self.issue_for(['nas.lan'])
        with self.assertRaises(SystemExit) as refusal:
            self.issue_for(['router.home'])
        self.assertIn('cannot vouch for router.home', str(refusal.exception))
        self.assertFalse((self.output_directory / 'server.crt').exists())

    def test_a_missing_half_of_the_authority_is_refused_and_never_replaced(self):
        self.issue()
        key_bytes = (self.authority_directory / 'ca.key').read_bytes()
        (self.authority_directory / 'ca.crt').unlink()
        with self.assertRaises(SystemExit) as refusal:
            self.issue()
        self.assertIn('Restore the missing file', str(refusal.exception))
        self.assertEqual((self.authority_directory / 'ca.key').read_bytes(), key_bytes)

    def test_an_authority_key_readable_by_others_is_refused(self):
        self.issue()
        (self.authority_directory / 'ca.key').chmod(0o644)
        with self.assertRaises(SystemExit) as refusal:
            self.issue()
        self.assertIn('chmod 600', str(refusal.exception))

    def test_private_files_stay_private_even_over_loose_existing_ones(self):
        self.output_directory.mkdir(mode=0o777)
        self.output_directory.chmod(0o777)
        (self.output_directory / 'server.key').write_text('old')
        (self.output_directory / 'server.key').chmod(0o644)
        self.issue()
        self.assertEqual((self.output_directory / 'server.key').stat().st_mode & 0o077, 0)
        for directory in [self.authority_directory, self.output_directory]:
            self.assertEqual(directory.stat().st_mode & 0o077, 0)

    def test_a_vpn_or_missing_route_never_breaks_the_default_hosts(self):
        with mock.patch.object(lan_certificate.socket, 'socket') as fake_socket:
            fake_socket.return_value.__enter__.return_value.getsockname.return_value = ('8.8.4.4', 0)
            self.assertIsNone(lan_certificate.detected_lan_address())
            fake_socket.return_value.__enter__.return_value.connect.side_effect = OSError('no route')
            self.assertIsNone(lan_certificate.detected_lan_address())
            self.assertNotIn(None, lan_certificate.default_hosts())

    def test_a_failing_openssl_says_why(self):
        with mock.patch.object(lan_certificate.subprocess, 'run', side_effect=FileNotFoundError):
            with self.assertRaises(SystemExit) as refusal:
                lan_certificate.run_openssl('req')
        self.assertIn('openssl is not installed', str(refusal.exception))

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
        self.assertIn('attachment', response.getheader('Content-Disposition'))
        self.assertEqual(response.read(), public_authority_path.read_bytes())


if __name__ == '__main__':
    unittest.main()
