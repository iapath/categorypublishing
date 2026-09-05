// ============================================================================
// shelf-finder — the free category tool.
//
// Two actions on one function:
//   start : create the run, hand back a token and (if a file is coming) a
//           one-time signed upload URL
//   run   : read the manuscript, pick three categories, subscribe to Kit
//
// Split in two so a 25 MB manuscript goes straight to storage instead of
// through a function body, and so the Kit tag — which fires the results email —
// is only added once the results actually exist.
//
// The matching is a port of generateCategories() in Smart Publishing Studio:
// stage one narrows to a few store branches and pulls out the book's niche
// themes, stage two picks from only those branches. sales_to_1 is read with the
// service role to order candidates and mark reach for the model. It is never
// written to a run, never returned, never quoted in a reason.
//
// Deploy:  supabase functions deploy shelf-finder --no-verify-jwt
// Secrets: supabase secrets set KIT_API_KEY_SHELF=... ANTHROPIC_API_KEY=...
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const KIT_KEY = Deno.env.get("KIT_API_KEY_SHELF") || "";
const KIT_TAG = Deno.env.get("KIT_SHELF_TAG_ID") || "";
const SITE = Deno.env.get("SHELF_SITE_URL") || "https://categorypublishing.com";
const BUCKET = "shelf-finder-uploads";
const MAX_BYTES = 25 * 1024 * 1024;

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
    if (body.action === "start") return await start(body, req);
    if (body.action === "run") return await run(body);
    return oops("Unknown action.");
  } catch (e) {
    console.error("[shelf-finder]", e);
    return oops("Something went wrong on our end. Try again in a moment.", 500);
  }
});

// ── start ───────────────────────────────────────────────────────────────────
async function start(body: any, req: Request) {
  const email = String(body.email || "").trim().toLowerCase();
  const summary = String(body.summary || "").trim();
  const fileName = String(body.file_name || "").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return oops("That doesn't look like an email address.");
  if (!summary && !fileName) return oops("Upload your manuscript or paste a summary.");
  if (fileName && Number(body.file_size || 0) > MAX_BYTES) return oops("That file is over 25 MB.");

  // Light throttle: same address, same hour. Not identity, just a brake.
  const ipHash = await sha256(
    (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() + "|shelf-finder");
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("shelf_finder_runs")
    .select("id", { count: "exact", head: true })
    .eq("ip_hash", ipHash).gte("created_at", since);
  if ((count ?? 0) >= 8) return oops("That's a lot of books in one hour. Try again later.", 429);

  const token = crypto.randomUUID().replace(/-/g, "") + Math.random().toString(36).slice(2, 8);
  const ext = (fileName.split(".").pop() || "txt").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = fileName ? `${token}/manuscript.${ext}` : null;

  const { error } = await db.from("shelf_finder_runs").insert({
    token, email, first_name: firstNameFrom(email),
    input_kind: fileName ? "upload" : "summary",
    upload_path: path, upload_name: fileName || null,
    summary: summary || null, ip_hash: ipHash,
  });
  if (error) throw error;

  let uploadUrl: string | null = null;
  if (path) {
    const { data, error: upErr } = await db.storage.from(BUCKET).createSignedUploadUrl(path);
    if (upErr) throw upErr;
    uploadUrl = data.signedUrl;
  }
  return json({ ok: true, token, upload_url: uploadUrl });
}

// ── run ─────────────────────────────────────────────────────────────────────
async function run(body: any) {
  const token = String(body.token || "");
  if (!token) return oops("Missing token.");

  const { data: row, error } = await db.from("shelf_finder_runs")
    .select("*").eq("token", token).single();
  if (error || !row) return oops("We couldn't find that submission.", 404);
  if (row.status === "ready") return json({ ok: true, status: "ready" });

  await db.from("shelf_finder_runs").update({ status: "running" }).eq("token", token);

  try {
    const text = await readManuscript(row);
    if (text.trim().length < 200) {
      throw new Error("There wasn't enough readable text to go on.");
    }
    const picks = await pickCategories(text);
    if (!picks.length) throw new Error("No category was a clean fit.");

    await db.from("shelf_finder_runs").update({
      status: "ready", results: picks, completed_at: new Date().toISOString(),
    }).eq("token", token);

    // Only now: the tag is what fires the email, so it must not run early.
    const kit = await subscribeToKit(row.email, row.first_name, `${SITE}/shelf-finder/results.html?t=${token}`);
    await db.from("shelf_finder_runs").update({ kit_state: kit }).eq("token", token);

    return json({ ok: true, status: "ready" });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[shelf-finder] run failed", msg);
    await db.from("shelf_finder_runs")
      .update({ status: "failed", error: msg.slice(0, 500) }).eq("token", token);
    return oops(msg, 422);
  }
}

// ── Reading the manuscript ──────────────────────────────────────────────────
async function readManuscript(row: any): Promise<string> {
  if (row.input_kind === "summary") return String(row.summary || "");

  const { data, error } = await db.storage.from(BUCKET).download(row.upload_path);
  if (error || !data) {
    // The upload never landed, but a summary might still be there.
    if (row.summary) return String(row.summary);
    throw new Error("We never received that file. Try again, or paste a summary.");
  }
  const buf = new Uint8Array(await data.arrayBuffer());
  const name = String(row.upload_name || "").toLowerCase();

  try {
    if (name.endsWith(".docx")) return await docxText(buf);
    if (name.endsWith(".pdf")) return await pdfText(buf);
    return new TextDecoder("utf-8", { fatal: false }).decode(buf);
  } catch (e) {
    console.error("[shelf-finder] extraction failed", e);
    if (row.summary) return String(row.summary);
    throw new Error("We couldn't read that file. Try a DOCX or TXT, or paste a summary.");
  }
}

// A .docx is a zip; the text lives in word/document.xml.
async function docxText(buf: Uint8Array): Promise<string> {
  const { default: JSZip } = await import("https://esm.sh/jszip@3.10.1");
  const zip = await JSZip.loadAsync(buf);
  const parts = ["word/document.xml", "word/header1.xml"];
  let out = "";
  for (const p of parts) {
    const f = zip.file(p);
    if (!f) continue;
    const xml = await f.async("string");
    out += xml
      .replace(/<w:p[ >]/g, "\n<w:p ")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">") + "\n";
  }
  return out;
}

