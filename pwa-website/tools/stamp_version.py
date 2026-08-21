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


# Only index.html's entry point (js/app.js) carried a ?v= cache-buster, while every module it
# imports did not. The host serves js/ with max-age (its mod_expires overrides our .htaccess
# no-cache rule), so after a deploy the browser paired a fresh app.js with hours-stale modules --
# app.js would call into a module missing the exports it expected, init() would throw, and the
# boot fallback appeared. Reloading could not fix it because clearing the service worker and
# CacheStorage leaves the HTTP cache untouched. Stamping every import makes the URL itself change
# per build, so a stale module can never be paired with a new one regardless of host headers.
MODULE_IMPORT = re.compile(r"""(from\s+['"]\./[A-Za-z0-9._\-/]+\.js)(?:\?v=[^'"]*)?(['"])""")


def stamp_module_imports(build_version: str) -> int:
    stamped = 0
    for path in sorted((ROOT / "js").glob("*.js")):
        text = path.read_text(encoding="utf-8")
        updated = MODULE_IMPORT.sub(rf"\1?v={build_version}\2", text)
        if updated != text:
            path.write_text(updated, encoding="utf-8")
            stamped += 1
    return stamped


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

    stamped_modules = stamp_module_imports(build_version)

    print(f"Stamped app version {display_version} ({build_version}); {stamped_modules} module file(s) re-imported at this build")


if __name__ == "__main__":
    main()
