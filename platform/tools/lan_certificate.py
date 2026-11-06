"""Issues a trusted HTTPS certificate for this machine on the local network, from a private certificate authority.

Chrome allows service workers and app install only on a secure origin, and refuses them over a certificate it does not
trust even after a click-through. Trusting this authority once on a device therefore covers every service on the LAN.

The authority lives outside the repository so that it outlasts any checkout and can serve other projects. Its name
constraints limit it to private addresses and local names, which clients that enforce them apply even to a leaked key.
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
# Well under the limits browsers apply, and each start of a server issues a new certificate anyway.
SERVER_CERTIFICATE_DAYS = 397
AUTHORITY_NAME = 'LAN private certificate authority'
# A constant with a space, because OpenSSL clients check a name-like common name against the DNS constraints, which
# would refuse a certificate for an IP address alone.
SERVER_COMMON_NAME = 'LAN server'
# These are fixed for the authority's whole life: changing them means trusting a new authority on every device.
# Every network here is reserved for private use, and every domain is unavailable on the public internet.
PERMITTED_NETWORKS = [
    ('10.0.0.0', '255.0.0.0'),
    ('100.64.0.0', '255.192.0.0'),
    ('127.0.0.0', '255.0.0.0'),
    ('172.16.0.0', '255.240.0.0'),
    ('192.168.0.0', '255.255.0.0'),
    ('::1', 'ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff'),
    ('fc00::', 'fe00::'),
]
PERMITTED_DOMAINS = ['localhost', 'local', 'lan', 'home', 'home.arpa', 'internal', 'localdomain']
# Any routable address works: connecting a UDP socket only selects the outgoing interface and sends nothing.
ROUTE_PROBE_ADDRESS = ('192.0.2.1', 9)
PRIVATE_FILES_UMASK = 0o077


def default_authority_directory():
    configured = os.environ.get('LAN_CA_DIR')
    return Path(configured) if configured else Path.home() / '.config' / 'lan-ca'


def run_openssl(*arguments):
    """Runs under a private umask, so a key file is never readable by others, even for a moment."""
    previous_umask = os.umask(PRIVATE_FILES_UMASK)
    try:
        subprocess.run(['openssl', *arguments], check=True, capture_output=True, text=True)
    except FileNotFoundError:
        raise SystemExit('openssl is not installed, and it is needed to issue certificates.') from None
    except subprocess.CalledProcessError as error:
        raise SystemExit(f'openssl {arguments[0]} failed: {error.stderr.strip()}') from error
    finally:
        os.umask(previous_umask)


def make_private_directory(directory):
    directory.mkdir(parents=True, exist_ok=True)
    directory.chmod(0o700)


def authority_constraints():
    networks = [f'permitted;IP:{address}/{mask}' for address, mask in PERMITTED_NETWORKS]
    domains = [f'permitted;DNS:{domain}' for domain in PERMITTED_DOMAINS]
    return 'nameConstraints=critical,' + ','.join(networks + domains)


def is_permitted_address(address):
    for network, mask in PERMITTED_NETWORKS:
        network_address = ipaddress.ip_address(network)
        mask_bits = int(ipaddress.ip_address(mask))
        is_same_family = address.version == network_address.version
        if is_same_family and int(address) & mask_bits == int(network_address) & mask_bits:
            return True
    return False


def is_permitted_host(host):
    try:
        return is_permitted_address(ipaddress.ip_address(host))
    except ValueError:
        return any(host == domain or host.endswith(f'.{domain}') for domain in PERMITTED_DOMAINS)


def require_existing_authority(key_path, certificate_path):
    if not (key_path.exists() and certificate_path.exists()):
        raise SystemExit(
            f'Only one of {key_path} and {certificate_path} exists. Restore the missing file: creating a new '
            'authority would overwrite the other and make every device distrust your LAN services.'
        )
    if key_path.stat().st_mode & 0o077:
        raise SystemExit(f'{key_path} is readable by other users. Fix it with: chmod 600 {key_path}')


def ensure_authority(authority_directory):
    """Creates the authority once, and never replaces any part of it."""
    key_path = authority_directory / 'ca.key'
    certificate_path = authority_directory / 'ca.crt'
    if key_path.exists() or certificate_path.exists():
        require_existing_authority(key_path, certificate_path)
        return key_path, certificate_path
    make_private_directory(authority_directory)
    run_openssl(
        'req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes',
        '-keyout', str(key_path), '-out', str(certificate_path),
        '-days', str(AUTHORITY_DAYS), '-subj', f'/CN={AUTHORITY_NAME}',
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0',
        '-addext', 'keyUsage=critical,keyCertSign,cRLSign',
        '-addext', authority_constraints(),
    )
    return key_path, certificate_path


def detected_lan_address():
    """Returns this machine's address on the default route, or None when it has none or uses one the authority cannot cover."""
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as probe:
            probe.connect(ROUTE_PROBE_ADDRESS)
            address = probe.getsockname()[0]
    except OSError:
        print('No network route found, so this certificate covers only this machine. Use --host to add addresses.')
        return None
    if is_permitted_address(ipaddress.ip_address(address)):
        return address
    print(f'Leaving out {address}: it is not a private address, perhaps because of a VPN. Use --host to set the right one.')
    return None


