from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parent


def git_value(*args: str, fallback: str) -> str:
    try:
        return subprocess.check_output(["git", *args], cwd=REPO, text=True).strip()
    except Exception:
        return fallback


def replace(path: Path, pattern: str, value: str) -> None:
    text = path.read_text(encoding="utf-8")
    updated = re.sub(pattern, value, text)
    if updated != text:
        path.write_text(updated, encoding="utf-8")


def main() -> None:
    count = int(git_value("rev-list", "--count", "HEAD", fallback="13"))
    sha = git_value("rev-parse", "--short=10", "HEAD", fallback="local")
    display_version = os.environ.get("APP_DISPLAY_VERSION", f"1.{count:03d}")
    build_version = os.environ.get("APP_BUILD_VERSION", f"build-{sha}")

    replace(
        ROOT / "js" / "constants.js",
        r"export const APP_VERSION = '[^']+';",
        f"export const APP_VERSION = '{display_version}';",
    )
    replace(
        ROOT / "js" / "constants.js",
        r"export const BUILD_VERSION = '[^']+';",
        f"export const BUILD_VERSION = '{build_version}';",
    )
    replace(
        ROOT / "sw.js",
        r"const APP_VERSION = '[^']+';",
        f"const APP_VERSION = '{build_version}';",
    )
    replace(
        ROOT / "index.html",
        r"styles\.css\?v=[^\"']+",
        f"styles.css?v={build_version}",
    )
    replace(
        ROOT / "index.html",
        r"js/app\.js\?v=[^\"']+",
        f"js/app.js?v={build_version}",
    )
    replace(
        ROOT / "index.html",
        r"Version [0-9]+\.[0-9]+",
        f"Version {display_version}",
    )
    replace(
        ROOT / "styles.css",
        r"\?v=[^\"')]+",
        f"?v={build_version}",
    )

    print(f"Stamped app version {display_version} ({build_version})")


if __name__ == "__main__":
    main()
