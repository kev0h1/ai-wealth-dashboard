"""Build the model history EXACTLY as production does, so truncation failures reproduce.

Client (frontend/components/PennyConversation.tsx `buildHistory`): the last HISTORY_CAP (6)
messages; an assistant turn contributes its `reply` (or `headline`), a proposal card
contributes `I proposed: <summary> (<status>).`.
Server (app/routers/can_i.py): the last MODEL_HISTORY_TURNS (6) entries, each cut to its
FIRST 300 characters.
"""
HISTORY_CAP = 6
MODEL_HISTORY_TURNS = 6
CHAR_CAP = 300


def client_history(msgs: list[dict]) -> list[dict]:
    out = []
    for m in msgs[-HISTORY_CAP:]:
        if m["role"] == "user":
            out.append({"role": "user", "content": m["content"]})
        elif m.get("kind") == "proposal":
            out.append({"role": "assistant", "content": f"I proposed: {m['summary']} ({m.get('status', 'pending')})."})
        else:
            out.append({"role": "assistant", "content": m["content"]})
    return out


def server_history(history: list[dict]) -> list[dict]:
    out = []
    for e in history[-MODEL_HISTORY_TURNS:]:
        if e.get("role") in ("user", "assistant") and isinstance(e.get("content"), str):
            out.append({"role": e["role"], "content": e["content"][:CHAR_CAP]})
    return out


def production_history(msgs: list[dict]) -> list[dict]:
    """What run_penny_agent receives as `history` for the next question."""
    return server_history(client_history(msgs))
