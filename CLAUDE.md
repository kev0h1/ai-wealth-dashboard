# AI Wealth Dashboard — Claude Instructions

## Scope restriction — CRITICAL

**Only run commands within `/root/ai-wealth-dashboard/`.**
Never kill, restart, or modify any process or file outside this directory.
Do not use broad pkill patterns that could match unrelated services.

## After every code change

Restart only the relevant service(s) using systemctl:

```bash
systemctl restart wealth-api   # after changes to main.py
systemctl restart wealth-bot   # after changes to bot.py
sleep 5 && curl -s http://localhost:8000/health
```

Check logs with:
```bash
journalctl -u wealth-api -n 50
journalctl -u wealth-bot -n 50
```

Confirm health returns 200 before telling the user the change is live.
