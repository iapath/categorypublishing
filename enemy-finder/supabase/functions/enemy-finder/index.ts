// ============================================================================
// enemy-finder — the free "find the enemy for your book" tool at
// categorypublishing.com/enemy-finder.
//
// One question at a time. After every answer the two lists of names are
// rewritten: starred names are handed back untouched, the rest churn as the
// answers get sharper. That churn is the whole point of the tool, so the
// prompt below is explicit about what must survive and what may be replaced.
//
// The prompt lives HERE, not in the browser. The page only ever sends the
// author's own words back.
//
// Two actions on one function:
//   turn    : take the latest answer, hand back the next question + both lists
//   sharpen : take the starred names, hand back a verdict and a sharper
//             alternative for each
//
// Runs against the same Supabase project as Smart Publishing Studio and uses
// the same ANTHROPIC_API_KEY secret the other tools there already use.
//
// Deploy:  supabase functions deploy enemy-finder --no-verify-jwt
//          (or: Dashboard -> Edge Functions -> Deploy a new function ->
//           name it exactly "enemy-finder" -> paste this whole file)
// Secrets: ANTHROPIC_API_KEY  (already set if the Shelf Finder works)
// SQL:     run sql/121_enemy_finder.sql first — the throttle needs its table.
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const MODEL = Deno.env.get("ENEMY_FINDER_MODEL") || "claude-sonnet-5";
// Turns per IP per hour. A full run is roughly eight, so this allows a few
// goes plus restarts and still puts a ceiling on a page nobody has to log in to.
const TURNS_PER_HOUR = Number(Deno.env.get("ENEMY_FINDER_TURN_CAP") || 60);

const MAX_SETUP = 400;      // person / problem / pov
const MAX_ANSWER = 2000;    // one answer
const MAX_HISTORY = 14;     // question/answer pairs carried back
const DIG_NAMES = 6;        // names per list while still asking questions
const FULL_NAMES = 10;      // names per list on the final pass
const MAX_QUESTIONS = 8;    // hard stop, whatever the model wants

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const oops = (msg: string, status = 400) => json({ error: msg }, status);

const db = createClient(SUPABASE_URL, SERVICE_KEY);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return oops("POST only", 405);

  let body: any = {};
  try { body = await req.json(); } catch { return oops("Bad request."); }

  try {
    const gate = await throttle(req);
    if (gate) return gate;
    if (body.action === "turn") return await turn(body, req);
    if (body.action === "sharpen") return await sharpen(body, req);
    return oops("Unknown action.");
  } catch (e) {
    console.error("[enemy-finder]", e);
    const msg = e instanceof Error ? e.message : "";
    // Anything we wrote ourselves is already safe to show. Anything else is not.
    return oops(msg.startsWith("SAFE:") ? msg.slice(5)
      : "Something went wrong on our end. Try that again in a moment.", 500);
  }
});

// ── Throttle ────────────────────────────────────────────────────────────────
// Not identity, just a brake on a page that spends money without a login.
async function throttle(req: Request) {
  const ipHash = await hashIp(req);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("enemy_finder_turns")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", since);
  if ((count ?? 0) >= TURNS_PER_HOUR) {
    return oops("That's a lot of digging in one hour. Come back a little later.", 429);
  }
  return null;
}

async function log(req: Request, sessionId: string, kind: string) {
  const id = /^[0-9a-f-]{10,40}$/i.test(String(sessionId)) ? String(sessionId) : null;
  // A throttle row failing is not worth costing the author their turn.
  try {
    await db.from("enemy_finder_turns")
      .insert({ session_id: id, kind, ip_hash: await hashIp(req) });
  } catch (e) {
    console.error("[enemy-finder] log", e);
  }
}

