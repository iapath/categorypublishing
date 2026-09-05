// ============================================================================
// blueprint-pdf — render one blueprint to PDF, store it, hand back a link.
//
// Edge functions run Deno, which cannot run a browser, and this document only
// lays out correctly in a real browser engine. So the function does the parts
// that must be trusted — checking who is asking, assembling the filled-in
// page, storing the result — and hands the actual rendering to a headless
// browser service.
//
// Deploy:  supabase functions deploy blueprint-pdf
// Secrets: supabase secrets set PDF_RENDER_PROVIDER=browserless \
//                               PDF_RENDER_KEY=xxxxxxxx
//          (optional) PDF_RENDER_URL, BLUEPRINT_URL
// ============================================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PROVIDER = (Deno.env.get("PDF_RENDER_PROVIDER") || "browserless").toLowerCase();
const RENDER_KEY = Deno.env.get("PDF_RENDER_KEY") || "";
const RENDER_URL = Deno.env.get("PDF_RENDER_URL") || "";
const BLUEPRINT_URL = Deno.env.get("BLUEPRINT_URL") || "https://categorypublishing.com/blueprint/";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const fail = (msg: string, status = 400) =>
  new Response(JSON.stringify({ error: msg }), {
    status, headers: { ...cors, "content-type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return fail("POST only", 405);
  if (!RENDER_KEY) return fail("No rendering service is configured yet.", 503);

  const jwt = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!jwt) return fail("Sign in first.", 401);

  let projectId = "", snapshotId = "";
  try {
    const body = await req.json();
    projectId = String(body.project_id || "");
    snapshotId = String(body.snapshot_id || "");
  } catch { return fail("Bad request body."); }
  if (!projectId) return fail("Which blueprint?");

  // 1) Ask as the caller, so RLS — not this function — decides what they see.
  const asUser = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: project, error: readErr } = await asUser
    .from("blueprint_projects").select("*").eq("id", projectId).single();
  if (readErr || !project) return fail("That blueprint isn't yours to export.", 403);

  // 2) Signed URLs for the images, so the renderer can actually fetch them.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const images: Record<string, string> = {};
  const slots = Object.keys(project.images || {});
  if (slots.length) {
    const paths = slots.map((k) => project.images[k]).filter(Boolean);
    const { data: signed } = await admin.storage.from("blueprint-assets")
      .createSignedUrls(paths, 900);
    (signed || []).forEach((row: any) => {
      for (const slot of slots) {
        if (project.images[slot] === row.path && row.signedUrl) images[slot] = row.signedUrl;
      }
    });
  }

  // 3) The page, with the answers baked in and the app chrome left out.
  let html: string;
  try {
    html = await buildHtml(project.fields || {}, images);
  } catch (e) {
    console.error("[blueprint-pdf] could not assemble the page", e);
    return fail("Couldn't assemble the blueprint page.", 502);
  }

  // 4) Render.
  let pdf: Uint8Array;
  try {
    pdf = await render(html);
  } catch (e) {
    console.error("[blueprint-pdf] renderer failed", e);
    return fail("The PDF service didn't answer. Try again in a moment.", 502);
  }

  // 5) Keep it, and point the snapshot at it.
  const snapId = snapshotId || crypto.randomUUID();
  const path = `${projectId}/${snapId}.pdf`;
  const up = await admin.storage.from("blueprint-exports")
    .upload(path, pdf, { contentType: "application/pdf", upsert: true });
  if (up.error) {
    console.error("[blueprint-pdf] upload", up.error);
    return fail("Rendered it, but couldn't file it away.", 502);
  }

  if (snapshotId) {
    await admin.from("blueprint_snapshots").update({ pdf_path: path }).eq("id", snapshotId);
  } else {
    await admin.from("blueprint_snapshots").insert({
      id: snapId, project_id: projectId, label: "Export", pdf_path: path,
      fields: project.fields, images: project.images,
    });
  }

  const { data: link } = await admin.storage.from("blueprint-exports")
    .createSignedUrl(path, 60 * 60, {
      download: `${slug(project.client_name || "blueprint")}-category-book-blueprint.pdf`,
    });

  return new Response(JSON.stringify({
    ok: true, path, snapshot_id: snapId, url: link?.signedUrl || null,
  }), { headers: { ...cors, "content-type": "application/json" } });
});

