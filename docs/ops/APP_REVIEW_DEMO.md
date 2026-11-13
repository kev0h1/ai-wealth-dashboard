# Apple App Review demo account (C43)

Sign-in is Google or Apple only, so App Review gets one synthetic user,
`appreview@auriqltd.co.uk`, with a password. It is off by default and has no
route to any bank provider.

## What it is

- `POST /auth/demo/login` (email or username, password) mints the normal session
  token. `GET /auth/demo/enabled` returns only a boolean. With the flag off or
  the hash empty, login is 404 and `enabled` is false.
- One generic failure message: "Those details didn't work." Attempts are logged
  as counts only. Limits: 5 per minute per IP, 60 per hour overall.
- The password exists only as a scrypt hash in `DEMO_PASSWORD_HASH`.
- The demo user gets a 403 on bank connect and consent, sync and refresh,
  account deletion, Penny export, Apple identity link and unlink, and every
  billing route (list in `backend/app/core/demo.py`). Sync, reconcile and
  consent-watch skip it. Google and Apple sign-in can never resolve to it.
- Penny is metered on the manual Plus grant: 300 messages a month, about 3p a
  message, so a 10 to 20 message review costs roughly 30p to 70p and the
  monthly worst case is about 10 pounds.

## Kevin's steps

1. Generate the hash (the password is typed, never stored or echoed):
   `cd backend && .venv/bin/python scripts/make_demo_password_hash.py`
2. Set `DEMO_LOGIN_ENABLED=true` and `DEMO_PASSWORD_HASH=<the hash>` on both
   Railway services (API and worker).
3. Release with `scripts/release.py` (docs/ops/RELEASE.md).
4. Seed production (wipes and rebuilds only the demo user's documents):
   `MONGO_DB=<prod name> .venv/bin/python scripts/seed_demo_account.py --confirm --db-name <prod name>`
   It prints the database name and counts only.
5. In App Store Connect, App Review Information, tick "Sign-in required" and
   enter `appreview@auriqltd.co.uk` and the password. In the notes say: "Tap
   Demo sign-in under the Google and Apple buttons. The account holds
   synthetic data only and cannot connect a bank."
6. Re-seed before each review submission so dates stay current.
7. Optionally remove `DEMO_LOGIN_ENABLED` afterwards and restart.

Never run the seeder against a database you are not sure of: it only deletes
documents for the demo email, but it does delete them.
