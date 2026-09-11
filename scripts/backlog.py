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
    show <id>                           Print one item as a single JSON
                                        object (id, title, state, reason,
                                        branch, owner, done_at, ...) and
                                        exit 1 with an error on stderr if
                                        <id> doesn't exist. Read-only;
                                        meant for scripts (e.g.
                                        scripts/session.sh) to check an
                                        item's state without scraping the
                                        human-readable `list` table.
    add <section> "<title>" [--owner kevin|claude|codex]
                                        Add a new item under section heading
                                        "## <section>. ..." (e.g. A, H) with
                                        the next free id in that section.
                                        Prints just the new id on stdout.
    start <id> [--branch <name>]        Mark an item in progress. --branch
                                        records the live worktree's branch
                                        (scripts/session.sh start passes
                                        this); omit it for a plain mark
                                        with no worktree attached.
    block <id> "<reason>"               Mark an item blocked, with a reason.
    review <id> --branch <name> [--uat-review]
                                        Mark an item in review on a branch
                                        (see docs/ops/BACKLOG.md "Branch per
                                        item" — scripts/session.sh finish
                                        calls this once tests are green).
                                        --uat-review flags this as a design
                                        round: scripts/integrate.py lands a
                                        clean merge in "uat" instead of
                                        "done" (see the "uat" command below).
    reject <id> "<reason>"              Reject an item sitting in review,
                                        with a reason (required). Use this
                                        the moment a reviewer finds a defect
                                        in work sitting in review, leaving it
                                        there is treated as consent to merge
                                        by any integrate pass, including one
                                        from a concurrent session. Keeps the
                                        item's branch so the reviewer can see
                                        which branch was refused; start or
                                        todo moves it back out again.
    uat <id> --link <url>               Move an item into "uat": a design
                                        round has landed on a rebuilt UAT
                                        and is waiting on Kevin's review, not
                                        on the next integrate pass ("uat" is
                                        never picked up as a merge
                                        candidate). The link must be on the
                                        public UAT host
                                        (uat.wealth.auriqltd.co.uk); a
                                        127.0.0.1/localhost link is
                                        normalised onto it automatically,
                                        any other host is rejected. Normally
                                        set automatically by
                                        scripts/integrate.py; this command
                                        is for a manual retrofit.
    approve <id> "<choice>"             Record which variant Kevin picked
                                        from a "uat" round (required) as a
                                        dated note, and move the item back
                                        to "in-progress" with its owner
                                        UNCHANGED, so the same agent
                                        implements the winner on a fresh
                                        branch. Only valid on an item
                                        currently in "uat".
    todo <id>                           Reset an item to to-do (clears any
                                        state tag, including a rejection;
                                        used by session.sh abandon).
    done <id> [--commit <sha>] [--merge <sha>]
                                        Tick an item done. --merge is an
                                        alias for --commit for the case
                                        where the id is the merge commit on
                                        main (scripts/integrate.py uses it).
    reopen <id>                         Untick a done item.
    note <id> "<text>"                  Add a dated note under an item.
    owner <id> kevin|claude|codex       Change who owns an item.
    priority <id> p1|p2|p3             Set an item's priority (defaults to
                                        p3 when the tag is absent).
    unblocks <id> Q5,Q6                 Set the questions an item unblocks
                                        (comma-separated ids; empty string
                                        clears the tag).
    status Q7 ready|needs-kevin|blocked-deploy|submitted
                                        Set a questionnaire question's status.

Every command takes an optional `--actor kevin|claude|codex` (defaults to
`claude`) that is recorded in the note/commit and attributed as the git
commit's actor label.

The board's repo root is fixed to `/root/ai-wealth-dashboard` regardless of
the caller's cwd (see `BACKLOG_ROOT` in `backend/app/services/backlog.py`),
so this CLI edits the one shared board even when run from a git worktree
under `/root/worktrees/<branch>`. Set `BACKLOG_ROOT` to point it elsewhere
(tests only).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "backend"))

from app.services import backlog  # noqa: E402


def _print_result(item_id: str, result: dict, committed: bool) -> None:
    print(f"{item_id}: {result}")
    if not committed:
        print("  (saved to file; git commit or push failed — see logs)")


def _state_display(item: dict) -> str:
    if item["state"] == "review" and item.get("branch"):
        return f"review:{item['branch']}"
    if item["state"] == "rejected" and item.get("branch"):
        return f"rejected:{item['branch']}"
    return item["state"]


def cmd_list(args: argparse.Namespace) -> None:
    snapshot = backlog.load()
    print(f"{'id':<6} {'owner':<7} {'pri':<4} {'state':<28} {'done_at':<12} {'unblocks':<14} {'title'}")
    for item in snapshot.items():
        print(
            f"{item['id']:<6} {item['owner'] or '-':<7} {item['priority']:<4} {_state_display(item):<28} "
            f"{item['done_at'] or '-':<12} {', '.join(item['unblocks']) or '-':<14} {item['title']}"
        )
    print()
    print(f"{'q':<5} {'status':<15} {'unblocked_by':<14} {'title'}")
    for q in snapshot.questions():
        print(f"{q['q']:<5} {q['status']:<15} {', '.join(q['unblocked_by']) or '-':<14} {q['title']}")


def cmd_show(args: argparse.Namespace) -> None:
    snapshot = backlog.load()
    item = snapshot.todo.item(args.item_id)  # raises BacklogError if unknown
    print(json.dumps(item.to_dict()))


def cmd_add(args: argparse.Namespace) -> None:
    result, committed = backlog.add_item(args.section, args.title, owner=args.owner, actor=args.actor)
    # Print just the new id on stdout so callers (scripts/session.sh) can
    # capture it directly; everything else goes to stderr.
    print(result["id"])
    if not committed:
        print("(saved to file; git commit or push failed — see logs)", file=sys.stderr)