async function pdfText(buf: Uint8Array): Promise<string> {
  const { extractText, getDocumentProxy } = await import("https://esm.sh/unpdf@0.12.1");
  const pdf = await getDocumentProxy(buf);
  const { text } = await extractText(pdf, { mergePages: true });
  return String(text || "");
}

// ── Picking the categories ──────────────────────────────────────────────────
async function pickCategories(text: string) {
  const deep = text.slice(0, 50000);
  const opening = text.slice(0, 3000);

  const { data: all, error } = await db.from("kdp_categories")
    .select("full_path, sales_to_1")
    .eq("store_type", "kdp_picker")
    .not("is_ghost", "is", true)
    .limit(10000);
  if (error) throw error;
  if (!all?.length) throw new Error("The category list is empty.");

  // Stage one: narrow the store, and name what the book is actually about.
  const branches = [...new Set(all.map((c: any) => c.full_path.split(" > ").slice(0, 2).join(" > ")))];
  const s1 = await claude({
    model: "claude-haiku-4-5-20251001",
    maxTokens: 800,
    system: 'You classify books into store sections. Do two things: (1) from the provided list of section branches, choose the 4 to 6 branches that best fit this book; (2) extract the book\'s dominant niche themes — 5 to 8 SPECIFIC subjects, most dominant first. Return ONLY JSON: {"branches":["..."],"niche_themes":["..."]} with branches copied exactly from the list.',
    user: `Manuscript (deep skim):\n${deep}\n\nSECTION BRANCHES:\n${branches.join("\n")}`,
  });
  const parsed = parseJson(s1) || {};
  const chosen: string[] = parsed.branches || [];
  const themes: string[] = Array.isArray(parsed.niche_themes) ? parsed.niche_themes : [];

  let candidates = all.filter((c: any) => chosen.some((b) => c.full_path.startsWith(b)));
  if (!candidates.length) candidates = all;

  // Private reach data, used only to order and to mark. Never shown, never
  // returned, and the model is told not to repeat the markers.
  const tier = (c: any) => (c.sales_to_1 != null && c.sales_to_1 < 10 ? 0 : c.sales_to_1 != null && c.sales_to_1 < 20 ? 1 : 2);
  const mark = (c: any) => (tier(c) === 0 ? " <easy-reach>" : tier(c) === 1 ? " <medium-reach>" : "");
  candidates = [...candidates].sort((a: any, b: any) => tier(a) - tier(b) || a.full_path.localeCompare(b.full_path));
  const specific = candidates.filter((c: any) => !c.full_path.endsWith(" > General")).slice(0, 700);
  const generals = candidates.filter((c: any) => c.full_path.endsWith(" > General")).slice(0, 100);

  const s2 = await claude({
    model: "claude-sonnet-5",
    maxTokens: 1600,
    system: [
      "You pick Amazon KDP categories for a nonfiction book.",
      "Choose EXACTLY three, ordered most reachable first.",
      "Copy each full_path EXACTLY from the candidate list. Never invent a path.",
      "Prefer specific shelves over broad ones.",
      "Some paths carry <easy-reach> or <medium-reach>. Prefer them, but never mention",
      "them, and never mention sales figures, rankings or numbers of any kind.",
      'Return ONLY JSON: {"picks":[{"name":"last segment","path":"exact full path",',
      '"why":"2-3 sentences tying this shelf to what the book is actually about"}]}',
    ].join(" "),
    user:
      (themes.length ? `DOMINANT THEMES (match these above all else):\n${themes.join("\n")}\n\n` : "") +
      `Book opening:\n${opening}\n\nCANDIDATE CATEGORY PATHS:\n${specific.map((c: any) => c.full_path + mark(c)).join("\n")}` +
      (generals.length ? `\n\nLAST-RESORT BROAD PATHS (only if nothing above honestly fits):\n${generals.map((c: any) => c.full_path).join("\n")}` : ""),
  });

  const out = parseJson(s2) || {};
  const valid = new Set(all.map((c: any) => c.full_path));
  const ranks = ["Most reachable", "Reachable on launch day", "The stretch pick"];

  return (out.picks || [])
    .map((p: any) => ({ ...p, path: String(p.path || "").replace(/ <(easy|medium)-reach>/g, "").trim() }))
    // A path the model invented would fail in KDP, so drop anything unknown.
    .filter((p: any) => valid.has(p.path))
    .slice(0, 3)
    .map((p: any, i: number) => ({
      rank: i + 1,
      rank_line: ranks[i] || "",
      name: String(p.name || p.path.split(" > ").pop() || "").trim(),
      path: p.path,
      why: String(p.why || "").replace(/<(easy|medium)-reach>/g, "").trim(),
    }));
}

