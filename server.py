#!/usr/bin/env python3
"""
Serveur local pour l'interface d'annotation.
Sert les fichiers statiques ET sauvegarde les annotations dans resultats/
"""

import http.server
import json
import os

PORT = 8000
RESULTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "resultats")


class AnnotationHandler(http.server.SimpleHTTPRequestHandler):
    def do_POST(self):
        if self.path == "/save":
            length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(length)

            os.makedirs(RESULTS_DIR, exist_ok=True)
            filepath = os.path.join(RESULTS_DIR, "annotations.json")

            with open(filepath, "w", encoding="utf-8") as f:
                f.write(body.decode("utf-8"))

            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"ok": true}')
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Only log non-save requests to reduce noise
        if "/save" not in str(args):
            super().log_message(format, *args)


if __name__ == "__main__":
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    print()
    print("=" * 48)
    print("   EVALATIN 2026 – Interface d'annotation")
    print("=" * 48)
    print()
    print(f"  Ouvrez http://localhost:{PORT} dans votre navigateur")
    print(f"  Les annotations sont sauvegardées dans resultats/")
    print(f"  Pour arrêter : Ctrl+C")
    print()
    server = http.server.HTTPServer(("", PORT), AnnotationHandler)
    server.serve_forever()
