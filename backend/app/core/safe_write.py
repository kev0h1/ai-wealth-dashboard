"""H117: never let an atomic write (temp file + rename) land on a device node.

`os.replace(tmp, target)` does not write to `target`, it swaps the directory
entry. If `target` is /dev/null (or any other device node, socket or fifo) the
device node is silently replaced by the regular temp file, and every later
`> /dev/null` on the host then fills a plain file. That is the 2026-10-15
UAT incident (docs/ops/INCIDENTS.md). Every temp-and-rename helper in this
repo calls `refuse_special_target` before it renames.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path


class UnsafeWriteTarget(OSError):
    """The target of an atomic write is a device node or other special file."""


def refuse_special_target(path: "str | os.PathLike[str]") -> None:
    """Raise UnsafeWriteTarget unless `path` is absent or a regular file.

    Follows symlinks, so a link that resolves to /dev/null is refused too.
    A missing target is fine (the rename creates it)."""
    p = os.fspath(path)
    try:
        st = os.stat(p)
    except FileNotFoundError:
        return
    if not stat.S_ISREG(st.st_mode) and not stat.S_ISDIR(st.st_mode):
        raise UnsafeWriteTarget(f"refusing to atomically replace {p}: it is a device, socket or fifo")
    try:
        if os.path.samefile(p, os.devnull):
            raise UnsafeWriteTarget(f"refusing to atomically replace {p}: it is {os.devnull}")
    except FileNotFoundError:
        pass


def atomic_write_text(path: "str | os.PathLike[str]", text: str) -> None:
    """Temp file in the same directory, then rename, after the guard."""
    target = Path(path)
    refuse_special_target(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_name(f"{target.name}.tmp{os.getpid()}")
    try:
        tmp.write_text(text, encoding="utf-8")
        refuse_special_target(target)
        tmp.replace(target)
    finally:
        tmp.unlink(missing_ok=True)
