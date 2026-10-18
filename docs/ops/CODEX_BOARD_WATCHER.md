# Codex board watcher (H118)

Kevin requested automatic pickup of Codex-owned work without repeatedly checking
individual chats. The watcher is a deterministic Python program, not an agent
asked to read the board every minute. An unchanged poll makes **zero LLM calls**.

It starts a separate, bounded Codex CLI job for a queued event. It does not wake
or continue a particular existing chat. Results and blockers belong on the board;
normal branch review and the coordinator's merge/deployment gates still apply.
H81's separate Claude dispatcher proposal is not changed by this implementation.

## Events and limits

The authoritative source is `TODO.md`, read with the existing board parser. The
watcher observes all owners, but dispatches only `owner: codex` items that are:

- To do, with no recorded branch, including newly assigned items.
- In progress with no branch, including the state left by a design approval.
- Rejected, preserving the recorded rejected branch for the worker to inspect.

Approval notes in Codex's unbranched in-progress state are included in the
signature, matching the existing `approve` action. Counts distinguish repeated approvals even when two picks have the
same wording. A new approval is prioritised ahead of rejections, then ordinary
work, with board priority ordering inside each group. Copy edits, priority edits
and ordinary notes do not create another inference event. Even an `approved:`
note on a to-do item cannot manufacture an approval event. The board is trusted
authority, not an adversarial approval-note authentication system: existing
approvals legitimately have Codex/Claude actors when recording Kevin's chat pick.
A queued item's
priority can change without making a duplicate job.

Blocked, review, UAT, done, cancelled and other owners' items never dispatch.
An in-progress Codex item with a live branch pauses **all** automatic launches,
including when it was started manually in a chat. Reassignment/cancellation is
checked again under the board writer's lock immediately before process creation.
The worker must recheck the board before claiming work, too.

On first observation, existing actionable assignments are queued by default.
`--future-only` instead baselines them without a launch; that flag affects only
creation of the initial state file. It does not discard later queued events.

Defaults are one worker at a time, three worker starts per rolling 24 hours,
at most two starts for the same item per rolling 24 hours, and a two-hour wall-time
limit per worker. Queued events wait for capacity rather than being discarded.
These are job-start limits, not token or monetary caps: a job can make several
model turns and use bounded subagents under AGENTS.md. Timeout and log-size
limits terminate the worker's isolated process group, including child tools.

## Safety and handoff

