"""Mongo predicates shared by Penny proposal creation, execution and revocation.

Generation zero includes legacy documents whose field is absent. Revocation
increments this epoch atomically with clearing consent; granting consent never
resets it. Keep this separate from the UI preferences version, which changes
for unrelated settings too.
"""


def consent_generation_query(generation: int) -> dict:
    if generation == 0:
        return {"$or": [
            {"penny_consent_generation": 0},
            {"penny_consent_generation": {"$exists": False}},
        ]}
    return {"penny_consent_generation": generation}
