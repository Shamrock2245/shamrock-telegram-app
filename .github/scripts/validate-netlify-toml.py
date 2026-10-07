#!/usr/bin/env python3
"""Parse netlify.toml with the stdlib TOML parser. Skip when the file is absent."""

import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
path = ROOT / "netlify.toml"

if not path.exists():
    print("netlify.toml not present; skipping")
    sys.exit(0)

with path.open("rb") as handle:
    data = tomllib.load(handle)

if "build" not in data:
    print("netlify.toml parsed but is missing [build]", file=sys.stderr)
    sys.exit(1)

build = data["build"]
print(
    "netlify.toml ok:",
    f"publish={build.get('publish')!r}",
    f"command={build.get('command')!r}",
    f"redirects={len(data.get('redirects', []))}",
    f"edge_functions={len(data.get('edge_functions', []))}",
)
