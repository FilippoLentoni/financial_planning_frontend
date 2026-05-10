from __future__ import annotations

import argparse
import sys
import time
from urllib.request import urlopen


def wait_for_health(url: str, timeout_seconds: int) -> None:
    deadline = time.time() + timeout_seconds
    health_url = url.rstrip("/") + "/health"
    last_error: Exception | None = None
    while time.time() < deadline:
        try:
            with urlopen(health_url, timeout=10) as response:
                body = response.read().decode("utf-8", errors="replace")
                if response.status == 200 and "ok" in body.lower():
                    print(f"OK {health_url}")
                    return
        except Exception as exc:
            last_error = exc
        time.sleep(10)
    raise SystemExit(f"Health check failed for {health_url}: {last_error}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-test a deployed Financial Planning Frontend app.")
    parser.add_argument("--url", required=True)
    parser.add_argument("--timeout-seconds", type=int, default=600)
    args = parser.parse_args()
    wait_for_health(args.url, args.timeout_seconds)


if __name__ == "__main__":
    main()
