#!/usr/bin/env python3
"""A143: manage the Sorted-branded Finexer consent-page templates.

Templates API (from Finexer's reference, via Kevin's screenshots), Basic auth
with the API key as username, form-encoded fields:
    POST   /apps/{app_id}/templates          create
    GET    /apps/{app_id}/templates          list
    GET    /apps/{app_id}/templates/{id}     show
    POST   /apps/{app_id}/templates/{id}     update (empty value clears)
    DELETE /apps/{app_id}/templates/{id}     delete
Fields: name, app_name, file (a logo file id), css, header_html, footer_html,
default, metadata (not sent: its form encoding is undocumented to us).

Usage (from backend/):
    .venv/bin/python scripts/finexer_template.py [--app-id ID] list
    ... show <id> | preview <id> | delete <id> --yes
    ... sync [--logo-file-id FILE_ID]
    ... make-default <id> --yes

SAFETY: `sync` always sends default=false on create and never sends default at
all on update. Only `make-default --yes` makes a template the default, because
a default template changes the live consent page at once if UAT and production
share one Finexer app.

The key is read from the environment or backend/.env and is never printed.
Logo: pass --logo-file-id once a 'logo' file object exists (dashboard upload or
the Files API); no upload is implemented here.
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

import httpx

_BACKEND = Path(__file__).resolve().parents[1]
BRAND_DIR = _BACKEND / "app" / "data" / "finexer_brand"
STATE_FILE = _BACKEND / ".finexer_templates.json"
API_URL = "https://api.finexer.com"
# Finexer substitutes app_name into the page headline ("<app_name> is requesting
# permission to read:") and the regulated footer ("<app_name> acts as Finexer
# Ltd's registered agent"). Kevin 2026-10-08: "Sorted", pending Finexer adding
# the trading name Sorted to AURIQ LTD's register entry; the header line keeps
# "AURIQ LTD, trading as Sorted".
APP_NAME = "Sorted"
TEMPLATES = {"light": "Sorted light", "dark": "Sorted dark"}


def _env(name: str, env_file: Path | None = None) -> str:
    if os.environ.get(name):
        return os.environ[name]
    from dotenv import dotenv_values

    for p in [env_file, Path(__file__).resolve().parents[1] / ".env"]:
        if p and p.exists():
            v = dotenv_values(p).get(name)
            if v:
                return v
    return ""


def _read(name: str) -> str:
    return (BRAND_DIR / name).read_text(encoding="utf-8")


CSS_LIMIT = 2000  # Finexer: "The length for the CSS content must not exceed 2000 characters"


def minify_css(css: str) -> str:
    """Strip comments and whitespace so the commented source files fit
    Finexer's 2000-character CSS limit. Variables are kept."""
    css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
    css = re.sub(r"\s+", " ", css)
    css = re.sub(r"\s*([{};:,>])\s*", r"\1", css)
    return css.strip().replace(";}", "}")


def build_payload(kind: str, logo_file_id: str | None = None) -> dict:
    """Form fields for one template, built from the versioned files. Never
    contains `default`; callers add it on create only."""
    tokens = _read("sorted-light.css" if kind == "light" else "sorted-dark.css")
    payload = {
        "name": TEMPLATES[kind],
        "app_name": APP_NAME,
        "css": minify_css(tokens + "\n" + _read("sorted.css")),
        "header_html": _read("header.html"),
    }
    if len(payload["css"]) > CSS_LIMIT:
        raise SystemExit(f"{kind} css is {len(payload['css'])} chars, over Finexer's {CSS_LIMIT} limit")
    footer = BRAND_DIR / "footer.html"
    if footer.exists():
        payload["footer_html"] = footer.read_text(encoding="utf-8")
    if logo_file_id:
        payload["file"] = logo_file_id
    return payload


def _items(body) -> list:
    if isinstance(body, list):
        return body
    if isinstance(body, dict):
        for k in ("data", "templates", "items"):
            if isinstance(body.get(k), list):
                return body[k]
    return []


def _load_all_state(legacy_app_id: str = "") -> dict:
    """State is {app_id: {kind: template_id}}. A legacy flat {kind: id} file is
    migrated under `legacy_app_id` (the app it was written for)."""
    raw = json.loads(STATE_FILE.read_text()) if STATE_FILE.exists() else {}
    if any(not isinstance(v, dict) for v in raw.values()):
        raw = {legacy_app_id: raw} if legacy_app_id else {}
    return raw


def _load_state(app_id: str) -> dict:
    return dict(_load_all_state(app_id).get(app_id, {}))


def _save_state(app_id: str, state: dict) -> None:
    allstate = _load_all_state(app_id)
    allstate[app_id] = state
    STATE_FILE.write_text(json.dumps(allstate, indent=2) + "\n")


def _find_previews(obj, found=None):
    found = [] if found is None else found
    if isinstance(obj, dict):
        for k, v in obj.items():
            if "preview" in k.lower() and isinstance(v, (str, dict, list)):
                found.append((k, v))
            else:
                _find_previews(v, found)
    elif isinstance(obj, list):
        for v in obj:
            _find_previews(v, found)
    return found


