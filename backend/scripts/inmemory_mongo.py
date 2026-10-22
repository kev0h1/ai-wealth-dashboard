"""A tiny in-memory stand-in for a Motor collection (G316).

Used by the vendor-directory tests and by the read-only before/after report,
so neither touches a real database for the collections it fakes. It supports
only the operators the vendor ladder uses: equality, $in/$nin/$ne/$lt/$lte/
$gt/$gte/$exists, $or, and the update operators $set, $inc, $setOnInsert and
$unset. An upsert whose filter does not match but whose `_id` already exists
raises DuplicateKeyError, exactly like Mongo, because the daily lookup cap and
the in-flight claim both rely on that.
"""
from __future__ import annotations

import copy
from types import SimpleNamespace

from pymongo.errors import DuplicateKeyError

_MISSING = object()


def _get(doc: dict, path: str):
    cur = doc
    for part in path.split("."):
        if not isinstance(cur, dict) or part not in cur:
            return _MISSING
        cur = cur[part]
    return cur


def _cond(value, spec) -> bool:
    if isinstance(spec, dict) and any(k.startswith("$") for k in spec):
        for op, arg in spec.items():
            if op == "$in":
                if not (value is not _MISSING and value in arg):
                    return False
            elif op == "$nin":
                if value is not _MISSING and value in arg:
                    return False
            elif op == "$ne":
                if value is not _MISSING and value == arg:
                    return False
            elif op == "$exists":
                if bool(arg) != (value is not _MISSING):
                    return False
            elif op in ("$lt", "$lte", "$gt", "$gte"):
                if value is _MISSING or value is None:
                    return False
                try:
                    ok = {"$lt": value < arg, "$lte": value <= arg,
                          "$gt": value > arg, "$gte": value >= arg}[op]
                except TypeError:
                    return False
                if not ok:
                    return False
            else:  # pragma: no cover - operator not needed by any caller
                raise NotImplementedError(op)
        return True
    if value is _MISSING:
        return spec is None
    return value == spec


def matches(doc: dict, filt: dict | None) -> bool:
    for key, spec in (filt or {}).items():
        if key == "$or":
            if not any(matches(doc, f) for f in spec):
                return False
        elif key == "$and":
            if not all(matches(doc, f) for f in spec):
                return False
        elif not _cond(_get(doc, key), spec):
            return False
    return True


def _project(doc: dict, projection: dict | None) -> dict:
    d = copy.deepcopy(doc)
    if not projection:
        return d
    wanted = {k for k, v in projection.items() if v and k != "_id"}
    if not wanted:
        return d
    out = {k: d[k] for k in wanted if k in d}
    if projection.get("_id", 1):
        out["_id"] = d.get("_id")
    return out


class _Cursor:
    def __init__(self, docs):
        self.docs = docs

    def sort(self, *_a, **_k):
        return self

    def limit(self, n):
        self.docs = self.docs[:n]
        return self

    async def to_list(self, n=None):
        return self.docs if not n else self.docs[:n]

    def __aiter__(self):
        async def gen():
            for d in self.docs:
                yield d
        return gen()


class InMemoryCollection:
    def __init__(self, name: str = "mem", docs=()):
        self.name = name
        self.docs: dict = {}
        self._auto = 0
        for d in docs:
            self.docs[d["_id"]] = copy.deepcopy(d)

    async def find_one(self, filt=None, projection=None, *a, **k):
        for d in self.docs.values():
            if matches(d, filt):
                return _project(d, projection)
        return None

    def find(self, filt=None, projection=None, *a, **k):
        return _Cursor([_project(d, projection) for d in self.docs.values() if matches(d, filt)])

    async def count_documents(self, filt=None, *a, **k):
        return sum(1 for d in self.docs.values() if matches(d, filt))

    async def insert_one(self, doc):
        doc = copy.deepcopy(doc)
        if "_id" not in doc:
            self._auto += 1
            doc["_id"] = f"auto{self._auto}"
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("duplicate _id")
        self.docs[doc["_id"]] = doc
        return SimpleNamespace(inserted_id=doc["_id"])

    @staticmethod
    def _apply(doc: dict, update: dict, inserting: bool) -> None:
        for k, v in (update.get("$set") or {}).items():
            doc[k] = copy.deepcopy(v)
        for k, v in (update.get("$inc") or {}).items():
            doc[k] = (doc.get(k) or 0) + v
        if inserting:
            for k, v in (update.get("$setOnInsert") or {}).items():
                doc[k] = copy.deepcopy(v)
        for k in (update.get("$unset") or {}):
            doc.pop(k, None)

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs.values():
            if matches(d, filt):
                before = copy.deepcopy(d)
                self._apply(d, update, inserting=False)
                return SimpleNamespace(matched_count=1, modified_count=int(before != d), upserted_id=None)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=None)
        new = {k: v for k, v in (filt or {}).items() if not k.startswith("$") and not isinstance(v, dict)}
        if "_id" not in new:
            self._auto += 1
            new["_id"] = f"auto{self._auto}"
        if new["_id"] in self.docs:
            raise DuplicateKeyError("duplicate _id")
        self._apply(new, update, inserting=True)
        self.docs[new["_id"]] = new
        return SimpleNamespace(matched_count=0, modified_count=0, upserted_id=new["_id"])

    async def update_many(self, filt, update):
        n = 0
        for d in self.docs.values():
            if matches(d, filt):
                before = copy.deepcopy(d)
                self._apply(d, update, inserting=False)
                n += int(before != d)
        return SimpleNamespace(matched_count=n, modified_count=n)

    async def delete_one(self, filt):
        for k, d in list(self.docs.items()):
            if matches(d, filt):
                del self.docs[k]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, filt):
        keys = [k for k, d in self.docs.items() if matches(d, filt)]
        for k in keys:
            del self.docs[k]
        return SimpleNamespace(deleted_count=len(keys))

    async def distinct(self, field, filt=None):
        seen = []
        for d in self.docs.values():
            v = _get(d, field)
            if matches(d, filt) and v is not _MISSING and v not in seen:
                seen.append(v)
        return seen

    async def create_index(self, *_a, **_k):
        return "mem_index"

    async def insert_many(self, docs):
        for d in docs:
            await self.insert_one(d)