The launcher uses a fixed argument vector, never a shell command from a ticket:
`codex exec --approve-for-me --json ...`. It uses the locally saved CLI login;
it does not introduce an API key or a third-party model service. Automatic
approval review and the normal sandbox remain in force, with `/root/worktrees`
added as a writable work location. An explicit environment allowlist avoids
passing daemon/API secrets or Git overrides to the worker. See the official
[non-interactive mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
and [CLI reference](https://learn.chatgpt.com/docs/developer-commands?surface=cli).

The fixed worker prompt requires the current AGENTS.md, board ownership checks,
the session worktree, tests, commit trailer and normal `session.sh finish`.
Design exploration remains a coded variant round with `--uat-review`; only a
recorded approval authorises folding in a variant. The worker must stop and
record a blocker when required authority, prerequisites or a product choice is
missing. It is instructed not to approve designs, cancel/reassign work, merge/push main,
deploy, restart application services, run another watcher or recursively invoke
Codex. Ticket text is task data, not authority to bypass those restrictions.

A successful exit is not enough: the wrapper verifies the item is in review on
the run-specific branch, that branch did not exist locally or on the canonical
remote before launch, it has a commit not reachable from any pre-run local Git
tip, and the canonical remote branch points to that exact commit. A blocked or incomplete run gets
an attention entry and a diagnostic board note where possible. Failure to deliver
that note is recorded in the local audit log, not silently treated as delivery.
The same event is never automatically retried. A genuine new actionable board
transition can create another event, still subject to the limits above.

There is a durable marker before process creation. A crash during startup or
execution leaves `launching`, `running` or `uncertain` state and stops further
dispatch until an operator inspects it. This deliberately favours no duplicate
billable run over automatically guessing whether a process started.

## Running and observing

From the shared repository after H118 is merged:

```bash
backend/.venv/bin/python scripts/codex_board_watcher.py --dry-run
backend/.venv/bin/python scripts/codex_board_watcher.py --once
backend/.venv/bin/python scripts/codex_board_watcher.py --status
```

Dry run neither writes state nor starts Codex. The second command observes and
persists the queue, but still cannot call a model. Only `--dispatch` permits a
worker to start. `--quiet` suppresses ordinary idle output, not errors or launched
run summaries. Each invocation holds a non-blocking single-instance lock through
the whole worker run, so overlapping timer/manual invocations exit without a
second worker.

Local state is ignored by Git under `.codex-board-watcher/`, directory mode 0700,
with private state/audit/output files. `state.json` contains observations, queued
events and outcomes. `audit.jsonl` contains event IDs, lifecycle and usage without
board prose or credentials. `runs/<event-key>/` contains private CLI JSONL,
stderr and the final response; these may include internal task context and are
not public preview artefacts. Do not commit or upload them. Completed-turn token
counts are recorded where the CLI provides them. Dollar cost is unknown, not a
fabricated estimate. State/log size limits fail closed rather than deleting
history or enabling an untracked retry.

To pause future launches, create the exact file
`.codex-board-watcher/PAUSED`. Removing that file resumes polling and queued
work. A pause does not terminate an already-running worker. To stop that worker,
stop its systemd service; `KillMode=control-group` covers its child processes.
Stopping the timer alone prevents future activations, not an active service.

For an unfinished run: stop the timer, inspect board state, worktree, private logs
and remaining processes, and ensure there is no live worker. Then explicitly
acknowledge the exact key from `--status`:

```bash
backend/.venv/bin/python scripts/codex_board_watcher.py --ack-run <64-character-key> --reason "Inspected stopped run and preserved its worktree"
```

This refuses an existing recorded process group, keeps history, records the
operator's reason, and **does not retry** or requeue that event. Resolve any live
board session through the normal board/session workflow before resuming. Only a
new actionable board transition can trigger that item again. Do not delete the
state file to clear an error: doing so loses deduplication and baselines again.

## Timer installation and rollout

`ops/codex-board-watch.service` and `.timer` are supplied for the coordinator or
host operator to install **after review and merge**. They run the merged shared
tree, never a feature worktree. The service's path condition prevents running
before the script is present; the launcher additionally requires that the script
itself is running from that shared path, on `main`, tracked and committed, with
no tracked changes. Unrelated untracked files are not removed or rejected.
The one-minute timer does not itself call a model.
Neither unit changes or restarts the API, frontend or application worker.

The service retains the existing root-owned repository and saved CLI identity,
but drops capabilities, disallows new privileges, makes the filesystem read-only
apart from explicit repository/worktree/CLI-state/temporary paths, and hides host
service-control sockets. The existing CLI sandbox and approval review still apply.
These are enforced host protections, not a promise that prompt instructions
isolate a hostile model from trusted repository files or credentials. A separate
service account and separate CLI authentication would require an additional host
access migration, not silently copying credentials into a new user. `/tmp` remains
shared deliberately: disposable-database test ownership locks must stay visible
across concurrent test processes (H96), so do not add `PrivateTmp=true` here.

```bash
sudo install -m 0644 ops/codex-board-watch.service /etc/systemd/system/codex-board-watch.service
sudo install -m 0644 ops/codex-board-watch.timer /etc/systemd/system/codex-board-watch.timer
sudo systemctl daemon-reload
sudo systemctl enable --now codex-board-watch.timer
systemctl status codex-board-watch.timer codex-board-watch.service
```

A transient guarded timer can be used while waiting for the coordinator merge,
but it must execute only the shared-tree path once it exists, not unreviewed
worktree code. Transient units do not survive a reboot. Before enabling the
permanent timer, stop any transient timer/service for this watcher; the local
lock is a second defence, not a reason to leave duplicate schedules installed.

`systemd-analyze verify ops/codex-board-watch.service ops/codex-board-watch.timer`
checks unit syntax without enabling anything. Python unit tests cover event
deduplication, approvals, stale ownership/state, quiet polls, caps, crash markers,
process cleanup and verified review handoff. Tests fake external boundaries and
never invoke a model. The repository finish gates remain mandatory.