def default_hosts():
    candidates = [detected_lan_address(), f'{socket.gethostname()}.local', 'localhost', '127.0.0.1']
    return [host for host in candidates if host]


def subject_alternative_name(host):
    try:
        ipaddress.ip_address(host)
    except ValueError:
        return f'DNS:{host}'
    return f'IP:{host}'


def write_server_certificate(authority_directory, output_directory, hosts):
    """Signs for these hosts without checking them. Returns the path of a public copy of the authority's certificate."""
    authority_key, authority_certificate = ensure_authority(authority_directory)
    make_private_directory(output_directory)
    key_path = output_directory / 'server.key'
    certificate_path = output_directory / 'server.crt'
    # An existing file would keep its old permissions when rewritten.
    key_path.unlink(missing_ok=True)
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
            '-keyout', str(key_path), '-out', str(request_path), '-subj', f'/CN={SERVER_COMMON_NAME}',
        )
        run_openssl(
            'x509', '-req', '-in', str(request_path), '-CA', str(authority_certificate), '-CAkey', str(authority_key),
            '-set_serial', str(int.from_bytes(os.urandom(16), 'big')), '-days', str(SERVER_CERTIFICATE_DAYS),
            '-extfile', str(extensions_path), '-out', str(certificate_path),
        )
    public_authority_path = output_directory / 'ca.crt'
    shutil.copyfile(authority_certificate, public_authority_path)
    return public_authority_path


def require_verified_certificate(public_authority_path, output_directory, hosts):
    """An authority created with an older permitted list signs anything, and clients then refuse the result. Say so here."""
    certificate_path = output_directory / 'server.crt'
    verification = subprocess.run(
        ['openssl', 'verify', '-x509_strict', '-CAfile', str(public_authority_path), str(certificate_path)],
        capture_output=True, text=True,
    )
    if verification.returncode != 0:
        certificate_path.unlink()
        raise SystemExit(
            f'The authority cannot vouch for {", ".join(hosts)}, so clients would refuse this certificate. '
            f'It may predate the permitted list. OpenSSL says: {verification.stdout}{verification.stderr}'.strip()
        )


def issue_server_certificate(authority_directory, output_directory, hosts):
    """Refuses a host the authority cannot vouch for: one such name makes clients reject the whole certificate."""
    refused_hosts = [host for host in hosts if not is_permitted_host(host)]
    if refused_hosts:
        permitted = ', '.join(PERMITTED_DOMAINS)
        raise SystemExit(f'Not a private address or local name: {", ".join(refused_hosts)}. Local names are: {permitted}.')
    public_authority_path = write_server_certificate(authority_directory, output_directory, hosts)
    require_verified_certificate(public_authority_path, output_directory, hosts)
    return public_authority_path


def certificate_fingerprint(certificate_path):
    der_bytes = ssl.PEM_cert_to_DER_cert(certificate_path.read_text())
    digest = hashlib.sha256(der_bytes).hexdigest().upper()
    return ':'.join(digest[index:index + 2] for index in range(0, len(digest), 2))


def print_summary(hosts, authority_directory, public_authority_path, output_directory):
    print(f'Certificate authority: {authority_directory / "ca.crt"} (private key beside it: never share it)')
    print(f'SHA-256 fingerprint:   {certificate_fingerprint(public_authority_path)}')
    print(f'Server certificate:    {output_directory / "server.crt"} and server.key, for {", ".join(hosts)}')


def print_install_steps(hosts, port):
    device_hosts = [host for host in hosts if host not in ('localhost', '127.0.0.1')]
    print('Trust the authority once on each device, then open this and use Install in Chrome:')
    for host in device_hosts:
        print(f'  https://{host}:{port}/')
    print('To get the authority onto a phone, open /lan-ca.crt on that URL and accept the warning that one time.')
    print('The fingerprint above identifies it: compare it in the device settings, under trusted credentials.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-directory', type=Path, required=True)
    parser.add_argument('--authority-directory', type=Path, default=default_authority_directory())
    parser.add_argument('--host', action='append', help='a name or address to include; defaults to this machine')
    parser.add_argument('--install-port', type=int, help='also print how to install an app served on this port')
    options = parser.parse_args()
    hosts = options.host or default_hosts()
    public_authority_path = issue_server_certificate(options.authority_directory, options.output_directory, hosts)
    print_summary(hosts, options.authority_directory, public_authority_path, options.output_directory)
    if options.install_port:
        print_install_steps(hosts, options.install_port)


if __name__ == '__main__':
    main()
