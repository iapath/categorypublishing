# Category Book Blueprint — `/blueprint`

An online worksheet Chris fills out with a client. Signed in, saved per project,
exported to PDF. Built to become client-facing later, the way a StoryBrand
BrandScript is: the client signs in and revisits their own blueprint.

Served by Netlify straight from this folder — `blueprint/index.html` is live at
`categorypublishing.com/blueprint`. No build step; the rest of this site is
static HTML and this stays that way.

---

## Drop your files here

| Put | Where | Notes |
|---|---|---|
| The worksheet HTML | `blueprint/index.html` | Rename `categorybookblueprint.html` to `index.html`. Don't edit it first — the wiring is added on top of it. |
| Any images it needs | `blueprint/assets/` | Logos, diagrams, sample covers. Reference as `assets/<name>`. |
| Fonts, if self-hosted | `blueprint/assets/fonts/` | Currently it pulls Montserrat + Bebas from Google Fonts, which is fine. |

Nothing else needs to move. The SQL in `sql/` is run once by hand, not deployed.

---

## Setup, in order

**1. Run the SQL.** Supabase dashboard → SQL Editor → paste
`sql/118_category_book_blueprint.sql` → Run. It's idempotent, so re-running is
safe. It creates:

- `blueprint_projects` — one row per client blueprint, all answers in `fields`
- `blueprint_snapshots` — a frozen copy each time you export
- `blueprint_shares` — invite a client by email (for later)
- `blueprint-assets` — a **private** storage bucket for the 16 image slots and exported PDFs

It reuses Smart Publishing Studio's accounts and its `current_app_user_id()` /
`is_app_admin()` helpers, so run SPS migration `060` first if it hasn't been.

**2. Keep the migration ledger straight.** Copy that same file into the
`smartpublishingstudio` repo at `supabase/118_category_book_blueprint.sql` so
the numbering stays continuous. It's the same database.

**3. Set the two keys in Netlify** (Site settings → Environment variables), same
values SPS uses:

```
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

These are the publishable/anon keys — safe in the browser. RLS is what protects
the data, which is why step 1 matters. **Never put a service-role key here.**

---

## How you'll use it

1. Go to `/blueprint`, sign in with your email and password.
2. Land on a project list — **New blueprint**, or pick an existing client.
3. Fill it in. Every field saves as you type; no Save button to forget.
4. **Export** writes a PDF, stores it, and freezes a snapshot you can return to.

### About the password

Sign-in is your existing Smart Publishing Studio account, `chris@iapath.com` —
the same email and password. If you'd rather it be separate, sign up once at
`/blueprint` with a different email and that becomes the account.

It is deliberately **not** a single shared site password. A shared password
can't tell you and a client apart, and the whole point of `blueprint_shares` is
that one day a client signs in and sees their blueprint and nothing else. Real
accounts are the only thing that gets there.

---

## How the worksheet maps to the database

The HTML already carries its own field keys, so the page and the row stay in
sync without a schema change every time a question gets reworded:

| In the HTML | In the row | Count |
|---|---|---|
| `data-k="claim_enemy"` | `fields->>'claim_enemy'` | 359 unique |
| `data-chk="…"` | `checks->>'…'` | 27 |
| `<image-slot id="cbb-kindle">` | `images->>'cbb-kindle'` → storage path | 16 |

Storage paths are `<project_id>/slots/<slot-id>.<ext>` and
`<project_id>/exports/<timestamp>.pdf`. The leading folder is the project id —
that's what the bucket policies check, so an object can't be read by anyone who
can't already read the project.
