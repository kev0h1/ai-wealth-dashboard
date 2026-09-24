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
                                        cancelled item (H80) with NO
                                        override at all; use "uncancel"
                                        instead (see below).
    block <id> "<reason>" [--force]     Mark an item blocked, with a reason.
                                        Refuses a done item (H57) unless
                                        --force is passed; use "reopen" to
                                        deliberately reopen one instead.
                                        Also refuses a cancelled item (H80)
                                        with NO override; use "uncancel".
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
                                        with NO override; use "uncancel".
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
                                        reopen one instead. Also refuses a
                                        cancelled item (H80) with NO
                                        override; use "uncancel" (this
                                        closes a real "reject then start"
                                        laundering path that needed no flag
                                        at all).
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
                                        reopen one instead. Also refuses a
                                        cancelled item (H80) with NO
                                        override; use "uncancel".
    approve <id> "<choice>"             Record which variant Kevin picked
                                        from a "uat" round (required) as a
                                        dated note, and move the item back
                                        to "in-progress" with its owner
                                        UNCHANGED, so the same agent
                                        implements the winner on a fresh
                                        branch. Only valid on an item
                                        currently in "uat".
    cancel <id> "<reason>"              Kevin-only on the CLI: cancel an
                                        item because this work should not
                                        happen at all (obsolete, superseded,
                                        or simply not wanted), distinct
                                        from "rejected" (a reviewer found a
                                        defect, fix it) and "blocked"
                                        (can't proceed yet). The reason is
                                        required and is written as BOTH the
                                        one-line "[state: cancelled: ...]"
                                        tag AND a full dated note
                                        automatically. Actor "kevin" here is
                                        the guard against typing --actor
                                        kevin by accident, not a hard
                                        barrier against intent (nothing
                                        stops a caller lying about who it
                                        is); the genuinely enforced kevin-
                                        only path is the Cancel control on
                                        /ops/go-live, which is real account-
                                        owner auth end to end. An agent that
                                        thinks something should be cancelled
                                        should leave a note recommending it
                                        and let Kevin decide. Refuses a done
                                        item outright (no override:
                                        cancelling something already done
                                        is meaningless). If the item had a
                                        live branch attached, it is retained
                                        on the item and recorded in its own
                                        note along with the exact command to
                                        clean up the worktree
                                        (scripts/session.sh abandon <id>),
                                        the branch/worktree itself is never
                                        touched. On the CLI (not
                                        /ops/go-live, see below), start,
                                        block, review, reject, uat, todo
                                        and done all refuse a cancelled item
                                        outright now, with no override at
                                        all; "uncancel" (below) is the only
                                        way out.
    uncancel <id> "<why>"               The only way out of "cancelled" on
                                        the CLI: requires a reason (like
                                        "cancel"/"reject" do), writes a
                                        dated note recording it, and moves
                                        the item to "todo". A dedicated
                                        verb rather than a --force flag on
                                        the commands above, so reversing a
                                        cancellation always leaves its own
                                        attributable record of who did it
                                        and why, the same shape "reopen"
                                        already gives the done/not-done
                                        boundary. Kevin-only on the CLI,
                                        the same shape and the same honest
                                        framing as "cancel" (actor "kevin"
                                        is a guard against forgetting, not
                                        a barrier against intent; --actor
                                        kevin is required): reopening a
                                        cancelled item is Kevin's own call,
                                        the same way cancelling it was, so
                                        an agent that meets one should
                                        leave a note recommending it be
                                        reopened and let Kevin run this
                                        himself.
    todo <id> [--force]                 Reset an item to to-do (clears any
                                        state tag, including a rejection;
                                        used by session.sh abandon on a
                                        non-cancelled item). Refuses a done
                                        item (H57) unless --force is
                                        passed; use "reopen" to deliberately
                                        reopen one instead. Also refuses a
                                        cancelled item (H80) with NO
                                        override; use "uncancel".
    done <id> [--commit <sha>] [--merge <sha>]
                                        Tick an item done. --merge is an
                                        alias for --commit for the case
                                        where the id is the merge commit on
                                        main (scripts/integrate.py uses it).
                                        Refuses a cancelled item (H80) with
                                        NO override at all: uncancel it
                                        first rather than completing work
                                        Kevin decided should not happen.
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


def _refuse_if_cancelled(item_id: str, command: str) -> None:
    """H80 correction round (reviewer round 2): unlike `_refuse_if_done`
    above, this has NO override at all. Before this round's own first fix,
    `review`/`done`/`todo`/`start` had no idea an item might be cancelled,
    so `scripts/session.sh finish` on a worktree Kevin had cancelled out
    from under it would push the branch and land it in `review`, and
    `scripts/session.sh abandon`'s own cleanup call (`todo`) would silently
    un-cancel the item as a side effect. That fix guarded start/review/
    todo/done with a --force override, but left `block`/`reject`/`uat`
    unrefused entirely -- measured, `reject` then `start` was a complete
    two-command laundering path needing no flag at all, since `start`
    already reverses a plain rejection with no override, and `block` was
    the realistic accident (CLAUDE.md tells every session to record a
    hand-back on the board in the same turn). A --force escape here also
    produced a board commit indistinguishable from an ordinary start/todo,
    with no record that a cancellation was overridden or why, and it
    handed an agent the exact token to type while asking it to judge
    whether the reopen was "genuine", which it cannot. So this guard now
    covers all seven commands that could otherwise move a cancelled item
    (`start`, `block`, `review`, `reject`, `uat`, `todo`, `done`) and
    offers no override at all -- the same shape H57's own
    `_refuse_if_done` already uses for its *primary* route: that guard
    points at the dedicated `reopen` verb rather than leading with
    --force, because a dedicated verb requiring its own reason leaves an
    attributable record a flag cannot. `uncancel <id> "<why>"` is that
    verb for cancelled: it is the only way out, on the CLI (`/ops/go-live`
    and its ItemDetailSheet "Move to" chips are a different, owner-only-
    auth path this guard does not cover, see docs/ops/BACKLOG.md).

    `uncancel` is Kevin's call, the same way `cancel` is (H80 final
    round): a cancellation is Kevin's own input, deciding a ticket should
    not happen, so an agent must not be the one to undo that decision
    either -- an agent that meets a cancelled item should stop, not
    reopen it. This refusal message says so and points at leaving a note
    instead, rather than just naming the command."""
    snapshot = backlog.load()
    item = snapshot.todo.item(item_id)  # raises BacklogError if unknown
    if item.to_dict()["state"] == "cancelled":
        reason = item.to_dict().get("reason") or ""
        detail = f": {reason}" if reason else ""
        raise backlog.BacklogError(
            f"{item_id} is cancelled{detail}; Kevin decided this should not happen. '{command}' cannot "
            f"move it out of cancelled, and there is no override for this one. Reopening it is Kevin's "
            f"call: leave a note recommending it be reopened "
            f"('scripts/backlog.py note {item_id} \"recommend reopening: <why>\"') and let Kevin run "
            f"'backend/.venv/bin/python scripts/backlog.py uncancel {item_id} \"<why>\" --actor kevin' "
            f"himself."
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
    if not snapshot.todo.items:
        # A board that parses to zero items is empty or truncated, not a
        # board that happens not to contain this id. Without this it
        # raises UnknownItemError like any typo, and the caller is told
        # to go and add something to a file that is mid-loss (item H85).
        raise backlog.BacklogError(
            "the board parsed to zero items, so TODO.md looks empty or truncated; "
            "do not add to it. Check it first with 'git status' and 'git diff TODO.md' "
            "in the shared tree."
        )
    item = snapshot.todo.item(args.item_id)  # raises UnknownItemError if unknown
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
    _refuse_if_cancelled(args.item_id, "start")
    result, committed = backlog.set_state(args.item_id, "in-progress", branch=args.branch, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_block(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "block", args.force)
    _refuse_if_cancelled(args.item_id, "block")
    result, committed = backlog.set_state(args.item_id, "blocked", reason=args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_review(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "review", args.force)
    _refuse_if_cancelled(args.item_id, "review")
    result, committed = backlog.set_review(args.item_id, args.branch, actor=args.actor, uat_review=args.uat_review)
    _print_result(args.item_id, result, committed)


def cmd_reject(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "reject", args.force)
    _refuse_if_cancelled(args.item_id, "reject")
    result, committed = backlog.set_rejected(args.item_id, args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_uat(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "uat", args.force)
    _refuse_if_cancelled(args.item_id, "uat")
    result, committed = backlog.set_uat(args.item_id, args.link, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_approve(args: argparse.Namespace) -> None:
    result, committed = backlog.set_approved(args.item_id, args.choice, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_cancel(args: argparse.Namespace) -> None:
    # No _refuse_if_done/_refuse_if_cancelled here (unlike
    # start/block/review/reject/uat/todo/done above): a cancel on a done
    # item is refused outright, by backend.services.backlog.TodoDoc.set_state
    # itself, with no override, see H80. The kevin-only actor check lives
    # at that same layer too, so a non-kevin --actor (or the "claude"
    # default) makes NO change to the board; this command never needs its
    # own duplicate guard for either rule. Re-cancelling an already-
    # cancelled item is fine (lets a reason be corrected), so there is
    # nothing to refuse there either.
    result, committed = backlog.set_cancelled(args.item_id, args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)
    if result.get("branch"):
        print(
            f"  a live branch, {result['branch']}, was attached, so clean it up from the shared tree with "
            f"'scripts/session.sh abandon {args.item_id}' (never auto-run; the worktree is untouched)."
        )


def cmd_uncancel(args: argparse.Namespace) -> None:
    # The only way out of `cancelled`: a dedicated verb, not a --force
    # flag, exactly the shape H57's `_refuse_if_done` already uses for its
    # own primary route (`reopen`, not --force). Requires a reason the
    # same way `cancel`/`reject` do, and writes a dated note, so reversing
    # Kevin's cancellation always leaves its own attributable record of
    # who did it and why, rather than a commit indistinguishable from an
    # ordinary start/todo. Kevin-only (H80 final round), the same shape as
    # `cancel`: reopening a cancelled item is Kevin's own call to make,
    # the same way cancelling it was -- an agent must not be the one to
    # undo that decision either. backlog.set_uncancelled enforces this
    # (self-declared --actor, same honest guard-not-barrier framing as
    # cancel); this command never needs its own duplicate check.
    result, committed = backlog.set_uncancelled(args.item_id, args.reason, actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_todo(args: argparse.Namespace) -> None:
    _refuse_if_done(args.item_id, "todo", args.force)
    _refuse_if_cancelled(args.item_id, "todo")
    result, committed = backlog.set_state(args.item_id, "todo", actor=args.actor)
    _print_result(args.item_id, result, committed)


def cmd_done(args: argparse.Namespace) -> None:
    _refuse_if_cancelled(args.item_id, "done")
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

    p_uncancel = sub.add_parser(
        "uncancel",
        help="Kevin-only: the only way out of cancelled, reverse it with a reason (required, leaves its own note).",
    )
    p_uncancel.add_argument("item_id")
    p_uncancel.add_argument("reason")
    add_actor(p_uncancel)
    p_uncancel.set_defaults(func=cmd_uncancel)

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


# Exit status for "that id is not on the board", distinct from 1, which
# means any other caller-facing failure including the board itself being
# unreadable (item H85).
EXIT_UNKNOWN_ITEM = 3


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        args.func(args)
    except backlog.UnknownItemError as exc:
        # Distinct from the generic failure below so callers do not have
        # to match on the message: "that id is not on the board" and
        # "the board could not be read" need different remedies, and the
        # message alone cannot tell them apart because a truncated
        # TODO.md produces the unknown-item wording too. See item H85 and
        # scripts/session.sh's recorded_branch_for_id.
        print(f"error: {exc}", file=sys.stderr)
        return EXIT_UNKNOWN_ITEM
    except backlog.BacklogError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
