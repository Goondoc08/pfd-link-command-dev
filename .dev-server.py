#!/usr/bin/env python3
"""Local dev server for PFD Link.

Plain `python -m http.server` sends no cache-control headers, so the
browser's disk cache silently holds an old links.js/command.js/index.html
across reloads -- indistinguishable from a real bug while iterating. This
sends no-store on every response so edits always show up on reload.

Not part of the deployed site. Serves the directory this file lives in
regardless of the caller's cwd, so it works from a launch.json entry:
    python .dev-server.py [port]
"""
import functools
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8128
# Second arg is the bind address. Left unset, http.server picks the first
# address getaddrinfo returns, which on Windows is the IPv6 wildcard --
# so the server ends up on [::] only and a phone hitting the machine's
# IPv4 LAN address just times out. Pass 0.0.0.0 to test on real devices:
#     python .dev-server.py 8130 0.0.0.0
BIND = sys.argv[2] if len(sys.argv) > 2 else None
ROOT = os.path.dirname(os.path.abspath(__file__))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    Handler = functools.partial(NoCacheHandler, directory=ROOT)
    http.server.test(HandlerClass=Handler, port=PORT, bind=BIND)
