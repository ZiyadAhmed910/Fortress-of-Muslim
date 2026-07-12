from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer


class PwaHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "application/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".webmanifest": "application/manifest+json; charset=utf-8",
        ".png": "image/png",
        ".webp": "image/webp",
    }


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8080), PwaHandler)
    print("Serving Fortress of Muslim PWA at http://127.0.0.1:8080")
    server.serve_forever()
