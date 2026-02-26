from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen


PVGIS_BASE = "https://re.jrc.ec.europa.eu/api/v5_3/seriescalc"
PVWATTS_BASE = "https://developer.nrel.gov/api/pvwatts/v8.json"


class CORSRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed = urlparse(self.path)

        if parsed.path == "/api/pvgis":
            self._proxy_json(PVGIS_BASE, parsed.query)
            return

        if parsed.path == "/api/pvwatts":
            self._proxy_json(PVWATTS_BASE, parsed.query)
            return

        super().do_GET()

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _proxy_json(self, base_url, query):
        target_url = f"{base_url}?{query}" if query else base_url
        request = Request(
            target_url,
            headers={
                "User-Agent": "SolarCurveProxy/1.0",
                "Accept": "application/json",
            },
        )

        try:
            with urlopen(request, timeout=30) as response:
                payload = response.read()
                status_code = response.getcode() or 200
                content_type = response.headers.get("Content-Type", "application/json")

            self.send_response(status_code)
            self.send_header("Content-Type", content_type)
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(payload)
        except HTTPError as error:
            body = error.read() if hasattr(error, "read") else b""
            self.send_response(error.code)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body or b'{"error":"Upstream HTTP error"}')
        except (URLError, TimeoutError):
            self.send_response(502)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"error":"Upstream unavailable"}')


if __name__ == "__main__":
    host = "127.0.0.1"
    port = 8000

    server = ThreadingHTTPServer((host, port), CORSRequestHandler)
    print(f"SolarCurve server running on http://{host}:{port}")
    print("Press Ctrl+C to stop")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
