"""Minimal HTTP server with Range request support for local PMTiles testing."""

import http.server
import os
import re
import sys


class RangeHandler(http.server.SimpleHTTPRequestHandler):
    def send_head(self):
        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, 'rb')
        except OSError:
            return super().send_head()

        ctype = self.guess_type(path)
        size = os.fstat(f.fileno()).st_size
        range_header = self.headers.get('Range', '')
        m = re.match(r'bytes=(\d+)-(\d*)', range_header)

        if m:
            start = int(m.group(1))
            end = int(m.group(2)) if m.group(2) else size - 1
            end = min(end, size - 1)
            length = end - start + 1
            self.send_response(206)
            self.send_header('Content-Type', ctype)
            self.send_header('Content-Range', f'bytes {start}-{end}/{size}')
            self.send_header('Content-Length', str(length))
            self.send_header('Accept-Ranges', 'bytes')
            self.end_headers()
            f.seek(start)
            return f

        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(size))
        self.send_header('Accept-Ranges', 'bytes')
        self.end_headers()
        return f

    def log_message(self, fmt, *args):
        print(f'  {args[0]}  {args[1]}  {self.path[:80]}', flush=True)

    def copyfile(self, source, outputfile):
        # Browsers routinely abort range requests mid-flight (seeking, zooming
        # away from tiles). That is normal, not a server fault - don't traceback.
        try:
            super().copyfile(source, outputfile)
        except (ConnectionResetError, ConnectionAbortedError, BrokenPipeError):
            pass


if __name__ == '__main__':
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
    root = sys.argv[2] if len(sys.argv) > 2 else '.'
    os.chdir(root)
    # Threaded: the multi-MB spf-data.json would otherwise block every tile
    # request behind it on a single-threaded server.
    with http.server.ThreadingHTTPServer(('', port), RangeHandler) as httpd:
        print(f'Serving http://localhost:{port}/ from {os.path.abspath(root)}')
        httpd.serve_forever()
