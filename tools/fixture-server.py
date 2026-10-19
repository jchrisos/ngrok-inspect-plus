#!/usr/bin/env python3
"""ngrok-inspect-plus fixture server — controlled response bodies for edge-case testing.

Serves a THROWAWAY temp directory on 127.0.0.1:8080, so no fixture data lands in the
repo. It replaces `python3 -m http.server 8080` on the same port, so the ngrok tunnel
(and therefore the dashboard) is unaffected.

Run it instead of `make serve`, then `make traffic`:

    make fixtures      # this server, on :8080
    make tunnel        # ngrok in another terminal
    make traffic       # send every branch through the tunnel

Routes that exercise a specific ngrok-inspect-plus code path:
    /data.json   application/json               text + pretty branches
    /page.html   text/html                      text path, hljs-rendered Summary
    /latin1      text/plain; charset=iso-8859-1 non-UTF-8 but NOT binary (decode branch)
    /empty       204                            EMPTY   -> button must disable
    /truncated   200 with a lying Content-Length TRUNCATED -> warning toast
    /blob.bin    application/octet-stream       binary  -> hex fallback / base64
    /large.txt   64 KiB                         full body
    /huge.txt    100 KiB                        NOT-CAPTURED (headers-only degrade)
"""
import argparse
import http.server
import os
import sys
import tempfile


def build_fixtures(root):
    def write(name, data):
        with open(os.path.join(root, name), 'wb') as fh:
            fh.write(data)

    write('data.json', b'{"a":1,"b":[true,null,"x"],"c":{"d":2}}')
    write('page.html', b'<!doctype html><html><body><h1>hi</h1></body></html>')
    write('latin1.bin', 'café naïve'.encode('latin-1'))
    write('blob.bin', bytes(range(256)) * 16)
    write('large.txt', b'L' * 65536)
    write('huge.txt', b'L' * 102400)


def make_handler(root):
    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=root, **kwargs)

        def _send(self, code, ctype, body, declared_len=None):
            self.send_response(code)
            if ctype:
                self.send_header('Content-Type', ctype)
            self.send_header('Content-Length', str(declared_len if declared_len is not None else len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            path = self.path.split('?', 1)[0]
            if path == '/empty':
                self.send_response(204)
                self.end_headers()
                return
            if path == '/latin1':
                self._send(200, 'text/plain; charset=iso-8859-1', 'café naïve'.encode('latin-1'))
                return
            if path == '/truncated':
                self._send(200, 'text/plain', b'0123456789', declared_len=9999)
                return
            return super().do_GET()

        def do_POST(self):
            # Drain the request body, then answer with a controlled JSON response.
            length = int(self.headers.get('Content-Length', 0) or 0)
            if length:
                self.rfile.read(length)
            body = b'{"ok":true,"received":' + str(length).encode() + b'}'
            self._send(200, 'application/json; charset=utf-8', body)

        def log_message(self, *args):  # keep the terminal quiet
            pass

    Handler.extensions_map['.bin'] = 'application/octet-stream'
    Handler.extensions_map['.json'] = 'application/json'
    return Handler


def main():
    ap = argparse.ArgumentParser(description='ngrok-inspect-plus fixture server')
    ap.add_argument('--port', type=int, default=8080)
    ap.add_argument('--host', default='127.0.0.1')
    args = ap.parse_args()

    root = tempfile.mkdtemp(prefix='ngpp-fixtures-')
    build_fixtures(root)

    httpd = http.server.ThreadingHTTPServer((args.host, args.port), make_handler(root))
    print(f'ngrok-inspect-plus fixtures on http://{args.host}:{args.port}  (temp dir {root})')
    print('routes: /data.json /page.html /latin1 /empty /truncated /blob.bin /large.txt /huge.txt')
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()


if __name__ == '__main__':
    sys.exit(main())