async function hashIp(req: Request) {
  const raw = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  const bytes = new TextEncoder().encode(raw + "|enemy-finder");
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Shared prompt ───────────────────────────────────────────────────────────
// The house rules for a name. Both actions splice this in so a sharpened
// name is judged by exactly the standard that produced it.
const NAME_RULES = `RULES FOR EVERY NAME
- Two to four words. Short enough to say out loud and repeat from memory.
- Built out of THIS author's own answers. If it would fit any book in any
  market, it is wrong.
- Concrete over clever. A name that makes the author a little angry is working.
- One sentence of meaning, written to "you", in plain words.
- Never use an em dash.
- Dead on arrival: anything ending in Trap, Myth, Secret, Mindset, Blueprint,
  Formula, Framework, Method, Paradigm or Revolution as a lazy suffix.
  Anything a consultant would put on a slide. Anything that sounds like the
  title of a business book you have already read.`;

function setupBlock(b: any) {
  const person = clip(b.person, MAX_SETUP);
  const problem = clip(b.problem, MAX_SETUP);
  const pov = clip(b.pov, MAX_SETUP);
  if (!person || !problem) throw new Error("SAFE:Tell us who you're writing to and what they're stuck on first.");
  return `THE AUTHOR'S SETUP
Person:  ${person}
Problem: ${problem}
POV:     ${pov || "(not given yet)"}`;
}

// ── turn ────────────────────────────────────────────────────────────────────
async function turn(b: any, req: Request) {
  const setup = setupBlock(b);
  const history = (Array.isArray(b.history) ? b.history : [])
    .slice(-MAX_HISTORY)
    .map((h: any) => ({ q: clip(h?.q, 400), a: clip(h?.a, MAX_ANSWER) }))
    .filter((h: any) => h.q && h.a);
  if (!history.length) throw new Error("SAFE:Answer the first question before we dig.");

  const kept = names(b.kept);
  const open = names(b.open).filter((n) => !kept.some((k) => same(k.name, n.name)));
  // "Final" means: stop asking, print the full ten a side.
  const final = !!b.final || history.length >= MAX_QUESTIONS;
  const want = final ? FULL_NAMES : DIG_NAMES;

  const system = `You are helping a nonfiction author find the enemy for their book.

The enemy is two things at once: the conventional wisdom they are fighting,
and the consequence that catches their reader if the problem never gets fixed.

${setup}

HOW YOU ASK
- Exactly ONE question per turn. Never two. Never one question with a second
  stapled on after a comma.
- Conversational and short, the way a sharp friend asks over coffee. Not a form.
- Dig, in roughly this order, moving on as each one lands: what the normal
  advice actually is, what is wrong with it, what it costs them, what happens
  to the people who follow it all the way to the end, and the author's own
  stories about watching that happen.
- Push for specifics. When an answer is vague or could have come from anyone,
  your next question asks for the concrete version: a number, a name, a moment,
  a story they were in the room for.
- Never ask a yes/no question. Never ask them to summarise what they just said.

THE TWO LISTS
Every turn you return two lists.

  normal      Names for the conventional wisdom this author is fighting.
              The shape to aim at: "The Big Book Lie", "The Deck Delusion".
  consequence Names for what happens to their person if the problem never gets
              solved. The thing lurking behind it that they do not see coming.
              The shape to aim at: "Category Theft", "Launch Lunacy".

${NAME_RULES}

HOW THE LISTS CHANGE BETWEEN TURNS
You are handed the board as it stands, in two parts.

STARRED names are the author's keepers. Return every starred name in its list,
first, with the name and the meaning character for character identical. Never
drop one, never reword one, never tidy one up, never "improve" one.

OPEN names are yours to move. Each turn: keep the ones the newest answer makes
stronger, cut the ones it makes wrong, vague or a near duplicate of another,
and write new ones out of what you just learned. Turn over two or three per
list per turn. Enough that the board visibly moves, not so much that the author
loses the name they were about to star. When you keep an open name, hand it
back with its name and meaning unchanged so the author can see it survived.

Return ${want} names in each list, starred ones included in that count.
${final
  ? `This is the last pass. Ask no further question: return "question" as an empty string and "enough" as true. Make these ${FULL_NAMES} a side the best of everything you have heard.`
  : `Set "enough" to true only when you have heard enough about the normal way and what it costs that another question would add nothing.`}

REPLY WITH JSON AND NOTHING ELSE
{
  "read": "One sentence back to the author showing you heard the specific thing they just said. No praise, no 'great answer'.",
  "question": "${final ? "" : "The single next question."}",
  "hint": "${final ? "" : "A short nudge under the question about the kind of detail that would help. One line, under twelve words."}",
  "normal": [{ "name": "...", "meaning": "..." }],
  "consequence": [{ "name": "...", "meaning": "..." }],
  "enough": ${final ? "true" : "false"}
}`;

  const user = `THE CONVERSATION SO FAR
${history.map((h: any, i: number) => `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a}`).join("\n\n")}

THE BOARD AS IT STANDS
${boardBlock(kept, open)}

Their newest answer is A${history.length}. Read it, then ${final
    ? `write the final ${FULL_NAMES} names a side.`
    : "ask the one question that gets you closest to the enemy, and rework the board."}`;

  const raw = await claude({ system, user, maxTokens: final ? 3000 : 2000 });
  const out = parseJson(raw);
  if (!out) throw new Error("SAFE:The idea engine garbled that one. Try sending your answer again.");

  const result = {
    read: clip(out.read, 400),
    question: final ? "" : clip(out.question, 400),
    hint: final ? "" : clip(out.hint, 160),
    normal: reconcile(out.normal, kept, "normal", want),
    consequence: reconcile(out.consequence, kept, "consequence", want),
    enough: final || out.enough === true,
    final,
  };
  if (!final && !result.question) throw new Error("SAFE:The idea engine lost its thread. Try sending your answer again.");

  await log(req, b.session_id, final ? "final" : "turn");
  return json(result);
}

