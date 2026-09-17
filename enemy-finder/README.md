# The Enemy Finder

The free tool at **categorypublishing.com/enemy-finder**.

An author fills in three blanks, then answers one question at a time. After
every answer, two lists of names are rewritten in front of them: names for the
conventional wisdom they're fighting, and names for what happens to their
reader if the problem never gets solved. Weak names drop off, sharper ones
arrive, and **anything the author stars is locked and never leaves**.

At the end they get the full ten a side, pick their favourites, and each pick
gets a straight verdict plus a sharper alternative they can swap in.

## How it's put together

```
index.html                              The page: marketing copy + the tool
css/enemy-finder.css                    Brand tokens + the board
js/enemy-config.js                      ← the two values you fill in
js/enemy-finder.js                      The flow, the board, the star
sql/121_enemy_finder.sql                One table, just for rate limiting
supabase/functions/enemy-finder/        The prompt and the engine call
```

The prompt lives in the edge function, never in the browser. The page only
ever sends the author's own words back. Their answers and starred names stay
in their own browser (localStorage), so a refresh picks up where they left off
and nothing personal is stored on our side.

It runs on the same Supabase project as the Shelf Finder and Flywheel Builder,
and uses the same engine key those already use.

---

## Setting it up — click by click

You only have to do this once.

### 1. Add the table (2 minutes)

1. Go to **supabase.com** and open your project (the same one the Shelf Finder
   uses).
2. In the left sidebar click **SQL Editor**.
3. Click **New query**.
4. Open the file `enemy-finder/sql/121_enemy_finder.sql` from this repo, select
   everything, and copy it.
5. Paste it into the big box in Supabase.
6. Click **Run** (bottom right).
7. You should see **Success. No rows returned.** That's what you want.

Running this twice is harmless, so if you're unsure whether you did it, just
run it again.

### 2. Add the function (3 minutes)

1. Still in Supabase, click **Edge Functions** in the left sidebar.
2. Click **Deploy a new function**, then **Via Editor**.
3. In the name box type exactly: `enemy-finder`
   (lowercase, with the hyphen — the name has to match or the page can't find it)
4. Open `enemy-finder/supabase/functions/enemy-finder/index.ts` from this repo,
   select everything, and copy it.
5. Delete whatever sample code is in the Supabase editor and paste yours in.
6. Click **Deploy function**.
7. Wait for the green tick.

### 3. Check the engine key is there (1 minute)

1. Still under **Edge Functions**, click **Secrets** (or **Manage secrets**).
2. Look for `ANTHROPIC_API_KEY` in the list.
3. **If it's already there, you're done with this step.** The Shelf Finder uses
   the same one.
4. If it isn't, click **Add new secret**, name it exactly `ANTHROPIC_API_KEY`,
   paste the key in the value box, and click **Save**.

### 4. Point the page at it (2 minutes)

1. In Supabase, click the **gear icon** (Project Settings) at the bottom left,
   then **API**.
2. You'll see two things you need:
   - **Project URL** — looks like `https://abcdefgh.supabase.co`
   - **anon public** key — a very long string starting with `eyJ`
3. Open `enemy-finder/js/enemy-config.js` in this repo.
4. Paste the Project URL between the quotes after `supabaseUrl:`
5. Paste the anon public key between the quotes after `supabaseAnonKey:`
6. Save the file.

It should end up looking like this:

```js
window.ENEMY_CONFIG = {
  supabaseUrl: "https://abcdefgh.supabase.co",
  supabaseAnonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  coachingUrl: "/coaching"
};
```

> The anon key is **meant** to sit in the browser — that's what it's for. Just
> never paste the one labelled `service_role` here.

### 5. Push it live (1 minute)

1. Commit and push this repo.
2. Netlify redeploys on its own, usually inside a minute.
3. Go to **categorypublishing.com/enemy-finder** and try it.

### 6. Try it yourself first

Fill in the three blanks with a book you know well and answer three or four
questions. You're checking two things:

- **Does the board move?** Some names should vanish and new ones appear each
  time you answer. If nothing ever changes, something's wrong.
- **Does the star hold?** Star one, then answer two more questions. That name
  should still be sitting there, word for word.

---

## Knobs you can turn

Nothing here needs touching, but if you want to:

| Where | What it does |
|---|---|
| `MAX_QUESTIONS` in the function | How many questions before it wraps up. Currently 8. |
| `DIG_NAMES` / `FULL_NAMES` | How many names show while digging (6) and at the end (10). |
| `ENEMY_FINDER_TURN_CAP` secret | Turns allowed per visitor per hour. Defaults to 60. |
| `ENEMY_FINDER_MODEL` secret | Which engine writes the names. Leave it alone unless costs bite. |

To change any of the secrets: **Edge Functions → Secrets → Add new secret**,
using the name in the left column above.

## If something goes wrong

Everything an author sees is written in plain English, so the page will never
show them anything technical. To see the real reason:

1. Supabase → **Edge Functions** → click **enemy-finder** → **Logs**.
2. Lines starting `[enemy-finder]` are the ones worth reading.

Common ones:

- **"The idea engine isn't switched on yet"** — the `ANTHROPIC_API_KEY` secret
  is missing or wrong. Redo step 3.
- **"The tool isn't connected yet"** — `js/enemy-config.js` is still blank.
  Redo step 4.
- **"That's a lot of digging in one hour"** — the rate limit doing its job.
  Raise `ENEMY_FINDER_TURN_CAP` if it's catching real people.

## Housekeeping

The rate-limit table only ever looks back one hour, so old rows are dead
weight. Once in a while (or on a schedule), run this in the **SQL Editor**:

```sql
select public.purge_old_enemy_finder_turns();
```

It returns how many rows it cleared.
