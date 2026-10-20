"""Mongo-shaped fakes shared by Penny proposal tests.

They intentionally model only the query and update operators used by the
proposal claim, cancellation and consent-generation paths.  Reads return
snapshots so a test cannot accidentally hide a compare-and-set race by
mutating the collection's stored document through a returned reference.
"""
from copy import deepcopy


class FakeCursor:
    def __init__(self, docs):
        self._docs = deepcopy(docs)

    def __aiter__(self):
        async def gen():
            for doc in self._docs:
                yield deepcopy(doc)
        return gen()

    async def to_list(self, _length=None):
        return deepcopy(self._docs)


class FakeCollection:
    def __init__(self, docs=None):
        self.docs = deepcopy(list(docs or []))

    @classmethod
    def _match(cls, doc, query):
        for key, expected in (query or {}).items():
            if key == "$or":
                if not any(cls._match(doc, branch) for branch in expected):
                    return False
                continue
            actual = doc.get(key)
            if isinstance(expected, dict) and any(op.startswith("$") for op in expected):
                if "$exists" in expected and (key in doc) != bool(expected["$exists"]):
                    return False
                if "$gte" in expected and (key not in doc or actual < expected["$gte"]):
                    return False
                if "$lt" in expected and (key not in doc or actual >= expected["$lt"]):
                    return False
                if "$lte" in expected and (key not in doc or actual > expected["$lte"]):
                    return False
                if "$in" in expected and actual not in expected["$in"]:
                    return False
                if "$ne" in expected and actual == expected["$ne"]:
                    return False
                continue
            if actual != expected:
                return False
        return True

    @staticmethod
    def _apply(doc, update):
        doc.update(deepcopy(update.get("$set") or {}))
        for key, amount in (update.get("$inc") or {}).items():
            doc[key] = doc.get(key, 0) + amount
        for key in (update.get("$unset") or {}):
            doc.pop(key, None)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if self._match(doc, query):
                return deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        return FakeCursor([doc for doc in self.docs if self._match(doc, query)])

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if self._match(doc, query))

    async def insert_one(self, doc):
        self.docs.append(deepcopy(doc))

    async def update_one(self, filt, update, upsert=False):
        for doc in self.docs:
            if self._match(doc, filt):
                self._apply(doc, update)
                return _UpdateResult(1)
        if upsert:
            new_doc = {
                key: deepcopy(value) for key, value in filt.items()
                if not key.startswith("$")
                and not (isinstance(value, dict) and any(op.startswith("$") for op in value))
            }
            self._apply(new_doc, update)
            self.docs.append(new_doc)
            return _UpdateResult(1)
        return _UpdateResult(0)

    async def update_many(self, filt, update):
        matched = 0
        for doc in self.docs:
            if self._match(doc, filt):
                self._apply(doc, update)
                matched += 1
        return _UpdateResult(matched)

    async def find_one_and_update(self, filt, update, return_document=None, upsert=False):
        for doc in self.docs:
            if self._match(doc, filt):
                before = deepcopy(doc)
                self._apply(doc, update)
                # pymongo's AFTER is truthy; accepting its enum keeps the
                # fake independent from pymongo in these focused tests.
                return deepcopy(doc if return_document else before)
        if upsert:
            await self.update_one(filt, update, upsert=True)
            return await self.find_one(filt)
        return None

    async def replace_one(self, filt, doc, upsert=False):
        for index, stored in enumerate(self.docs):
            if self._match(stored, filt):
                self.docs[index] = deepcopy(doc)
                return _UpdateResult(1)
        if upsert:
            self.docs.append(deepcopy(doc))
            return _UpdateResult(1)
        return _UpdateResult(0)

    async def delete_one(self, filt):
        for index, doc in enumerate(self.docs):
            if self._match(doc, filt):
                self.docs.pop(index)
                return _DeleteResult(1)
        return _DeleteResult(0)


class _UpdateResult:
    def __init__(self, count):
        self.matched_count = count
        self.modified_count = count


class _DeleteResult:
    def __init__(self, count):
        self.deleted_count = count