// ── sharpen ─────────────────────────────────────────────────────────────────
async function sharpen(b: any, req: Request) {
  const setup = setupBlock(b);
  const picks = names(b.picks).slice(0, 6);
  if (!picks.length) throw new Error("SAFE:Star the names that hit first, then we'll sharpen them.");
  const history = (Array.isArray(b.history) ? b.history : [])
    .slice(-MAX_HISTORY)
    .map((h: any) => ({ q: clip(h?.q, 400), a: clip(h?.a, MAX_ANSWER) }))
    .filter((h: any) => h.q && h.a);

  const system = `You are helping a nonfiction author sharpen the enemy names they picked.

${setup}

${NAME_RULES}

YOUR JOB
For each name they picked, in order:
1. Say straight whether it lands. If it is vague, too clever for its own good,
   or sounds like every business book, say exactly that and say why. If it has
   teeth, say what is giving it teeth, in one line. No praise for its own sake.
2. Give one sharper alternative, built from their own answers, that fixes what
   you just named. If the name already lands, the alternative is a real
   variation worth weighing, never a downgrade offered to look useful.

Do not let them settle for boring. A soft verdict on a soft name is a failure.

REPLY WITH JSON AND NOTHING ELSE
{
  "picks": [{
    "name": "their name, character for character",
    "list": "normal" or "consequence",
    "lands": true or false,
    "verdict": "One or two sentences. Straight.",
    "better": "The sharper alternative name.",
    "better_meaning": "One sentence on what it means, written to 'you'."
  }],
  "closing": "One line on which of these is the enemy and what to do with it."
}`;

  const user = `WHAT THEY TOLD ME
${history.map((h: any, i: number) => `Q${i + 1}: ${h.q}\nA${i + 1}: ${h.a}`).join("\n\n") || "(nothing yet)"}

THE NAMES THEY PICKED
${picks.map((p) => `- [${p.list || "normal"}] ${p.name}: ${p.meaning}`).join("\n")}`;

  const raw = await claude({ system, user, maxTokens: 2000 });
  const out = parseJson(raw);
  if (!out || !Array.isArray(out.picks)) throw new Error("SAFE:The idea engine garbled that one. Try sharpening again.");

  await log(req, b.session_id, "sharpen");
  return json({
    picks: out.picks.slice(0, 6).map((p: any) => ({
      name: clip(p?.name, 80),
      list: p?.list === "consequence" ? "consequence" : "normal",
      lands: p?.lands === true,
      verdict: clip(p?.verdict, 400),
      better: clip(p?.better, 80),
      better_meaning: clip(p?.better_meaning, 300),
    })).filter((p: any) => p.name && p.verdict),
    closing: clip(out.closing, 300),
  });
}

