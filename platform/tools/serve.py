"""Self-hostable standard-library server with PMTiles HTTP range support."""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from functools import partial
import argparse,os,re,ssl,sys

def parse_range(value,size):
    match=re.fullmatch(r'bytes=(\d*)-(\d*)',value or '')
    if not match or not any(match.groups()):raise ValueError('Invalid range')
    first,last=match.groups()
    if first:start=int(first);end=min(int(last),size-1) if last else size-1
    else:
        suffix=int(last)
        if suffix<=0:raise ValueError('Invalid suffix')
        start=max(0,size-suffix);end=size-1
    if start<0 or start>=size or end<start:raise ValueError('Unsatisfiable range')
    return start,end

class Handler(SimpleHTTPRequestHandler):
    extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.js':'text/javascript','.mjs':'text/javascript','.pmtiles':'application/vnd.pmtiles','.pbf':'application/x-protobuf','.webmanifest':'application/manifest+json','.geojson':'application/geo+json'}
    def send_head(self):
        self.byte_range=None
        path=Path(self.translate_path(self.path))
        if not path.is_file():return super().send_head()
        size=path.stat().st_size
        if self.headers.get('Range'):
            try:start,end=parse_range(self.headers['Range'],size)
            except ValueError:
                self.send_response(416);self.send_header('Content-Range',f'bytes */{size}');self.send_header('Content-Length','0');self.end_headers();return None
            stream=path.open('rb');stream.seek(start);self.byte_range=(start,end)
            self.send_response(206);self.send_header('Content-Range',f'bytes {start}-{end}/{size}');self.send_header('Content-Length',str(end-start+1))
        else:
            stream=path.open('rb');self.send_response(200);self.send_header('Content-Length',str(size))
        self.send_header('Content-Type',self.guess_type(str(path)));self.send_header('Accept-Ranges','bytes')
        self.send_header('Cache-Control','public, max-age=31536000, immutable' if re.fullmatch(r'montenegro-[a-f0-9]+\.pmtiles',path.name) else 'no-cache')
        self.send_header('X-Content-Type-Options','nosniff');self.send_header('Last-Modified',self.date_time_string(path.stat().st_mtime));self.end_headers();return stream
    def copyfile(self,source,outputfile):
        if not self.byte_range:return super().copyfile(source,outputfile)
        remaining=self.byte_range[1]-self.byte_range[0]+1
        while remaining:
            chunk=source.read(min(65536,remaining))
            if not chunk:break
            outputfile.write(chunk);remaining-=len(chunk)

class PrefixedHandler(Handler):
    """Also serves the artifact under one URL prefix, as a project page host does. Browser tests use it, so it is quiet."""

    def __init__(self, *args, path_prefix, **kwargs):
        # The base constructor handles the request, so the prefix must be set first.
        self.path_prefix = path_prefix
        super().__init__(*args, **kwargs)

    def translate_path(self, path):
        if path.startswith(self.path_prefix):
            path = '/' + path[len(self.path_prefix):]
        return super().translate_path(path)

    def log_message(self, *_args):
        pass


class TlsHandler(Handler):
    """Also offers the public certificate of the authority, so a phone can fetch it from the server it will trust."""

    AUTHORITY_PATH = '/lan-ca.crt'
    extensions_map = {**Handler.extensions_map, '.crt': 'application/x-x509-ca-cert'}

    def __init__(self, *args, authority_certificate, **kwargs):
        # The base constructor handles the request, so this must be set first.
        self.authority_certificate = authority_certificate
        super().__init__(*args, **kwargs)

    def translate_path(self, path):
        if path.split('?')[0] == self.AUTHORITY_PATH:
            return str(self.authority_certificate)
        return super().translate_path(path)

    def end_headers(self):
        # As a plain download, a phone keeps the file for its settings instead of opening a system installer that refuses it.
        if self.path.split('?')[0] == self.AUTHORITY_PATH:
            self.send_header('Content-Disposition', 'attachment; filename="lan-ca.crt"')
        super().end_headers()


class QuietTlsServer(ThreadingHTTPServer):
    def handle_error(self, request, client_address):
        # A browser that does not trust the authority yet closes the connection. That is expected, not a server fault.
        if not isinstance(sys.exc_info()[1], (ssl.SSLError, ConnectionError)):
            super().handle_error(request, client_address)


def create_tls_server(address, handler, certificate_path, key_path):
    server = QuietTlsServer(address, handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate_path, key_path)
    # The handshake runs in each request's own thread, so one stalled client cannot block the accept loop.
    server.socket = context.wrap_socket(server.socket, server_side=True, do_handshake_on_connect=False)
    return server


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8080)
    parser.add_argument('--app', choices=['web', 'core-demo', 'editor'], default='web')
    parser.add_argument('--path-prefix', help='also serve the artifact under this prefix, such as /cg-map/')
    parser.add_argument('--tls-directory', type=Path, help='serve HTTPS with the files from lan_certificate.py')
    options = parser.parse_args()
    if options.tls_directory and options.path_prefix:
        parser.error('--tls-directory does not support --path-prefix')
    artifact_directory = Path(__file__).resolve().parents[2] / 'dist' / options.app
    scheme = 'https' if options.tls_directory else 'http'
    print(f'Serving dist/{options.app}: {scheme}://{options.host}:{options.port}/', flush=True)
    handler = partial(Handler, directory=str(artifact_directory))
    if options.path_prefix:
        handler = partial(PrefixedHandler, directory=str(artifact_directory), path_prefix=options.path_prefix)
    if options.tls_directory:
        tls = options.tls_directory
        handler = partial(TlsHandler, directory=str(artifact_directory), authority_certificate=tls / 'ca.crt')
        server = create_tls_server((options.host, options.port), handler, tls / 'server.crt', tls / 'server.key')
    else:
        server = ThreadingHTTPServer((options.host, options.port), handler)
    server.serve_forever()
