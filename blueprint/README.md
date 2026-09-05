# Category Book Blueprint — `/blueprint`

An online worksheet Chris fills out with a client. Signed in, saved per project,
exported to PDF. Built to become client-facing later, the way a StoryBrand
BrandScript is: the client signs in and revisits their own blueprint.

Served by Netlify straight from this folder — `blueprint/index.html` is live at
`categorypublishing.com/blueprint`. No build step; the rest of this site is
static HTML and this stays that way.

---

## What's here

| File | Does |
|---|---|
| `index.html` | The worksheet, 30 pages, unchanged apart from four added `<script>`/`<link>` lines |
| `config.js` | **The two keys you fill in.** Nothing works until you do |
| `store.js` | Accounts, projects, saving, image upload, snapshots — everything that talks to Supabase |
| `shell.js` / `shell.css` | Sign-in, the project picker, the toolbar. Hidden in print |
| `blueprint.js` | The document's own editing, now saving to the open project instead of localStorage |
| `image-slot.js` | The drop-an-image element, now uploading to Storage instead of localStorage |
| `doc-page.js` | Pagination. Untouched |

Drop new images for the document itself into `assets/`.

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

**3. Fill in `config.js`** with the same two values SPS uses, then commit it:

```js
window.CBB_CONFIG = {
  supabaseUrl: "https://xxxxxxxx.supabase.co",
  supabasePublishableKey: "eyJhbGci..."
};
```

They go in the file rather than Netlify environment variables because this site
has no build step — nothing exists to substitute them in. That's fine: the
publishable key is designed to be seen by the browser, and SPS ships the same
key in its own bundle. RLS is what actually protects the data, which is why
step 1 matters. **Never put a service_role key here** — it bypasses every
policy and this file is public.

---

## How you'll use it

1. Go to `/blueprint`, sign in with your email and password.
2. Land on a project list — **Start a blueprint**, or pick an existing client.
3. Fill it in. Every field saves about half a second after you stop typing, so
   there's no Save button to forget. The toolbar says SAVING… then SAVED, and
   NOT SAVED in red if a write ever fails.
4. Drop images straight onto the 16 slots — they upload to the private bucket.
5. **Export PDF** freezes a snapshot, then opens your browser's print dialog.
   Choose "Save as PDF". The page's own print styles do the layout.

The client name you type when creating a blueprint fills the "Prepared for"
line on all 30 pages, and the category fills page 01.

### One thing that isn't automatic yet

Export saves the *answers* as a snapshot row and hands you a print dialog for
the PDF. It does not yet put the PDF file itself in the bucket — rendering a
PDF server-side needs a headless browser, which is a Supabase edge function
rather than anything this static page can do. `blueprint_snapshots.pdf_path`
is already there waiting for it.

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