async function claude({ model, system, user, maxTokens }: any): Promise<string> {
  if (!ANTHROPIC_KEY) throw new Error("The category engine isn't configured yet.");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": ANTHROPIC_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) throw new Error(`Category engine ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = await r.json();
  return (j.content || []).map((b: any) => b.text || "").join("");
}

function parseJson(s: string): any {
  const m = s.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// ── Kit ─────────────────────────────────────────────────────────────────────
// Fields first, tag second: the tag is the automation trigger, so results_url
// has to be on the subscriber before it fires.
async function subscribeToKit(email: string, firstName: string | null, resultsUrl: string) {
  if (!KIT_KEY) return "skipped";
  try {
    const create = await fetch("https://api.kit.com/v4/subscribers", {
      method: "POST",
      headers: { "content-type": "application/json", "X-Kit-Api-Key": KIT_KEY },
      body: JSON.stringify({
        email_address: email,
        first_name: firstName || undefined,
        fields: { results_url: resultsUrl, shelf_finder_source: "shelf-finder" },
      }),
    });
    if (!create.ok && create.status !== 422) {   // 422 = already a subscriber
      console.error("[shelf-finder] kit subscriber", create.status, (await create.text()).slice(0, 200));
      return "failed";
    }
    if (KIT_TAG) {
      const tag = await fetch(`https://api.kit.com/v4/tags/${KIT_TAG}/subscribers`, {
        method: "POST",
        headers: { "content-type": "application/json", "X-Kit-Api-Key": KIT_KEY },
        body: JSON.stringify({ email_address: email }),
      });
      if (!tag.ok) {
        console.error("[shelf-finder] kit tag", tag.status, (await tag.text()).slice(0, 200));
        return "failed";
      }
    }
    return "subscribed";
  } catch (e) {
    console.error("[shelf-finder] kit", e);
    return "failed";
  }
}

// ── Small helpers ───────────────────────────────────────────────────────────
const ROLE_ADDRESSES = new Set(["info","hello","admin","team","contact","support","sales","office","mail","help","hi","me","books","author","press"]);
function firstNameFrom(email: string): string | null {
  const local = email.split("@")[0].split(/[.+_\-0-9]/)[0];
  if (!local || local.length < 2 || local.length > 20) return null;
  if (!/^[a-z]+$/.test(local)) return null;
  if (ROLE_ADDRESSES.has(local)) return null;      // "Hi Info," helps nobody
  return local[0].toUpperCase() + local.slice(1);
}

async function sha256(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
