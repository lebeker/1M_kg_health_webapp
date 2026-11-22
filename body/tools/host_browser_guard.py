"""Owner policy, in code: a QA driver may not start a host browser from an agent harness.

The standing rule (owner, 2026-11-22) is that no bot, child agent, reviewer or harness may launch,
attach to or control a host application — a browser included. The CDP drivers beside this file
(`probe.py`, `stress.py`, `browser_qa.py`) exist so the machine's owner can look at the body page
by hand; an agent that runs one is doing the forbidden thing, so they refuse when they detect an
agent harness and say what to do instead.

The owner's own runs are untouched (no `HERMES_*` in that shell), and an owner who knows what they
are doing can pass `--force-host-browser`.

    from host_browser_guard import begin
    ARGS = begin("probe.py", sys.argv[1:], USAGE)

`begin` handles `-h/--help`, refuses under a harness, and returns `argv` with the force flag
removed so the caller never has to think about it again.

    python3 host_browser_guard.py --selftest    # the pure logic, no browser, no network
"""
from __future__ import annotations

import io
import os
import sys
from contextlib import redirect_stderr, redirect_stdout

HARNESS_VARS = ("HERMES_PROFILE", "HERMES_SESSION_ID", "HERMES_HOME")
FORCE_FLAG = "--force-host-browser"
HELP_FLAGS = ("-h", "--help")

SERVED = (
    "Agents verify with Hermes `browser_*` against a served build, never a browser this script\n"
    "started:\n"
    "    python3 -m http.server 8770 --bind 127.0.0.1   # in the tree under test, at its root\n"
    "then browser_navigate / browser_console / browser_vision on\n"
    "http://127.0.0.1:8770/body/index.html — or on `bun run build` → dist/index.html."
)


def harness_var(environ=None):
    """The first `HERMES_*` variable that says this process is running under an agent."""
    env = os.environ if environ is None else environ
    for name in HARNESS_VARS:
        if env.get(name):
            return name
    return None


def refusal(script, var):
    """The one message an agent gets instead of a browser."""
    return (
        f"{script}: refusing to launch a host browser — {var} is set, so this is an agent harness.\n"
        "Owner policy: bots, child agents, reviewers and harnesses do not launch, attach to or\n"
        "control host applications.\n"
        f"{SERVED}\n"
        f"Owner-only manual run: re-run with {FORCE_FLAG}."
    )


def help_text(script, usage):
    """What `--help` prints: this is an owner-only manual tool and says so."""
    return (
        f"{usage}\n"
        "\n"
        "OWNER-ONLY manual tool. It launches the local Chrome app over CDP; nothing else in this\n"
        f"repo does. Agents never run it: they verify with Hermes `browser_*` against a served build,\n"
        "and this script refuses to start a host browser when it detects an agent harness\n"
        f"({', '.join(HARNESS_VARS)}).\n"
        f"{FORCE_FLAG} overrides the refusal and is for the machine's owner only.\n"
        "\n"
        f"{SERVED}"
    )


def begin(script, argv, usage, environ=None):
    """Handle `--help`, refuse under an agent harness, and return `argv` minus the force flag."""
    argv = list(argv)
    if any(a in HELP_FLAGS for a in argv):
        print(help_text(script, usage))
        raise SystemExit(0)
    var = harness_var(environ)
    if var and FORCE_FLAG not in argv:
        print(refusal(script, var), file=sys.stderr)
        raise SystemExit(2)
    return [a for a in argv if a != FORCE_FLAG]


def _selftest():
    """The decisions, checked without starting anything."""
    assert harness_var({}) is None
    assert harness_var({"PATH": "/usr/bin"}) is None
    for name in HARNESS_VARS:
        assert harness_var({name: "x"}) == name
    assert harness_var({"HERMES_PROFILE": ""}) is None  # an empty var is not a harness

    # the owner's own shell: no HERMES_*, no refusal, argv untouched
    assert begin("t.py", ["--port", "9"], "usage: t.py", environ={}) == ["--port", "9"]

    # an agent: exit 2, one message, and it names the tools and the served build
    for name in HARNESS_VARS:
        err = io.StringIO()
        with redirect_stderr(err):
            try:
                begin("t.py", [], "usage: t.py", environ={name: "x"})
            except SystemExit as exit_:
                assert exit_.code == 2, exit_.code
            else:
                raise AssertionError(f"no refusal under {name}")
        message = err.getvalue()
        assert message.count("refusing to launch a host browser") == 1, message
        assert "browser_*" in message and "served build" in message, message
        assert "http://127.0.0.1:8770/body/index.html" in message, message

    # the owner's escape hatch: same harness, but the flag is honoured and stripped
    assert begin("t.py", ["--port", "9", FORCE_FLAG], "usage: t.py",
                 environ={"HERMES_PROFILE": "x"}) == ["--port", "9"]

    # --help works under a harness too: it starts nothing, it only explains
    out = io.StringIO()
    with redirect_stdout(out):
        try:
            begin("t.py", ["--help"], "usage: t.py", environ={"HERMES_PROFILE": "x"})
        except SystemExit as exit_:
            assert exit_.code == 0, exit_.code
        else:
            raise AssertionError("--help did not exit")
    assert "OWNER-ONLY" in out.getvalue() and FORCE_FLAG in out.getvalue(), out.getvalue()

    print("ok: harness detection, refusal, --help and the owner's override")


if __name__ == "__main__":
    if "--selftest" in sys.argv[1:]:
        _selftest()
    else:
        print(help_text(os.path.basename(sys.argv[0]) if sys.argv[0] else "host_browser_guard.py",
                        "usage: host_browser_guard.py --selftest"))
