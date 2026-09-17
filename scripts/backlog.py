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
    start <id> [--branch <name>] [--force]
                                        Mark an item in progress. --branch
                                        records the live worktree's branch
                                        (scripts/session.sh start passes
                                        this); omit it for a plain mark
                                        with no worktree attached. Refuses a
                                        done item (H57) unless --force is
                                        passed; use "reopen" to deliberately
                                        reopen one instead. Also refuses a
                                        cancelled item (H80) unless --force
                                        is passed: this is the deliberate
                                        way to reopen one on purpose (unlike
                                        "rejected", reopening a cancelled
                                        item is never a silent side effect
                                        of another command).
    block <id> "<reason>" [--force]     Mark an item blocked, with a reason.
                                        Refuses a done item (H57) unless
                                        --force is passed; use "reopen" to
                                        deliberately reopen one instead.
    review <id> --branch <name> [--uat-review] [--force]
                                        Mark an item in review on a branch
                                        (see docs/ops/BACKLOG.md "Branch per
                                        item" — scripts/session.sh finish
                                        calls this once tests are green).
                                        --uat-review flags this as a design
                                        round: scripts/integrate.py lands a
                                        clean merge in "uat" instead of
                                        "done" (see the "uat" command below).
                                        Refuses a done item (H57) unless
                                        --force is passed; use "reopen" to
                                        deliberately reopen one instead.
                                        Also refuses a cancelled item (H80)
                                        unless --force is passed: without
                                        this, scripts/session.sh finish on a
                                        worktree Kevin had cancelled would
                                        silently push it into review.
    reject <id> "<reason>" [--force]    Reject an item sitting in review,
                                        with a reason (required). Use this
                                        the moment a reviewer finds a defect
                                        in work sitting in review, leaving it
                                        there is treated as consent to merge
                                        by any integrate pass, including one
                                        from a concurrent session. Keeps the
                                        item's branch so the reviewer can see
                                        which branch was refused; start or
                                        todo moves it back out again. Refuses
                                        a done item (H57) unless --force is
                                        passed; use "reopen" to deliberately
                                        reopen one instead.
    uat <id> --link <url> [--force]     Move an item into "uat": a design
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
                                        is for a manual retrofit. Refuses a
                                        done item (H57) unless --force is
                                        passed; use "reopen" to deliberately
                                        reopen one instead.
    approve <id> "<choice>"             Record which variant Kevin picked
                                        from a "uat" round (required) as a
                                        dated note, and move the item back
                                        to "in-progress" with its owner
                                        UNCHANGED, so the same agent
                                        implements the winner on a fresh
                                        branch. Only valid on an item
                                        currently in "uat".
    cancel <id> "<reason>"              Kevin-only: cancel an item because
                                        this work should not happen at all
                                        (obsolete, superseded, or simply not
                                        wanted), distinct from "rejected"
                                        (a reviewer found a defect, fix it)
                                        and "blocked" (can't proceed yet).
                                        The reason is required and is
                                        written as BOTH the one-line
                                        "[state: cancelled: ...]" tag AND a
                                        full dated note automatically. Actor
                                        "kevin" is the guard against typing
                                        --actor kevin by accident, not a
                                        hard barrier against intent (nothing
                                        stops a caller lying about who it
                                        is); the genuinely enforced kevin-
                                        only path is the Cancel control on
                                        /ops/go-live, which is real account-
                                        owner auth end to end. An agent that
                                        thinks something should be cancelled
                                        should leave a note recommending it
                                        and let Kevin decide. Refuses a done
                                        item outright (no --force override:
                                        cancelling something already done
                                        is meaningless). If the item had a
                                        live branch attached, it is retained
                                        on the item and recorded in its own
                                        note along with the exact command to
                                        clean up the worktree
                                        (scripts/session.sh abandon <id>),
                                        the branch/worktree itself is never
                                        touched. Unlike "rejected", start or
                                        todo does NOT reverse a cancellation
                                        by itself any more (H80 correction):
                                        both now refuse a cancelled item
                                        unless --force is passed, so
                                        reopening one is always a visible,
                                        deliberate choice, never a silent
                                        side effect of another command (e.g.
                                        scripts/session.sh abandon's cleanup
                                        no longer un-cancels an item).
    todo <id> [--force]                 Reset an item to to-do (clears any
                                        state tag, including a rejection;
                                        used by session.sh abandon). Refuses
                                        a done item (H57) unless --force is
                                        passed; use "reopen" to deliberately
                                        reopen one instead. Also refuses a
                                        cancelled item (H80) unless --force
                                        is passed, for the same reason.
    done <id> [--commit <sha>] [--merge <sha>] [--force]
                                        Tick an item done. --merge is an
                                        alias for --commit for the case
                                        where the id is the merge commit on
                                        main (scripts/integrate.py uses it).
                                        Refuses a cancelled item (H80)
                                        unless --force is passed: reopen it
                                        first (start/todo --force) rather
                                        than completing work Kevin decided
                                        should not happen.
    reopen <id>                         Untick a done item.
    note <id> "<text>"                  Add a dated note under an item.
    owner <id> kevin|claude|codex       Change who owns an item.
    priority <id> p1|p2|p3             Set an item's priority (defaults to
                                        p3 when the tag is absent).
    unblocks <id> Q5,Q6                 Set the questions an item unblocks
                                        (comma-separated ids; empty string
                                        clears the tag).
    clear-branch <id>                   Clear a dangling "[branch: ...]" tag
                                        after its branch/worktree has
                                        actually been deleted (H80;
                                        scripts/session.sh abandon uses this
                                        on a cancelled item so the tag never
                                        outlives the branch it names). Not
                                        actor-gated.
    status Q7 ready|needs-kevin|blocked-deploy|submitted
                                        Set a questionnaire question's status.
    lint [--apply]                      Scan TODO.md for H38-shaped damage:
                                        stray pytest progress lines and item
                                        lines left with a dangling, never-
                                        closed `[state: ...` fragment (both
                                        come from the pre-H27 defect where
                                        scripts/integrate.py wrote raw
                                        multi-line command output into a
                                        blocked/rejected reason). Dry run by
                                        default — prints what it would
                                        change and touches nothing; pass
                                        --apply to actually rewrite the
                                        file, under the same lock and with
                                        the same kind of git commit as every
                                        other command here.

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


