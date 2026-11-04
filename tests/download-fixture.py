"""Local HTTP fixture for downloader tests; never used by the installer."""
import argparse
import http.server
import json
import pathlib
import re
import threading


parser = argparse.ArgumentParser()
parser.add_argument("--root", required=True)
args = parser.parse_args()
root = pathlib.Path(args.root)
data = bytes(range(256)) * 256
(root / "payload.bin").write_bytes(data)
log_lock = threading.Lock()


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/redirect":
            body = b"<html>redirect</html>" * 100
            self.send_response(302)
            self.send_header("Location", "/range")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass
            return
        requested = self.headers.get("Range", "")
        match = re.fullmatch(r"bytes=(\d+)-(\d+)", requested)
        start, end = (int(match[1]), int(match[2])) if match else (0, len(data) - 1)
        with log_lock:
            with (root / "requests.jsonl").open("a", encoding="utf-8") as log:
                log.write(json.dumps({"path": self.path, "start": start, "end": end, "range": bool(match)}) + "\n")
        if self.path == "/resume" and start >= 8192 and not (root / "allow-resume").exists():
            self.send_response(503)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        if self.path == "/norange" or not match:
            body = data
            self.send_response(200)
        else:
            body = data[start:end + 1]
            self.send_response(206)
            advertised_start = start + 1 if self.path == "/wrong-range" else start
            self.send_header("Content-Range", f"bytes {advertised_start}-{end}/{len(data)}")
        if self.path == "/bad-data":
            body = bytes(value ^ 255 for value in body)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass


server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
(root / "port.txt").write_text(str(server.server_port), encoding="ascii")
server.serve_forever()
