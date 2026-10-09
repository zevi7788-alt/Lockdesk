# LockDesk

Locksmith dispatch for the office and the technicians in the field.

**Live app:** https://zevi7788-alt.github.io/Lockdesk/
**Owner:** Zevi Neiman (zevineiman@aol.com)

---

## The pieces (and who runs them)

| What | Where it lives | What it does | If it's down |
| --- | --- | --- | --- |
| The app (screens) | GitHub Pages, this repo | Shows LockDesk in the browser | githubstatus.com |
| Database and logins | Supabase project `apcgtuyddityzolkrsyy` (East US) | Stores every customer, job, invoice, payment, account | status.supabase.com |
| Email (later) | Resend | Sends invoices, receipts, owner alerts | resend-status.com |

Your data lives **only in Supabase**. This repo holds the app's code, never customer data.

## Accounts to protect

Turn on two-factor login for both. Whoever controls these controls LockDesk.

* **Supabase** (supabase.com, signed in as Zevi)
* **GitHub** (github.com, user `zevi7788-alt`)

## Keeping data safe

* Every save goes straight to the Supabase database and stays there.
* **Weekly:** open LockDesk, go to **System check**, tap **Download backup**, and save the Excel file somewhere safe (email it to yourself, Google Drive, iCloud). The dashboard reminds you.
* **Recommended once real customers are in:** Supabase Pro ($25/month) adds automatic daily backups.
* **Free plan warning:** if nobody opens LockDesk for 7 days, Supabase pauses the database. Nothing is lost. Open supabase.com and click **Restore project**.

## When something goes wrong

1. Open LockDesk, go to **System check**, tap **Copy problem report**.
2. Paste it into a chat with Claude (or send it to whoever maintains the app) with what happened.
3. Quick checks first:
   * App won't load at all: check githubstatus.com, try another phone or Wi-Fi.
   * App loads but says it can't reach the database: check status.supabase.com, or the project may be paused (see above).
   * Someone can't sign in: check **Team** (are they approved? removed?). Use **Password** to give them a new temporary password.

## Security model

* Every new account waits for the owner's approval and can see nothing until approved.
* Only the owner approves, removes, and resets passwords.
* Technicians only see jobs assigned to them, and can only change job status, final amount, and their notes.
* No card numbers are stored. Payments are recorded with method and reference only.
* Database rules (Row Level Security) enforce all of this on the server, not just in the app.

## For a developer

* `index.html` is the whole built app (React, bundled into one file). `source/` is the code it's built from.
* Build: `cd source && ./make.sh` (needs Bun and Python 3), then copy `dist/site/*` to the repo root.
* Database changes: `setup.sql` (generated from `source/sql/*.sql`). Every script is safe to run more than once. Run in Supabase **SQL Editor**.
* The app discovers database column names at runtime (`source/src/db.ts`, `SPEC`), so it tolerates naming differences in the original schema.
* Customer invoice links: `#/i/<token>`, served by the `ld_public_invoice` database function.
