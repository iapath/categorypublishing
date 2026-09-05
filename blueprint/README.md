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
| `supabase/functions/blueprint-pdf/` | The edge function that renders and stores the PDF |

Drop new images for the document itself into `assets/`.

## Setup, in order

**1. Run the SQL.** Supabase dashboard → SQL Editor → paste
`sql/118_category_book_blueprint.sql` → Run. It's idempotent, so re-running is
safe. It creates:

- `blueprint_projects` — one row per client blueprint, all answers in `fields`
- `blueprint_snapshots` — a frozen copy each time you export
- `blueprint_shares` — invite a client by email (for later)
- `blueprint-assets` — a **private** storage bucket for the 16 image slots

It reuses Smart Publishing Studio's accounts and its `current_app_user_id()` /
`is_app_admin()` helpers, so run SPS migration `060` first if it hasn't been.

**1b. Run `sql/119_blueprint_exports_bucket.sql`** the same way. It adds the
private `blueprint-exports` bucket that finished PDFs go into.

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

---

## The PDF export

**Export PDF** freezes a snapshot, asks the `blueprint-pdf` edge function for a
rendered file, stores it in `blueprint-exports`, and downloads it. Once a
blueprint has been exported once, a **Download last PDF** button appears, which
hands over the stored copy without re-rendering.

Until a renderer is configured the button still works — it offers the browser's
own print-to-PDF instead, which produces the same pages, just without filing a
copy. Your answers snapshot either way.

### Why it needs an outside service

This document only lays out correctly in a real browser engine. Supabase edge
functions run Deno and cannot run a browser, and the client-side renderers
(html2canvas and friends) get it visibly wrong — measured here at 15 seconds
for a single page, with the title block collapsing. So the function does the
parts that must be trusted (checking who is asking, assembling the filled-in
page, storing the result) and hands the rendering itself to a headless browser
service, exactly the way `mockup-gen` calls MediaModifier.

It fetches the live `/blueprint` page and injects the answers, so there is one
copy of the design: edit the worksheet and the PDF follows.

### Deploying it

```bash
cd blueprint
supabase functions deploy blueprint-pdf
supabase secrets set PDF_RENDER_PROVIDER=browserless PDF_RENDER_KEY=xxxxxxxx
```

Three providers are supported; pick one and set the two secrets:

| `PDF_RENDER_PROVIDER` | Service | Notes |
|---|---|---|
| `browserless` (default) | browserless.io | Real Chrome, free tier to start. Set `PDF_RENDER_URL` if self-hosting |
| `pdfshift` | pdfshift.io | Simple per-document pricing |
| `docraptor` | docraptor.com | PrinceXML rather than Chrome, so check a proof page first |

Optional: `BLUEPRINT_URL` if the worksheet ever moves off
`https://categorypublishing.com/blueprint/`.

The function only ever reads a blueprint **as the person asking** — the service
key is used afterwards, for storing the file. So it cannot hand someone a PDF
of a blueprint they could not already open.

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
