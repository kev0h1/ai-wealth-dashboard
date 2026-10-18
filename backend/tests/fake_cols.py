"""Shared in-memory stand-in for a Motor collection (C21 tests).

No mongomock is available here, so DB-touching code is exercised against
this small fake, the same approach tests/test_billing.py takes. It supports
exactly what the billing code uses: equality, $in (None matches a missing
field), $ne and $exists matching; insert_one with optional unique keys
(raises DuplicateKeyError like Mongo); update_one with $set, $unset,
$setOnInsert and upsert; find() as an async iterable with to_list().
"""
from pymongo.errors import DuplicateKeyError


class FakeCursor:
    def __init__(self, docs):
        self._docs = docs

    def __aiter__(self):
        async def gen():
            for d in self._docs:
                yield d
        return gen()

    async def to_list(self, _length=None):
        return list(self._docs)


class FakeCol:
    def __init__(self, docs=None, unique=()):
        self.docs: list[dict] = [dict(d) for d in (docs or [])]
        self.unique = tuple(unique)  # each entry: a tuple of field names
        self._n = 1

    @staticmethod
    def match(d, q):
        for key, value in (q or {}).items():
            if isinstance(value, dict) and any(k.startswith("$") for k in value):
                if "$in" in value and d.get(key) not in value["$in"]:
                    return False
                if "$ne" in value and d.get(key) == value["$ne"]:
                    return False
                if "$exists" in value and (key in d) is not bool(value["$exists"]):
                    return False
                continue
            if d.get(key) != value:
                return False
        return True

    def _check_unique(self, doc, ignore=None):
        for fields in self.unique:
            for other in self.docs:
                if other is ignore:
                    continue
                if all(other.get(f) == doc.get(f) for f in fields):
                    raise DuplicateKeyError(f"duplicate {fields}")

    async def find_one(self, query=None, projection=None):
        for d in self.docs:
            if self.match(d, query):
                return d
        return None

    def find(self, query=None, projection=None):
        return FakeCursor([d for d in self.docs if self.match(d, query)])

    async def count_documents(self, query=None):
        return len([d for d in self.docs if self.match(d, query)])

    async def insert_one(self, doc):
        doc = dict(doc)
        doc.setdefault("_id", f"id{self._n}")
        self._n += 1
        self._check_unique(doc)
        self.docs.append(doc)

        class _R:
            inserted_id = doc["_id"]
        return _R()

    async def update_one(self, filt, update, upsert=False):
        for d in self.docs:
            if self.match(d, filt):
                trial = dict(d)
                trial.update(update.get("$set") or {})
                self._check_unique(trial, ignore=d)
                d.update(update.get("$set") or {})
                for k in (update.get("$unset") or {}):
                    d.pop(k, None)

                class _R:
                    matched_count = 1
                    modified_count = 1
                return _R()
        if upsert:
            new = {k: v for k, v in filt.items() if not (isinstance(v, dict) and any(x.startswith("$") for x in v))}
            new.update(update.get("$set") or {})
            new.update(update.get("$setOnInsert") or {})
            new.setdefault("_id", f"id{self._n}")
            self._n += 1
            self._check_unique(new)
            self.docs.append(new)

        class _R0:
            matched_count = 0
            modified_count = 0
        return _R0()
