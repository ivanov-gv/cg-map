"""Issues a trusted HTTPS certificate for this machine on the local network, from a private certificate authority.

Chrome allows service workers and app install only on a secure origin, and refuses them over a certificate it does not
trust even after a click-through. Trusting this authority once on a device therefore covers every service on the LAN.

The authority lives outside the repository so that it outlasts any checkout and can serve other projects. Its name
constraints limit it to private addresses and local names, so a leaked key cannot impersonate a public website.
"""
import argparse
import hashlib
import ipaddress
import os
from pathlib import Path
import shutil
import socket
import ssl
import subprocess
import tempfile

AUTHORITY_DAYS = 3650
# Chrome rejects leaf certificates valid for longer than this. Each start issues a new one.
SERVER_CERTIFICATE_DAYS = 397
AUTHORITY_NAME = 'LAN private certificate authority'
PERMITTED_NETWORKS = [
    '10.0.0.0/255.0.0.0',
    '172.16.0.0/255.240.0.0',
    '192.168.0.0/255.255.0.0',
    '127.0.0.0/255.0.0.0',
]
PERMITTED_DOMAINS = ['localhost', 'local', 'lan', 'home.arpa', 'internal']
# Any routable address works: connecting a UDP socket only selects the outgoing interface and sends nothing.
ROUTE_PROBE_ADDRESS = ('192.0.2.1', 9)


def default_authority_directory():
    configured = os.environ.get('LAN_CA_DIR')
    return Path(configured) if configured else Path.home() / '.config' / 'lan-ca'


def run_openssl(*arguments):
    subprocess.run(['openssl', *arguments], check=True, capture_output=True, text=True)


def authority_constraints():
    networks = [f'permitted;IP:{network}' for network in PERMITTED_NETWORKS]
    domains = [f'permitted;DNS:{domain}' for domain in PERMITTED_DOMAINS]
    return 'nameConstraints=critical,' + ','.join(networks + domains)


def ensure_authority(authority_directory):
    """Creates the authority once. Replacing it would make every device distrust this network's services."""
    key_path = authority_directory / 'ca.key'
    certificate_path = authority_directory / 'ca.crt'
    if key_path.exists() and certificate_path.exists():
        return key_path, certificate_path
    authority_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    run_openssl(
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', str(key_path), '-out', str(certificate_path),
        '-days', str(AUTHORITY_DAYS), '-subj', f'/CN={AUTHORITY_NAME}',
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-addext', authority_constraints(),
    )
    key_path.chmod(0o600)
    return key_path, certificate_path


def detected_lan_address():
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
        probe.connect(ROUTE_PROBE_ADDRESS)
        return probe.getsockname()[0]


def default_hosts():
    return [detected_lan_address(), f'{socket.gethostname()}.local', 'localhost', '127.0.0.1']


def subject_alternative_name(host):
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return f'DNS:{host}'
    return f'IP:{host}'


def issue_server_certificate(authority_directory, output_directory, hosts):
    """Writes server.key, server.crt and a public copy of ca.crt. Returns the path of that copy."""
    authority_key, authority_certificate = ensure_authority(authority_directory)
    output_directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    key_path = output_directory / 'server.key'
    certificate_path = output_directory / 'server.crt'
    names = ','.join(subject_alternative_name(host) for host in hosts)
    extensions = '\n'.join([
        f'subjectAltName={names}',
        'basicConstraints=critical,CA:FALSE',
        'keyUsage=critical,digitalSignature',
        'extendedKeyUsage=serverAuth',
        '',
    ])
    with tempfile.TemporaryDirectory() as working_directory:
        request_path = Path(working_directory) / 'server.csr'
        extensions_path = Path(working_directory) / 'server.ext'
        extensions_path.write_text(extensions)
        run_openssl(
            'req', '-new', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
            '-keyout', str(key_path), '-out', str(request_path), '-subj', f'/CN={hosts[0]}',
        )
        run_openssl(
            'x509', '-req', '-in', str(request_path), '-CA', str(authority_certificate), '-CAkey', str(authority_key),
            '-set_serial', str(int.from_bytes(os.urandom(16), 'big')), '-days', str(SERVER_CERTIFICATE_DAYS),
            '-extfile', str(extensions_path), '-out', str(certificate_path),
        )
    key_path.chmod(0o600)
    public_authority_path = output_directory / 'ca.crt'
    shutil.copyfile(authority_certificate, public_authority_path)
    return public_authority_path


def certificate_fingerprint(certificate_path):
    der_bytes = ssl.PEM_cert_to_DER_cert(certificate_path.read_text())
    digest = hashlib.sha256(der_bytes).hexdigest().upper()
    return ':'.join(digest[index:index + 2] for index in range(0, len(digest), 2))


def print_instructions(hosts, port, authority_directory, public_authority_path):
    print(f'Certificate authority: {authority_directory / "ca.crt"} (private key beside it: never share it)')
    print(f'SHA-256 fingerprint:   {certificate_fingerprint(public_authority_path)}')
    print('Open one of these, trust the authority once on each device, then use Install in Chrome:')
    for host in hosts:
        print(f'  https://{host}:{port}/')
    print('To get the authority onto a phone, open /lan-ca.crt on the URL above, accept the warning that one time, and')
    print('compare the fingerprint with this one in the device settings before trusting it.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--authority-directory', type=Path, default=default_authority_directory())
    parser.add_argument('--host', action='append', help='a name or address to include; defaults to this machine')
    parser.add_argument('--port', type=int, default=8443, help='shown in the printed URLs')
    options = parser.parse_args()
    hosts = options.host or default_hosts()
    public_authority_path = issue_server_certificate(options.authority_directory, options.output_directory, hosts)
    print_instructions(hosts, options.port, options.authority_directory, public_authority_path)


if __name__ == '__main__':
    main()
