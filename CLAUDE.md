# AI Wealth Dashboard — Claude Instructions

## Design Context

Before any UI work, read `PRODUCT.md` (strategy: users, positioning, personality,
anti-references) and `DESIGN.md` (visual system: tokens, named rules, do's/don'ts).
North Star: "The Calm Cockpit" — verdicts lead, colour is information, red means
genuine risk only, the indigo→violet gradient belongs to Penny alone.

## Scope restriction — CRITICAL

**Only run commands within `/root/ai-wealth-dashboard/`.**
Never kill, restart, or modify any process or file outside this directory.
Do not use broad pkill patterns that could match unrelated services.

## After every code change

Restart only the relevant service(s) using systemctl:

```bash
systemctl restart wealth-api        # after backend changes
systemctl restart wealth-worker     # after app/workers changes
systemctl restart wealth-frontend   # after `npm run build` in frontend/
sleep 5 && curl -s http://localhost:8000/health
```

Frontend runs `next start` on a production build — changes require
`cd frontend && npm run build` before restarting wealth-frontend.

Check logs with:
```bash
journalctl -u wealth-api -n 50
journalctl -u wealth-worker -n 50
```

Confirm health returns 200 before telling the user the change is live.

## Git — CRITICAL

**Never commit `backend/.env`, `backend/.session_secret`, or any file containing secrets, API keys, or tokens.**
If any secrets file is already tracked, remove it with `git rm --cached <file>` before committing.
Always verify `.gitignore` covers: `backend/.env`, `backend/.session_secret`,
`backend/.webhook_secret`, `backend/.token_key`, `backend/.vapid_private_key`.
