from __future__ import annotations

import http.server
import json
import os
import socketserver
from pathlib import Path


SITE_ROOT = Path(__file__).parent / "site"


def _public_config() -> dict[str, str]:
    return {
        "stage": os.environ.get("APP_STAGE", "local"),
        "awsRegion": os.environ.get("AWS_REGION", os.environ.get("APP_REGION", "us-east-2")),
        "apiBaseUrl": os.environ.get("BACKEND_API_URL", ""),
        "runtimeWsUrl": os.environ.get("RUNTIME_WS_URL", ""),
        "runtimeEndpoint": os.environ.get("RUNTIME_ENDPOINT", ""),
        "runtimeArn": os.environ.get("RUNTIME_ARN", ""),
        "workflowWsUrl": os.environ.get("WORKFLOW_WS_URL", ""),
        "cognitoIdpId": os.environ.get("COGNITO_IDENTITY_POOL_ID", ""),
        "cognitoBaseUrl": os.environ.get("COGNITO_BASE_URL", ""),
        "cognitoClientId": os.environ.get("COGNITO_CLIENT_ID", ""),
        "cognitoUserPoolId": os.environ.get("COGNITO_USER_POOL_ID", ""),
        "baseDomain": os.environ.get("BASE_DOMAIN", ""),
    }


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(SITE_ROOT), **kwargs)

    def do_GET(self) -> None:
        if self.path == "/health":
            self._json({"status": "ok", "stage": os.environ.get("APP_STAGE", "local")})
            return
        if self.path == "/runtime-config.js":
            body = "window.DEV_CONFIG = " + json.dumps(_public_config()) + ";\n"
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body.encode("utf-8"))
            return
        return super().do_GET()

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "strict-origin-when-cross-origin")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def _json(self, payload: dict[str, str]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    port = int(os.environ.get("PORT", "8080"))
    with socketserver.TCPServer(("", port), Handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
