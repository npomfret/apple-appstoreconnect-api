#!/usr/bin/env python3
"""PreToolUse hook: let the Playwright MCP tools run unprompted, inside bounds.

The tools stayed unallowed because a blanket allow is an agent that can rewrite
its own permissions: `browser_evaluate` with a `filename` wrote text of its choosing
into `.claude/settings.json` and `.git/hooks/pre-commit` (measured 2026-09-12,
@playwright/mcp 0.0.80), and a permission rule cannot see a tool's arguments. This
hook can, so it decides per call instead of per tool:

- Navigation (`url` on browser_navigate and browser_tabs) is approved only to the
  project's reviewed local/deployed URLs, delivered by sync.py in
  .agents/agent-standards/browser-urls.json, and about:blank. Elsewhere asks.
  Scheme, host and port must match, with segment-bounded path prefixes for shared
  hosts. Only where the agent points the browser is
  limited; what the page itself fetches is the app's business.
- A `filename` the tool writes must land under the project's `.playwright-mcp/`,
  the server's own output directory, or the call is refused with a reason so the
  agent can retry. Omitting it returns the result inline.
- `paths` the page is handed (browser_drop, browser_file_upload) must be inside the
  project and outside `.git`, `.claude`, `secrets` and `.env*`, or the call asks.
- browser_run_code_unsafe always asks: it runs arbitrary code in the server's own
  Node process, which no argument check bounds.
- A tool not known here gets no decision, so it prompts as before, until someone
  has read what its arguments can do.
"""
import json
import os
import pathlib
import posixpath
import re
import subprocess
import sys
import urllib.parse

PREFIX = "mcp__plugin_playwright_playwright__"
OUTPUT = ".playwright-mcp"
POLICY = pathlib.Path(".agents/agent-standards/browser-urls.json")
PRIVATE = (".git", ".claude", ".codex", "secrets")

WRITES = frozenset((
    "browser_evaluate",
    "browser_snapshot",
    "browser_take_screenshot",
    "browser_console_messages",
    "browser_network_requests",
    "browser_network_request",
))
READS = frozenset(("browser_drop", "browser_file_upload"))
NAVIGATES = frozenset(("browser_navigate", "browser_tabs"))
INERT = frozenset((
    "browser_click",
    "browser_close",
    "browser_drag",
    "browser_emulate_media",
    "browser_fill_form",
    "browser_find",
    "browser_handle_dialog",
    "browser_hover",
    "browser_navigate_back",
    "browser_press_key",
    "browser_resize",
    "browser_select_option",
    "browser_type",
    "browser_wait_for",
))
KNOWN = WRITES | READS | NAVIGATES | INERT


def decide(decision, reason):
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": decision,
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )
    return 0


def project_url(url, bases):
    if url.strip() == "about:blank":
        return True
    try:
        parts = urllib.parse.urlsplit(url.strip())
        if (parts.scheme not in ("http", "https") or not parts.hostname
                or parts.username is not None or parts.password is not None
                or "\\" in url or any(ord(char) < 32 for char in url)):
            return False
        origin = (parts.scheme, parts.hostname, parts.port if parts.port is not None else (443 if parts.scheme == "https" else 80))
        path = posixpath.normpath(parts.path or "/")
        for base in bases:
            allowed = urllib.parse.urlsplit(base)
            allowed_origin = (allowed.scheme, allowed.hostname, allowed.port if allowed.port is not None else (443 if allowed.scheme == "https" else 80))
            prefix = (allowed.path or "/").rstrip("/")
            if prefix and re.search(r"%(?:2e|2f|5c|25)", parts.path, re.I):
                continue
            if origin == allowed_origin and (not prefix or path == prefix or path.startswith(prefix + "/")):
                return True
    except (TypeError, ValueError):
        return False
    return False


