"""Episodic memory extraction service."""
import asyncio
import json
from datetime import datetime
import httpx

from app.core.config import OPENROUTER_API_KEY
from app.db.collections import episodic_memory_col


async def extract_episodic_memory(uid: str, conversation: list) -> None:
    if not OPENROUTER_API_KEY or len(conversation) < 2:
        return
    try:
        extraction_prompt = (
            "Review this conversation and extract any personal facts about the user that would be "
            "useful to remember for future financial advice conversations. Focus on: lifestyle preferences, "
            "goals, hobbies, family situation, specific financial goals or concerns they've mentioned, "
            "constraints, or any personal context.\n\n"
            "Output ONLY a JSON array of short fact strings (max 10 facts). If nothing notable, output [].\n"
            'Example: ["Goes to the gym regularly", "Has a holiday planned for summer"]\n\n'
            "Conversation to analyze:\n"
            + "\n".join(f"{m['role'].upper()}: {m['content']}" for m in conversation[-10:])
        )
        async with httpx.AsyncClient(timeout=20) as client:
            r = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={"Authorization": f"Bearer {OPENROUTER_API_KEY}",
                         "HTTP-Referer": "https://wealth.auriqltd.co.uk"},
                json={"model": "anthropic/claude-haiku-4-5", "max_tokens": 200,
                      "messages": [{"role": "user", "content": extraction_prompt}]},
            )
        if r.status_code != 200:
            return
        content = r.json()["choices"][0]["message"]["content"].strip()
        start = content.find("[")
        end   = content.rfind("]") + 1
        if start == -1 or end == 0:
            return
        new_facts = json.loads(content[start:end])
        if not new_facts or not isinstance(new_facts, list):
            return
        mem_doc  = await episodic_memory_col.find_one({"_id": uid})
        existing = mem_doc.get("facts", []) if mem_doc else []
        combined = list(existing)
        for f in new_facts:
            if isinstance(f, str) and f not in combined:
                combined.append(f)
        combined = combined[-50:]
        await episodic_memory_col.update_one(
            {"_id": uid},
            {"$set": {"facts": combined, "updated_at": datetime.now(), "user_id": uid}},
            upsert=True,
        )
    except Exception:
        pass
