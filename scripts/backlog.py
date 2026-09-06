#!/usr/bin/env python3
"""CLI for the backlog board — replaces `scripts/jira_sync.py`.

`TODO.md` and the Finexer questionnaire doc are the board now (see
`docs/ops/BACKLOG.md`); this script and the private page `/ops/go-live`
both write through `backend/app/services/backlog.py` so the file, the page
and git history stay one thing. Never tick an item by hand — use this so
the write goes through the lock and gets committed.

Run with `backend/.venv/bin/python scripts/backlog.py <command> ...`.

Commands:
    list                                Print every item and question.
    start <id>                          Mark an item in progress.
    block <id> "<reason>"               Mark an item blocked, with a reason.
    done <id> [--commit <sha>]          Tick an item done.
    reopen <id>                         Untick a done item.
    note <id> "<text>"                  Add a dated note under an item.
    owner <id> kevin|claude             Change who owns an item.
    status Q7 ready|needs-kevin|blocked-deploy|submitted
                                        Set a questionnaire question's status.

Every command takes an optional `--actor kevin|claude` (defaults to
`claude`) that is recorded in the note/commit and attributed as the git
commit's actor label.
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services import backlog  # noqa: E402


def _print_result(item_id: str, result: dict, committed: bool) -> None:
    print(f"{item_id}: {result}")
    if not committed:
        print("  (saved to file; git commit or push failed — see logs)")


def cmd_list(args: argparse.Namespace) -> None:
    snapshot = backlog.load()
    print(f"{'id':<6} {'owner':<7} {'state':<12} {'done_at':<12} {'title'}")
    for item in snapshot.items():
        print(f"{item['id']:<6} {item['owner'] or '-':<7} {item['state']:<12} {item['done_at'] or '-':<12} {item['title']}")
    print()
    print(f"{'q':<5} {'status':<15} {'title'}")
    for q in snapshot.questions():
        print(f"{q['q']:<5} {q['status']:<15} {q['title']}")


def cmd_start(args: argparse.Namespace) -> None:
    result, committed = backlog.set_state(args.item_id, "in-progress", actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_block(args: argparse.Namespace) -> None:
    result, committed = backlog.set_state(args.item_id, "blocked", reason=args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_done(args: argparse.Namespace) -> None:
    result, committed = backlog.set_done(args.item_id, True, commit=args.commit, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_reopen(args: argparse.Namespace) -> None:
    result, committed = backlog.set_done(args.item_id, False, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_note(args: argparse.Namespace) -> None:
    result, committed = backlog.add_note(args.item_id, args.text, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_owner(args: argparse.Namespace) -> None:
    result, committed = backlog.set_owner(args.item_id, args.owner, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_status(args: argparse.Namespace) -> None:
    result, committed = backlog.set_question_status(args.item_id, args.status, actor=args.actor)
    _print_result(args.item_id, result, committed)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="backlog.py",
        description="Read and write the backlog board (TODO.md + the Finexer questionnaire doc). See docs/ops/BACKLOG.md.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    def add_actor(p: argparse.ArgumentParser) -> None:
        p.add_argument("--actor", choices=["kevin", "claude"], default="claude")

    p_list = sub.add_parser("list", help="Print every item and question.")
    p_list.set_defaults(func=cmd_list)

    p_start = sub.add_parser("start", help="Mark an item in progress.")
    p_start.add_argument("item_id")
    add_actor(p_start)
    p_start.set_defaults(func=cmd_start)

    p_block = sub.add_parser("block", help="Mark an item blocked, with a reason.")
    p_block.add_argument("item_id")
    p_block.add_argument("reason")
    add_actor(p_block)
    p_block.set_defaults(func=cmd_block)

    p_done = sub.add_parser("done", help="Tick an item done.")
    p_done.add_argument("item_id")
    p_done.add_argument("--commit", default=None)
    add_actor(p_done)
    p_done.set_defaults(func=cmd_done)

    p_reopen = sub.add_parser("reopen", help="Untick a done item.")
    p_reopen.add_argument("item_id")
    add_actor(p_reopen)
    p_reopen.set_defaults(func=cmd_reopen)

    p_note = sub.add_parser("note", help="Add a dated note under an item.")
    p_note.add_argument("item_id")
    p_note.add_argument("text")
    add_actor(p_note)
    p_note.set_defaults(func=cmd_note)

    p_owner = sub.add_parser("owner", help="Change who owns an item.")
    p_owner.add_argument("item_id")
    p_owner.add_argument("owner", choices=["kevin", "claude"])
    add_actor(p_owner)
    p_owner.set_defaults(func=cmd_owner)

    p_status = sub.add_parser("status", help="Set a questionnaire question's status.")
    p_status.add_argument("item_id")
    p_status.add_argument("status", choices=["ready", "needs-kevin", "blocked-deploy", "submitted"])
    add_actor(p_status)
    p_status.set_defaults(func=cmd_status)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except backlog.BacklogError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