def project_urls(root):
    try:
        policy = json.loads((root / POLICY).read_text())
        urls = policy["urls"]
        if not isinstance(urls, list) or not urls or not all(valid_base(url) for url in urls):
            return ()
    except (OSError, ValueError, KeyError, TypeError):
        return ()
    # The project's verification runner can publish a Docker-assigned loopback
    # origin here. Never accept a remote URL or an out-of-project symlink.
    runtime = root / "tmp/browser-runtime.json"
    try:
        if runtime.resolve().is_relative_to(root):
            origin = json.loads(runtime.read_text()).get("siteOrigin")
            if isinstance(origin, str) and loopback_port(origin) is not None:
                urls = [*urls, origin]
    except (OSError, ValueError, TypeError, AttributeError):
        pass
    return urls


def valid_base(url):
    if not isinstance(url, str):
        return False
    try:
        parts = urllib.parse.urlsplit(url)
        return (parts.scheme in ("http", "https") and bool(parts.hostname)
                and parts.username is None and parts.password is None
                and not parts.query and not parts.fragment
                and (parts.port is None or parts.port > 0)
                and "*" not in url and "\\" not in url
                and not any(char.isspace() for char in url))
    except ValueError:
        return False


def loopback_port(url):
    try:
        parts = urllib.parse.urlsplit(url)
        host = parts.hostname or ""
        if (parts.scheme in ("http", "https") and parts.username is None and parts.password is None
                and (host in ("localhost", "127.0.0.1", "::1") or host.endswith(".localhost"))
                and "\\" not in url and not any(ord(char) < 32 for char in url)):
            return parts.port if parts.port is not None else (443 if parts.scheme == "https" else 80)
    except (TypeError, ValueError):
        pass
    return None


def local_project_listener(url, root, run):
    """Prove a random local port belongs to this checkout, with bounded lsof."""
    port = loopback_port(url)
    if not port:
        return False
    try:
        listeners = run(["lsof", "-nP", f"-iTCP:{port}", "-sTCP:LISTEN", "-Fp"],
                        capture_output=True, text=True, timeout=2)
        pids = {line[1:] for line in listeners.stdout.splitlines() if line.startswith("p") and line[1:].isdigit()}
        if listeners.returncode or not pids:
            return False
        directories = run(["lsof", "-a", "-p", ",".join(sorted(pids)), "-d", "cwd", "-Fn"],
                          capture_output=True, text=True, timeout=2)
        owned = set()
        pid = None
        for line in directories.stdout.splitlines():
            if line.startswith("p"):
                pid = line[1:]
            elif line.startswith("n") and pathlib.Path(line[1:]).resolve().is_relative_to(root):
                owned.add(pid)
        return directories.returncode == 0 and pids <= owned
    except (OSError, ValueError, subprocess.TimeoutExpired):
        return False


def inside(root, path):
    try:
        (root / path).resolve().relative_to(root)
    except ValueError:
        return None
    return (root / path).resolve()


def private(root, target):
    parts = target.relative_to(root).parts
    return any(p in PRIVATE or p.startswith(".env") for p in parts)


def main():
    call = json.load(sys.stdin)
    tool = call.get("tool_name", "")[len(PREFIX):]
    args = call.get("tool_input") or {}
    root = pathlib.Path(os.environ.get("CLAUDE_PROJECT_DIR") or call.get("cwd") or ".").resolve()

    if tool == "browser_run_code_unsafe":
        return decide("ask", "Runs arbitrary code in the Playwright server process.")
    if tool not in KNOWN:
        return 0

    url = args.get("url")
    if url:
        urls = project_urls(root)
        if not (project_url(url, urls) or (urls and local_project_listener(url, root, subprocess.run))):
            return decide("ask", "URL is outside this project's reviewed browser URLs and local listeners; update its profile in agent-standards if needed.")

    filename = args.get("filename")
    if filename:
        target = inside(root, filename)
        output = (root / OUTPUT).resolve()
        if target is None or not (target == output or output in target.parents):
            return decide(
                "deny",
                f"Save browser output under {OUTPUT}/ (e.g. {OUTPUT}/page.png), "
                "or omit filename to get the result inline.",
            )

    for path in args.get("paths") or []:
        target = inside(root, path)
        if target is None or private(root, target):
            return decide("ask", f"{path} is outside the project or private to it.")

    return decide("allow", "Playwright call within the project's browser bounds.")


if __name__ == "__main__":
    sys.exit(main())
