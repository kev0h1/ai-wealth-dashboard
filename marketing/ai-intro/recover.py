"""Recover a paid take: recover.py <job_id> [name]"""
import sys
import requests
from common import BASE, OUT, headers
jid = sys.argv[1]
s = requests.get(f"{BASE}/videos/{jid}", headers=headers(), timeout=60).json()
print(s["status"], s.get("unsigned_urls"))
c = requests.get(s["unsigned_urls"][0], headers=headers(), timeout=300); c.raise_for_status()
(OUT / "takes").mkdir(parents=True, exist_ok=True)
p = OUT / "takes" / f"{sys.argv[2] if len(sys.argv) > 2 else 'recovered'}-{jid}.mp4"
p.write_bytes(c.content); print(p)
