"""Serve generated root assets at / and /cg-map/ for deployment-path tests."""
import argparse
from functools import partial
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from server import Handler


class PagesHandler(Handler):
    def translate_path(self, path):
        if path.startswith('/cg-map/'):
            path = '/' + path[len('/cg-map/'):]
        return super().translate_path(path)

    def log_message(self, *_args):
        pass


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    args = parser.parse_args()
    ThreadingHTTPServer(('127.0.0.1', args.port), partial(PagesHandler, directory=str(ROOT))).serve_forever()