def _refuse_if_done(item_id: str, command: str, force: bool) -> None:
    """H57: mirror the guard `scripts/session.sh start` already has around
    line 227 ("item $id is already done") at the CLI layer too. Before this,
    `start`/`block`/`todo` had no such check, so a mistyped id that happened
    to land on a done item would silently un-tick it (via `TodoDoc.set_state`
    clearing `done`/`done_at`/`commit`, see H55) with a real git commit on
    top, where the old masking bug at least made it a visible no-op. `reopen`
    is the actual command for deliberately reopening a done item (it clears
    `done` without stamping a new `[state: ...]` tag, see `TodoDoc.set_done`),
    so that is what this names rather than a generic "unset done" hand-wave;
    --force is the deliberate override for a caller who already knows what
    they're doing."""
    if force:
        return
    snapshot = backlog.load()
    item = snapshot.todo.item(item_id)  # raises BacklogError if unknown
    if item.to_dict()["state"] == "done":
        raise backlog.BacklogError(
            f"{item_id} is already done; use "
            f"'backend/.venv/bin/python scripts/backlog.py reopen {item_id}' to deliberately reopen it, "
            f"or pass --force to '{command}' if you mean to do this anyway."
        )


def _refuse_if_cancelled(item_id: str, command: str, force: bool) -> None:
    """H80 correction round (HIGH 1/HIGH 2): mirrors `_refuse_if_done`
    above, but for `cancelled`. Before this, `review`/`done`/`todo`/`start`
    had no idea an item might be cancelled, so a session that ran
    `scripts/session.sh finish` on a worktree Kevin had cancelled out from
    under it (mid-session, unaware) would push the branch and land the
    item straight in `review` with only `_refuse_if_done`'s done-flag
    check standing between it and the next integrate pass merging and
    ticking it done; and `scripts/session.sh abandon`'s own cleanup call
    (`todo`), the exact command `set_cancelled`'s own note recommends,
    would silently un-cancel the item as a side effect of tidying up its
    worktree. `--force` is the same deliberate override `_refuse_if_done`
    already uses: a cancelled item genuinely being reopened on purpose
    still reaches `start`/`todo` this way (see docs/ops/BACKLOG.md
    "cancelled state" for the full reopen path), it just can no longer
    happen as an unlabelled side effect of some other command. Unlike
    `rejected` (which means "fix it and come back", so plain `start`/
    `todo` reversing it with no extra flag is correct), `cancelled` means
    Kevin decided this should not happen at all, so reopening it is
    deliberately made to need a visible, active choice."""
    if force:
        return
    snapshot = backlog.load()
    item = snapshot.todo.item(item_id)  # raises BacklogError if unknown
    if item.to_dict()["state"] == "cancelled":
        reason = item.to_dict().get("reason") or ""
        detail = f": {reason}" if reason else ""
        raise backlog.BacklogError(
            f"{item_id} is cancelled{detail}; Kevin decided this should not happen. Pass --force to "
            f"'{command}' if it is genuinely being reopened on purpose (the same command still records "
            f"the transition normally), or leave it cancelled and use "
            f"'scripts/session.sh abandon {item_id}' to clean up a live worktree without reopening it."
        )


