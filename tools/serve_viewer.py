"""Serve the local REFUGIO replay viewer.

Run this from the starter-kit root after tools/make_replay.
"""

from __future__ import annotations

import argparse
import contextlib
import os
import socket
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPLAY_PATH = "/runtime/replays/replay.json"


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the REFUGIO local replay viewer.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--no-open", action="store_true", help="Print the URL without opening a browser.")
    parser.add_argument("--replay", default=DEFAULT_REPLAY_PATH, help="Replay URL path served by this tool.")
    args = parser.parse_args()

    os.chdir(ROOT)
    port = first_free_port(args.host, args.port)
    handler = partial(QuietHandler, directory=str(ROOT))
    server = ThreadingHTTPServer((args.host, port), handler)
    url = f"http://{args.host}:{port}/viewer/index.html?replay={args.replay}"
    print(f"Serving {ROOT}")
    print(f"Open {url}")
    print("Press Ctrl+C to stop.")
    if not args.no_open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopped.")
    finally:
        server.server_close()


def first_free_port(host: str, preferred: int) -> int:
    for port in range(preferred, preferred + 50):
        with contextlib.closing(socket.socket(socket.AF_INET, socket.SOCK_STREAM)) as probe:
            if probe.connect_ex((host, port)) != 0:
                return port
    raise RuntimeError(f"no free port found from {preferred} to {preferred + 49}")


if __name__ == "__main__":
    main()
