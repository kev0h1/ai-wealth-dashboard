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
6. Re-seed before each review submission so dates stay current. The seed is
   deterministic (no randomness), so any day of the pay period gives the same
   story: Left to spend about £400 to £520 and "Looks on track", with the Bills
   Account short before payday and one suggested move from the Everyday
   Current covering it. (`--today YYYY-MM-DD` exists only as a test aid, used
   by tests/test_demo_seeder.py to sweep two pay periods. Never pass it when
   seeding for real.)
7. Optionally remove `DEMO_LOGIN_ENABLED` afterwards and restart.

Never run the seeder against a database you are not sure of: it only deletes
documents for the demo email, but it does delete them.

## Paste-ready reviewer instructions (C47)

Where the link is: on the sign-in screen, inside the white card, below the
Google and Apple buttons, there is a small underlined link labelled
"Demo sign-in". Tapping it opens a form with "Email" and "Password" fields
and a "Sign in" button. On native production builds the link always shows
(C45). The server is the gate, so it only works once the flag is on.

Replace the placeholders in the credentials fields only, never in this repo.

### (a) App Store Connect, App Review Information

- Sign-in required: tick.
- User name: `<demo username>` (the demo email, `appreview@auriqltd.co.uk`)
- Password: `<demo password>`

Notes field (limit 4,000 bytes per Apple's App Review Information reference;
this block is 695 characters):

```text
Sorted normally signs in with Google or Apple. For review, please use the demo sign-in instead. Do not use Google or Apple sign-in.

1. On the sign-in screen, find the small underlined link "Demo sign-in". It sits below the Google and Apple buttons, in the same white card.
2. Tap "Demo sign-in". Two fields open: Email and Password.
3. Enter the username and password from the Sign-in required fields above, then tap "Sign in".

You will land on the Home screen straight away. No device linking, verification code, bank connection or payment is needed.

The account holds sample data only. Bank linking and payments are switched off for it, so those screens will not complete. This is intended.
```

### (b) Play Console, App content, App access, "All or some functionality is restricted"

- Instruction name: `Demo sign-in`
- Username: `<demo username>`
- Password: `<demo password>`

"Any other information required to access your app" (limit about 500
characters; I could not confirm the exact figure from Google's public help,
so check the counter in the form; this block is 361 characters):

```text
Do not use Google or Apple sign-in. On the sign-in screen, tap the underlined link "Demo sign-in", below the Google and Apple buttons. Enter the username and password given here, then tap "Sign in". No device linking, verification code, bank connection or payment is needed. The account holds sample data only. Bank linking and payments are switched off for it.
```

### Checklist before submitting

- [ ] Release done (`scripts/release.py`, docs/ops/RELEASE.md).
- [ ] `DEMO_LOGIN_ENABLED` and `DEMO_PASSWORD_HASH` set on Railway (API and worker).
- [ ] Production demo seeded with `seed_demo_account.py --confirm --db-name <prod name>`.
- [ ] New store build pointing at the production API.
- [ ] Credentials pasted into both store forms.
