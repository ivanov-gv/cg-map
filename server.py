"""Self-hostable standard-library server with PMTiles HTTP range support."""
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from pathlib import Path
from functools import partial
import argparse,os,re

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

if __name__=='__main__':
    args=argparse.ArgumentParser();args.add_argument('--host',default='127.0.0.1');args.add_argument('--port',type=int,default=8080);opts=args.parse_args()
    root=Path(__file__).resolve().parent/'web'
    print(f'Kompas: http://{opts.host}:{opts.port}/',flush=True)
    ThreadingHTTPServer((opts.host,opts.port),partial(Handler,directory=str(root))).serve_forever()