// ── Build the page the renderer will open ───────────────────────────────────
// Fetching the live page keeps one copy of the design: edit the worksheet and
// the PDF follows, with no template to keep in step.
async function buildHtml(fields: Record<string, string>, images: Record<string, string>) {
  const res = await fetch(BLUEPRINT_URL, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`blueprint page returned ${res.status}`);
  let html = await res.text();

  // Relative src/href resolve against the real site.
  html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${BLUEPRINT_URL}">`);

  // Drop the app: no sign-in, no toolbar, no Supabase round trips.
  html = html.replace(/<script src="(config|store|shell)\.js"><\/script>\s*/g, "");
  html = html.replace(/<link rel="stylesheet" href="shell\.css">\s*/g, "");

  const payload = JSON.stringify({ fields, images })
    .replace(/</g, "\\u003c").replace(/-->/g, "--\\u003e");

  // Runs after blueprint.js has defined CBBDoc, so the same hydrate path the
  // app uses fills the document here too.
  const inject = `
<script>
(function () {
  var DATA = ${payload};
  function paint() {
    if (window.CBBDoc && window.CBBDoc.hydrate) window.CBBDoc.hydrate(DATA.fields);
    document.querySelectorAll('image-slot').forEach(function (s) {
      var url = DATA.images[s.id];
      if (url && typeof s.hydrate === 'function') s.hydrate(url);
    });
    document.querySelectorAll('[contenteditable]').forEach(function (n) {
      n.setAttribute('contenteditable', 'false');
    });
    window.__blueprintReady = true;
  }
  if (document.readyState === 'complete') setTimeout(paint, 60);
  else window.addEventListener('load', function () { setTimeout(paint, 60); });
})();
</script>`;
  return html.replace(/<\/body>/i, `${inject}</body>`);
}

// ── Rendering services ──────────────────────────────────────────────────────
// The document's own @media print rules do the layout, so every provider is
// asked for the same thing: print backgrounds on, no extra margins.
async function render(html: string): Promise<Uint8Array> {
  if (PROVIDER === "pdfshift") {
    const r = await fetch(RENDER_URL || "https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: "Basic " + btoa("api:" + RENDER_KEY),
      },
      body: JSON.stringify({
        source: html, landscape: true, use_print: true,
        margin: "0", wait_for: "__blueprintReady", format: "Letter",
      }),
    });
    if (!r.ok) throw new Error(`pdfshift ${r.status}: ${await r.text()}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  if (PROVIDER === "docraptor") {
    const r = await fetch(RENDER_URL || "https://docraptor.com/docs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user_credentials: RENDER_KEY,
        doc: { document_content: html, type: "pdf", javascript: true,
               prince_options: { media: "print" } },
      }),
    });
    if (!r.ok) throw new Error(`docraptor ${r.status}: ${await r.text()}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  // Browserless (default), self-hosted or cloud.
  const base = RENDER_URL || "https://production-sfo.browserless.io";
  const r = await fetch(`${base}/pdf?token=${encodeURIComponent(RENDER_KEY)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      html,
      options: { printBackground: true, landscape: true, preferCSSPageSize: true,
                 margin: { top: "0", right: "0", bottom: "0", left: "0" } },
      gotoOptions: { waitUntil: "networkidle0", timeout: 60000 },
      waitForFunction: { fn: "() => window.__blueprintReady === true", timeout: 30000 },
    }),
  });
  if (!r.ok) throw new Error(`browserless ${r.status}: ${await r.text()}`);
  return new Uint8Array(await r.arrayBuffer());
}

function slug(s: string) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "blueprint";
}