// ── The board ───────────────────────────────────────────────────────────────
function boardBlock(kept: Name[], open: Name[]) {
  const side = (list: string) => {
    const k = kept.filter((n) => n.list === list);
    const o = open.filter((n) => n.list === list);
    return `${list.toUpperCase()}
  STARRED (hand these back untouched):
${k.length ? k.map((n) => `    - ${n.name}: ${n.meaning}`).join("\n") : "    (none yet)"}
  OPEN (keep, cut or replace as the answers earn it):
${o.length ? o.map((n) => `    - ${n.name}: ${n.meaning}`).join("\n") : "    (nothing on the board yet)"}`;
  };
  return `${side("normal")}\n\n${side("consequence")}`;
}

// The star is a promise, so it is kept here rather than trusted to the model.
// Whatever came back, the starred names are put back at the top of their list,
// exactly as the author starred them, and any restyled copy of one is dropped.
function reconcile(incoming: any, kept: Name[], list: string, want: number) {
  const mine = kept.filter((n) => n.list === list)
    .map((n) => ({ name: n.name, meaning: n.meaning, starred: true }));
  const rest = (Array.isArray(incoming) ? incoming : [])
    .map((n: any) => ({ name: clip(n?.name, 80), meaning: clip(n?.meaning, 300), starred: false }))
    .filter((n) => n.name && n.meaning)
    .filter((n) => !mine.some((k) => same(k.name, n.name)))
    .filter((n, i, all) => all.findIndex((o) => same(o.name, n.name)) === i);
  return [...mine, ...rest].slice(0, Math.max(want, mine.length));
}

type Name = { name: string; meaning: string; list: string };

function names(v: any): Name[] {
  return (Array.isArray(v) ? v : []).slice(0, 24).map((n: any) => ({
    name: clip(n?.name, 80),
    meaning: clip(n?.meaning, 300),
    list: n?.list === "consequence" ? "consequence" : "normal",
  })).filter((n) => n.name);
}

const same = (a: string, b: string) =>
  a.toLowerCase().replace(/[^a-z0-9]/g, "") === b.toLowerCase().replace(/[^a-z0-9]/g, "");

const clip = (v: unknown, max: number) =>
  typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";

// ── The engine ──────────────────────────────────────────────────────────────
async function claude({ system, user, maxTokens }: { system: string; user: string; maxTokens: number }) {
  if (!ANTHROPIC_KEY) throw new Error("SAFE:The idea engine isn't switched on yet. (Admin: add the engine key.)");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 300);
    console.error("[enemy-finder] engine", r.status, detail);
    if (r.status === 429) throw new Error("SAFE:The idea engine is at capacity this second. Try again in a moment.");
    if (r.status === 400 && /credit|balance/i.test(detail)) throw new Error("SAFE:The idea engine is out of credit. (Admin: top up the engine account.)");
    if (r.status === 401 || r.status === 403) throw new Error("SAFE:The idea engine isn't switched on yet. (Admin: check the engine key.)");
    throw new Error("SAFE:The idea engine hit a snag. Try that again in a moment.");
  }
  const j = await r.json();
  return (j.content || []).map((b: any) => b.text || "").join("");
}

// The model is told to send JSON and nothing else, but a stray "Here you go:"
// should not cost the author their turn.
function parseJson(s: string): any {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (esc) { esc = false; continue; }
    if (c === "\\") { esc = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
    }
  }
  return null;
}