def _state_display(item: dict) -> str:
    if item["state"] == "review" and item.get("branch"):
        return f"review:{item['branch']}"
    if item["state"] == "rejected" and item.get("branch"):
        return f"rejected:{item['branch']}"
    if item["state"] == "cancelled" and item.get("branch"):
        return f"cancelled:{item['branch']}"
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
    _refuse_if_done(args.item_id, "start", args.force)
    _refuse_if_cancelled(args.item_id, "start", args.force)
    result, committed = backlog.set_state(args.item_id, "in-progress", branch=args.branch, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_block(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "block", args.force)
    result, committed = backlog.set_state(args.item_id, "blocked", reason=args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_review(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "review", args.force)
    _refuse_if_cancelled(args.item_id, "review", args.force)
    result, committed = backlog.set_review(args.item_id, args.branch, actor=args.actor, uat_review=args.uat_review)
    _print_result(args.item_id, result, committed)


def cmd_reject(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "reject", args.force)
    result, committed = backlog.set_rejected(args.item_id, args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_uat(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "uat", args.force)
    result, committed = backlog.set_uat(args.item_id, args.link, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_approve(args: argparse.Namespace) -> None:
    result, committed = backlog.set_approved(args.item_id, args.choice, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_cancel(args: argparse.Namespace) -> None:
    # No _refuse_if_done/_refuse_if_cancelled/--force here (unlike
    # start/block/review/reject/uat above): a cancel on a done item is
    # refused outright, by backend.services.backlog.TodoDoc.set_state
    # itself, with no override, see H80. The kevin-only actor check lives
    # at that same layer too (also checking BACKLOG_AGENT, defence in
    # depth), so a non-kevin --actor (or the "claude" default) makes NO
    # change to the board; this command never needs its own duplicate
    # guard for either rule. Re-cancelling an already-cancelled item is
    # fine (lets a reason be corrected), so there is nothing to refuse
    # there either.
    result, committed = backlog.set_cancelled(args.item_id, args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)
    if result.get("branch"):
        print(
            f"  a live branch, {result['branch']}, was attached — clean it up from the shared tree with "
            f"'scripts/session.sh abandon {args.item_id}' (never auto-run; the worktree is untouched)."
        )


def cmd_todo(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "todo", args.force)
    _refuse_if_cancelled(args.item_id, "todo", args.force)
    result, committed = backlog.set_state(args.item_id, "todo", actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_done(args: argparse.Namespace) -> None:
    _refuse_if_cancelled(args.item_id, "done", args.force)
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


def cmd_clear_branch(args: argparse.Namespace) -> None:
    result, committed = backlog.clear_branch(args.item_id, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_status(args: argparse.Namespace) -> None:
    result, committed = backlog.set_question_status(args.item_id, args.status, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_lint(args: argparse.Namespace) -> None:
    findings, committed = backlog.repair_todo(apply=args.apply, actor=args.actor)
    if not findings:
        print("lint: no H38-shaped damage found." if not args.apply else "repair: nothing to fix.")
        return
    verb = "removed" if args.apply else "would remove"
    for f in findings:
        if f["kind"] == "noise_line":
            print(f"line {f['line_no'] + 1}: {verb} pytest noise line: {f['original']!r}")
        else:
            print(
                f"line {f['line_no'] + 1} ({f['item_id']}): "
                f"{'rewrote' if args.apply else 'would rewrite'} dangling state tag\n"
                f"  before: {f['original']!r}\n"
                f"  after:  {f['replacement']!r}"
            )
    print(f"\n{len(findings)} finding(s){' fixed' if args.apply else ' (dry run, pass --apply to fix)'}.")
    if args.apply and not committed:
        print("  (saved to file; git commit or push failed — see logs)")


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
    p_start.add_argument(
        "--force",
        action="store_true",
        help="Override the done-item guard (H57): start on a done item normally refuses, "
        "pointing at 'reopen' instead.",
    )
    add_actor(p_start)
    p_start.set_defaults(func=cmd_start)

    p_block = sub.add_parser("block", help="Mark an item blocked, with a reason.")
    p_block.add_argument("item_id")
    p_block.add_argument("reason")
    p_block.add_argument(
        "--force",
        action="store_true",
        help="Override the done-item guard (H57): block on a done item normally refuses, "
        "pointing at 'reopen' instead.",
    )
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
    p_review.add_argument(
        "--force",
        action="store_true",
        help="Override the done-item guard (H57): review on a done item normally refuses, "
        "pointing at 'reopen' instead.",
    )
    add_actor(p_review)
    p_review.set_defaults(func=cmd_review)

    p_reject = sub.add_parser(
        "reject", help="Reject an item sitting in review, with a reason (a reviewer found a defect)."
    )
    p_reject.add_argument("item_id")
    p_reject.add_argument("reason")
    p_reject.add_argument(
        "--force",
        action="store_true",
        help="Override the done-item guard (H57): reject on a done item normally refuses, "
        "pointing at 'reopen' instead.",
    )
    add_actor(p_reject)
    p_reject.set_defaults(func=cmd_reject)

    p_uat = sub.add_parser(
        "uat", help="Move an item into uat (waiting on Kevin's review), with a preview link."
    )
    p_uat.add_argument("item_id")
    p_uat.add_argument("--link", required=True)
    p_uat.add_argument(
        "--force",
        action="store_true",
        help="Override the done-item guard (H57): uat on a done item normally refuses, "
        "pointing at 'reopen' instead.",
    )
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

    p_cancel = sub.add_parser(
        "cancel",
        help="Kevin-only: cancel an item (this work should not happen at all), with a reason.",
    )
    p_cancel.add_argument("item_id")
    p_cancel.add_argument("reason")
    add_actor(p_cancel)
    p_cancel.set_defaults(func=cmd_cancel)

    p_todo = sub.add_parser("todo", help="Reset an item to to-do (clears any state tag, including a rejection).")
    p_todo.add_argument("item_id")
    p_todo.add_argument(
        "--force",
        action="store_true",
        help="Override the done-item guard (H57): todo on a done item normally refuses, "
        "pointing at 'reopen' instead.",
    )
    add_actor(p_todo)
    p_todo.set_defaults(func=cmd_todo)

    p_done = sub.add_parser("done", help="Tick an item done.")
    p_done.add_argument("item_id")
    p_done.add_argument("--commit", default=None)
    p_done.add_argument("--merge", default=None, help="Alias for --commit (the integrate merge commit sha).")
    p_done.add_argument(
        "--force",
        action="store_true",
        help="H80: override the cancelled-item guard (done on a cancelled item normally refuses, "
        "pointing at start/todo --force or scripts/session.sh abandon instead).",
    )
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

    p_clear_branch = sub.add_parser(
        "clear-branch",
        help="H80: clear a dangling [branch: ...] tag after its branch/worktree has actually been "
        "deleted (scripts/session.sh abandon uses this on a cancelled item). Not actor-gated.",
    )
    p_clear_branch.add_argument("item_id")
    add_actor(p_clear_branch)
    p_clear_branch.set_defaults(func=cmd_clear_branch)

    p_status = sub.add_parser("status", help="Set a questionnaire question's status.")
    p_status.add_argument("item_id")
    p_status.add_argument("status", choices=["ready", "needs-kevin", "blocked-deploy", "submitted"])
    add_actor(p_status)
    p_status.set_defaults(func=cmd_status)

    p_lint = sub.add_parser(
        "lint", help="Scan TODO.md for stray pytest noise / dangling state tags (H38). Dry run unless --apply."
    )
    p_lint.add_argument("--apply", action="store_true", help="Actually rewrite the file (default: dry run).")
    add_actor(p_lint)
    p_lint.set_defaults(func=cmd_lint)

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