def _check(resp: httpx.Response, what: str) -> dict:
    if resp.status_code >= 400:
        print(f"{what}: HTTP {resp.status_code} {resp.text[:400]}", file=sys.stderr)
        raise SystemExit(1)
    print(f"{what}: HTTP {resp.status_code}")
    try:
        return resp.json()
    except ValueError:
        return {}


def cmd_list(c, base):
    body = _check(c.get(base), "list")
    for t in _items(body):
        print(f"{t.get('id')}  {t.get('name')!r}  default={t.get('default')}")
    if not _items(body):
        print(json.dumps(body)[:600])


def cmd_show(c, base, tid):
    print(json.dumps(_check(c.get(f"{base}/{tid}"), "show"), indent=2))


def cmd_preview(c, base, tid):
    body = _check(c.get(f"{base}/{tid}"), "preview")
    links = _find_previews(body)
    if not links:
        print("no preview field in the response; full object:")
        print(json.dumps(body, indent=2))
    for k, v in links:
        print(f"{k}: {json.dumps(v) if not isinstance(v, str) else v}")


def cmd_delete(c, base, app_id, tid, yes=False):
    if not yes:
        print("refusing: delete is irreversible. Re-run with --yes.", file=sys.stderr)
        raise SystemExit(2)
    _check(c.delete(f"{base}/{tid}"), "delete")
    state = {k: v for k, v in _load_state(app_id).items() if v != tid}
    _save_state(app_id, state)


def cmd_make_default(c, base, tid, yes):
    if not yes:
        print("refusing: make-default changes the live consent page at once. Re-run with --yes.", file=sys.stderr)
        raise SystemExit(2)
    _check(c.post(f"{base}/{tid}", data={"default": "true"}), "make-default")


def cmd_sync(c, base, app_id, logo_file_id=None, only=None):
    existing = {t.get("name"): t for t in _items(_check(c.get(base), "list"))}
    state = _load_state(app_id)
    for kind, name in TEMPLATES.items():
        if only and kind != only:
            continue
        payload = build_payload(kind, logo_file_id)
        if name in existing:
            tid = existing[name]["id"]
            _check(c.post(f"{base}/{tid}", data=payload), f"update {name}")
        else:
            body = _check(c.post(base, data={**payload, "default": "false"}), f"create {name}")
            tid = body.get("id")
            if not tid:
                print(f"create {name}: no id in response: {json.dumps(body)[:300]}", file=sys.stderr)
                raise SystemExit(1)
        state[kind] = tid
        print(f"{name}: {tid}")
    _save_state(app_id, state)
    print(f"state saved to {STATE_FILE.name}")


def main(argv=None, client: httpx.Client | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--app-id")
    ap.add_argument("--env-file", type=Path)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list")
    for n in ("show", "preview"):
        sub.add_parser(n).add_argument("id")
    d = sub.add_parser("delete")
    d.add_argument("id")
    d.add_argument("--yes", action="store_true")
    s = sub.add_parser("sync")
    s.add_argument("--logo-file-id")
    s.add_argument("--only", choices=sorted(TEMPLATES), help="sync just this template")
    m = sub.add_parser("make-default")
    m.add_argument("id")
    m.add_argument("--yes", action="store_true")
    a = ap.parse_args(argv)

    if a.cmd == "delete" and not a.yes:
        print("refusing: delete is irreversible. Re-run with --yes.", file=sys.stderr)
        return 2
    if a.cmd == "make-default" and not a.yes:
        print("refusing: make-default changes the live consent page at once. Re-run with --yes.", file=sys.stderr)
        return 2
    app_id = a.app_id or _env("FINEXER_APP_ID", a.env_file)
    if not app_id:
        print("No Finexer app id. Pass --app-id or set FINEXER_APP_ID (the id is in the Finexer app settings).", file=sys.stderr)
        return 2
    key = _env("FINEXER_API_KEY", a.env_file)
    if not key and client is None:
        print("FINEXER_API_KEY is not set.", file=sys.stderr)
        return 2
    c = client or httpx.Client(auth=(key, ""), timeout=30.0)
    base = f"{API_URL}/apps/{app_id}/templates"
    try:
        if a.cmd == "list":
            cmd_list(c, base)
        elif a.cmd == "show":
            cmd_show(c, base, a.id)
        elif a.cmd == "preview":
            cmd_preview(c, base, a.id)
        elif a.cmd == "delete":
            cmd_delete(c, base, app_id, a.id, a.yes)
        elif a.cmd == "sync":
            cmd_sync(c, base, app_id, a.logo_file_id, a.only)
        elif a.cmd == "make-default":
            cmd_make_default(c, base, a.id, a.yes)
    except SystemExit as e:
        return int(e.code or 0)
    return 0


if __name__ == "__main__":
    sys.exit(main())