def cmd_start(args: argparse.Namespace) -> None:
    result, committed = backlog.set_state(args.item_id, "in-progress", branch=args.branch, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_block(args: argparse.Namespace) -> None:
    result, committed = backlog.set_state(args.item_id, "blocked", reason=args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_review(args: argparse.Namespace) -> None:
    result, committed = backlog.set_review(args.item_id, args.branch, actor=args.actor, uat_review=args.uat_review)
    _print_result(args.item_id, result, committed)


def cmd_reject(args: argparse.Namespace) -> None:
    result, committed = backlog.set_rejected(args.item_id, args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_uat(args: argparse.Namespace) -> None:
    result, committed = backlog.set_uat(args.item_id, args.link, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_approve(args: argparse.Namespace) -> None:
    result, committed = backlog.set_approved(args.item_id, args.choice, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_todo(args: argparse.Namespace) -> None:
    result, committed = backlog.set_state(args.item_id, "todo", actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_done(args: argparse.Namespace) -> None:
    sha = args.commit or args.merge
    result, committed = backlog.set_done(args.item_id, True, commit=sha, actor=args.actor)
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


def cmd_priority(args: argparse.Namespace) -> None:
    result, committed = backlog.set_priority(args.item_id, args.priority, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_unblocks(args: argparse.Namespace) -> None:
    questions = [q.strip() for q in args.questions.split(",") if q.strip()]
    result, committed = backlog.set_unblocks(args.item_id, questions, actor=args.actor)
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
        p.add_argument("--actor", choices=["kevin", "claude", "codex"], default="claude")

    p_list = sub.add_parser("list", help="Print every item and question.")
    p_list.set_defaults(func=cmd_list)

    p_show = sub.add_parser(
        "show", help="Print one item as JSON (read-only; for scripts to check state without scraping `list`)."
    )
    p_show.add_argument("item_id")
    p_show.set_defaults(func=cmd_show)

    p_add = sub.add_parser("add", help="Add a new item under a section heading; prints the new id.")
    p_add.add_argument("section", help="Section letter, e.g. A or H (must already have a '## <section>.' heading).")
    p_add.add_argument("title", help="Item title text.")
    p_add.add_argument("--owner", choices=["kevin", "claude", "codex"], default=None)
    add_actor(p_add)
    p_add.set_defaults(func=cmd_add)

    p_start = sub.add_parser("start", help="Mark an item in progress.")
    p_start.add_argument("item_id")
    p_start.add_argument(
        "--branch",
        default=None,
        help=(
            "Record the branch a live worktree is attached to (scripts/session.sh start passes this). "
            "Omit for a plain 'mark in progress' with no worktree, e.g. a manual start from the board."
        ),
    )
    add_actor(p_start)
    p_start.set_defaults(func=cmd_start)

    p_block = sub.add_parser("block", help="Mark an item blocked, with a reason.")
    p_block.add_argument("item_id")
    p_block.add_argument("reason")
    add_actor(p_block)
    p_block.set_defaults(func=cmd_block)

    p_review = sub.add_parser("review", help="Mark an item in review on a branch.")
    p_review.add_argument("item_id")
    p_review.add_argument("--branch", required=True)
    p_review.add_argument(
        "--uat-review",
        action="store_true",
        help="Flag this as a design round: integrate lands a clean merge in uat instead of done.",
    )
    add_actor(p_review)
    p_review.set_defaults(func=cmd_review)

    p_reject = sub.add_parser(
        "reject", help="Reject an item sitting in review, with a reason (a reviewer found a defect)."
    )
    p_reject.add_argument("item_id")
    p_reject.add_argument("reason")
    add_actor(p_reject)
    p_reject.set_defaults(func=cmd_reject)

    p_uat = sub.add_parser(
        "uat", help="Move an item into uat (waiting on Kevin's review), with a preview link."
    )
    p_uat.add_argument("item_id")
    p_uat.add_argument("--link", required=True)
    add_actor(p_uat)
    p_uat.set_defaults(func=cmd_uat)

    p_approve = sub.add_parser(
        "approve",
        help="Record Kevin's pick from a uat round and move the item back to in-progress (owner unchanged).",
    )
    p_approve.add_argument("item_id")
    p_approve.add_argument("choice")
    add_actor(p_approve)
    p_approve.set_defaults(func=cmd_approve)

    p_todo = sub.add_parser("todo", help="Reset an item to to-do (clears any state tag, including a rejection).")
    p_todo.add_argument("item_id")
    add_actor(p_todo)
    p_todo.set_defaults(func=cmd_todo)

    p_done = sub.add_parser("done", help="Tick an item done.")
    p_done.add_argument("item_id")
    p_done.add_argument("--commit", default=None)
    p_done.add_argument("--merge", default=None, help="Alias for --commit (the integrate merge commit sha).")
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
    p_owner.add_argument("owner", choices=["kevin", "claude", "codex"])
    add_actor(p_owner)
    p_owner.set_defaults(func=cmd_owner)

    p_priority = sub.add_parser("priority", help="Set an item's priority.")
    p_priority.add_argument("item_id")
    p_priority.add_argument("priority", choices=["p1", "p2", "p3"])
    add_actor(p_priority)
    p_priority.set_defaults(func=cmd_priority)

    p_unblocks = sub.add_parser(
        "unblocks", help="Set the comma-separated questions an item unblocks (empty string clears)."
    )
    p_unblocks.add_argument("item_id")
    p_unblocks.add_argument("questions", help="e.g. 'Q5,Q6' or '' to clear.")
    add_actor(p_unblocks)
    p_unblocks.set_defaults(func=cmd_unblocks)

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
