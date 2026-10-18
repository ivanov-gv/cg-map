import sys,unittest,io,json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'platform/tools'))
from serve import parse_range,Handler
class Ranges(unittest.TestCase):
    def test_ranges(self):
        for value,want in [('bytes=0-99',(0,99)),('bytes=900-',(900,999)),('bytes=-30',(970,999)),('bytes=950-2000',(950,999))]:
            self.assertEqual(parse_range(value,1000),want)
    def test_invalid(self):
        for value in ['bytes=1000-','bytes=2-1','bytes=-0','bytes=-','bytes=1-2,3-4','x=0-10']:
            with self.assertRaises(ValueError):parse_range(value,1000)
class FakeSocket:
    def __init__(self,request):self.request=io.BytesIO(request);self.output=bytearray()
    def makefile(self,mode,*args):return self.request
    def sendall(self,data):self.output.extend(data)
class QuietHandler(Handler):
    def log_message(self,*args):pass
class HTTPBytes(unittest.TestCase):
    def response(self,path,extra='',method='GET'):
        root=Path(__file__).resolve().parents[2]/'dist/web'
        sock=FakeSocket(f'{method} {path} HTTP/1.0\r\n{extra}\r\n'.encode())
        QuietHandler(sock,('127.0.0.1',1),None,directory=str(root))
        return bytes(sock.output).split(b'\r\n\r\n',1)
    def test_real_archive_range(self):
        root=Path(__file__).resolve().parents[2]/'dist/web'
        manifest=json.loads((root/'data/manifest.json').read_text())
        head,body=self.response('/'+manifest['archive']['path'],'Range: bytes=0-126\r\n')
        self.assertIn(b'206 Partial Content',head);self.assertIn(b'Content-Length: 127',head)
        self.assertIn(b'Accept-Ranges: bytes',head);self.assertEqual(len(body),127);self.assertTrue(body.startswith(b'PMTiles'))
    def test_unsatisfiable_range(self):
        head,body=self.response('/app.js','Range: bytes=99999999-\r\n')
        self.assertIn(b'416',head);self.assertEqual(body,b'')
    def test_script_head_and_encoded_font(self):
        head,body=self.response('/app.js',method='HEAD')
        self.assertIn(b'Content-Type: text/javascript',head);self.assertEqual(body,b'')
        head,body=self.response('/fonts/Open%20Sans%20Semibold/0-255.pbf')
        self.assertIn(b'200 OK',head);self.assertTrue(len(body)>1000)
if __name__=='__main__':unittest.main()
