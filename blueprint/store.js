/* store.js — accounts, projects and persistence for the Category Book Blueprint.
   Everything that touches Supabase lives here. The document scripts
   (blueprint.js, image-slot.js) only ever call window.CBB.

   Data model, matching sql/118_category_book_blueprint.sql:
     blueprint_projects.fields  -> { "<data-k>": "<html>" }  (checkboxes save
                                    their own glyph here, so they need no
                                    special handling)
     blueprint_projects.images  -> { "<slot id>": "<storage path>" }
     blueprint_snapshots        -> a frozen copy, written on export
*/
(function () {
  var CFG = window.CBB_CONFIG || {};
  var CBB = window.CBB = {
    configured: !!(CFG.supabaseUrl && CFG.supabasePublishableKey),
    sb: null, user: null, appUserId: null,
    project: null, fields: {}, images: {}, imageUrls: {},
    onStatus: function () {}, onProject: function () {}
  };

  var SDK = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

  CBB.init = async function () {
    if (!CBB.configured) return null;
    var mod;
    try {
      mod = await import(SDK);
    } catch (e) {
      console.error("[blueprint] could not load the Supabase library", e);
      var err = new Error("offline");
      err.code = "sdk";
      throw err;
    }
    CBB.sb = mod.createClient(CFG.supabaseUrl, CFG.supabasePublishableKey);
    var s = await CBB.sb.auth.getSession();
    if (s.data && s.data.session) await adoptUser(s.data.session.user);
    return CBB.user;
  };

  // ── Accounts ──────────────────────────────────────────────────────────────
  // Mirrors the studio: an auth user is matched to an app_users row by email,
  // and that row's id is what owns a project.
  async function adoptUser(user) {
    CBB.user = user;
    var email = (user.email || "").toLowerCase();
    var got = await CBB.sb.from("app_users").select("id").eq("email", email).maybeSingle();
    if (got.error) throw got.error;
    if (got.data) { CBB.appUserId = got.data.id; return; }
    var made = await CBB.sb.from("app_users")
      .insert({ email: email, display_name: user.user_metadata && user.user_metadata.full_name || "" })
      .select("id").single();
    if (made.error) throw made.error;
    CBB.appUserId = made.data.id;
  }

  CBB.signIn = async function (email, password) {
    var r = await CBB.sb.auth.signInWithPassword({
      email: String(email || "").trim().toLowerCase(), password: password });
    if (r.error) throw new Error(friendly(r.error));
    await adoptUser(r.data.user);
    return CBB.user;
  };

  CBB.signUp = async function (email, password) {
    var r = await CBB.sb.auth.signUp({
      email: String(email || "").trim().toLowerCase(), password: password });
    if (r.error) throw new Error(friendly(r.error));
    if (!r.data.session) return { needsConfirmation: true };
    await adoptUser(r.data.user);
    return { needsConfirmation: false };
  };

  CBB.resetPassword = async function (email) {
    var r = await CBB.sb.auth.resetPasswordForEmail(
      String(email || "").trim().toLowerCase(), { redirectTo: location.href });
    if (r.error) throw new Error(friendly(r.error));
  };

  CBB.signOut = async function () {
    await CBB.sb.auth.signOut();
    CBB.user = CBB.appUserId = CBB.project = null;
    CBB.fields = {}; CBB.images = {}; CBB.imageUrls = {};
  };

  function friendly(err) {
    var m = String(err && err.message || "").toLowerCase();
    if (m.indexOf("invalid login credentials") > -1) return "That email and password don't match.";
    if (m.indexOf("already registered") > -1) return "There's already an account with that email — sign in instead.";
    if (m.indexOf("email not confirmed") > -1) return "Check your inbox and click the confirmation link first.";
    if (m.indexOf("password should be at least") > -1) return "Passwords need at least 6 characters.";
    if (m.indexOf("rate limit") > -1 || m.indexOf("too many") > -1) return "Too many tries — wait a minute.";
    if (m.indexOf("failed to fetch") > -1) return "Couldn't reach the server — check your connection.";
    console.error("[blueprint]", err);
    return "Something went wrong. Try again.";
  }
  CBB.friendly = friendly;

  // ── Projects ──────────────────────────────────────────────────────────────
  CBB.listProjects = async function () {
    var r = await CBB.sb.from("blueprint_projects")
      .select("id, client_name, category_name, status, updated_at, owner_user_id")
      .order("updated_at", { ascending: false });
    if (r.error) throw r.error;
    return r.data || [];
  };

  CBB.createProject = async function (clientName, categoryName) {
    var seed = {};
    if (clientName) seed.client = escapeHtml(clientName);
    if (categoryName) seed.claim_category = escapeHtml(categoryName);
    var r = await CBB.sb.from("blueprint_projects").insert({
      owner_user_id: CBB.appUserId,
      client_name: clientName || "",
      category_name: categoryName || "",
      fields: seed
    }).select("*").single();
    if (r.error) throw r.error;
    return r.data;
  };

  CBB.deleteProject = async function (id) {
    var r = await CBB.sb.from("blueprint_projects").delete().eq("id", id);
    if (r.error) throw r.error;
  };

  CBB.openProject = async function (id) {
    var r = await CBB.sb.from("blueprint_projects").select("*").eq("id", id).single();
    if (r.error) throw r.error;
    CBB.project = r.data;
    CBB.fields = r.data.fields || {};
    CBB.images = r.data.images || {};
    CBB.imageUrls = {};
    // Signed URLs for the private bucket, resolved up front so slots can paint.
    var paths = Object.keys(CBB.images).map(function (k) { return CBB.images[k]; }).filter(Boolean);
    if (paths.length) {
      var su = await CBB.sb.storage.from("blueprint-assets").createSignedUrls(paths, 60 * 60 * 8);
      if (!su.error && su.data) {
        su.data.forEach(function (row) {
          Object.keys(CBB.images).forEach(function (slot) {
            if (CBB.images[slot] === row.path && row.signedUrl) CBB.imageUrls[slot] = row.signedUrl;
          });
        });
      }
    }
    CBB.sb.from("blueprint_projects").update({ last_opened_at: new Date().toISOString() })
      .eq("id", id).then(function () {});
    CBB.onProject(CBB.project);
    return CBB.project;
  };

  // ── Saving ────────────────────────────────────────────────────────────────
  // Coalesced: rapid typing produces one write, and a write already in flight
  // does not race a newer one.
  var pending = null, timer = null, inFlight = false;

  CBB.saveFields = function (map) {
    if (!CBB.project) return;
    CBB.fields = map;
    pending = map;
    CBB.onStatus("saving");
    clearTimeout(timer);
    timer = setTimeout(flush, 600);
  };

  async function flush() {
    if (!CBB.project || !pending || inFlight) return;
    var payload = pending; pending = null; inFlight = true;
    var patch = { fields: payload };
    var client = stripHtml(payload.client || "");
    var cat = stripHtml(payload.claim_category || "");
    if (client && client !== CBB.project.client_name) patch.client_name = client;
    if (cat && cat !== CBB.project.category_name) patch.category_name = cat;
    try {
      var r = await CBB.sb.from("blueprint_projects").update(patch).eq("id", CBB.project.id);
      if (r.error) throw r.error;
      Object.assign(CBB.project, patch);
      CBB.onStatus(pending ? "saving" : "saved");
    } catch (e) {
      console.error("[blueprint] save failed", e);
      CBB.onStatus("error");
    } finally {
      inFlight = false;
      if (pending) flush();
    }
  }
  CBB.flushNow = function () { clearTimeout(timer); return flush(); };

  // ── Images ────────────────────────────────────────────────────────────────
  CBB.imageUrlFor = function (slotId) { return CBB.imageUrls[slotId] || null; };

  CBB.putImage = async function (slotId, file) {
    if (!CBB.project) throw new Error("Open a blueprint first.");
    var ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "");
    var path = CBB.project.id + "/slots/" + slotId + "-" + Date.now() + "." + ext;
    CBB.onStatus("saving");
    var up = await CBB.sb.storage.from("blueprint-assets")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (up.error) throw up.error;
    var old = CBB.images[slotId];
    CBB.images[slotId] = path;
    var r = await CBB.sb.from("blueprint_projects").update({ images: CBB.images })
      .eq("id", CBB.project.id);
    if (r.error) throw r.error;
    if (old && old !== path) CBB.sb.storage.from("blueprint-assets").remove([old]).then(function () {});
    var signed = await CBB.sb.storage.from("blueprint-assets").createSignedUrl(path, 60 * 60 * 8);
    CBB.imageUrls[slotId] = signed.data ? signed.data.signedUrl : null;
    CBB.onStatus("saved");
    return CBB.imageUrls[slotId];
  };

  // ── Snapshots ─────────────────────────────────────────────────────────────
  CBB.snapshot = async function (label) {
    if (!CBB.project) return null;
    await CBB.flushNow();
    var r = await CBB.sb.from("blueprint_snapshots").insert({
      project_id: CBB.project.id,
      created_by_user_id: CBB.appUserId,
      label: label || null,
      fields: CBB.fields,
      images: CBB.images
    }).select("id, created_at").single();
    if (r.error) throw r.error;
    return r.data;
  };

  // Ask the edge function for a rendered PDF. Returns a signed download URL,
  // or null when no renderer is configured — the caller falls back to print.
  CBB.exportPdf = async function (snapshotId) {
    if (!CBB.project) return null;
    var sess = await CBB.sb.auth.getSession();
    var token = sess.data && sess.data.session ? sess.data.session.access_token : null;
    if (!token) throw new Error("Sign in again — your session expired.");
    var res = await fetch(CFG.supabaseUrl + "/functions/v1/blueprint-pdf", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: "Bearer " + token },
      body: JSON.stringify({ project_id: CBB.project.id, snapshot_id: snapshotId || null })
    });
    if (res.status === 404 || res.status === 503) return null;   // not set up yet
    var out = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(out.error || "The PDF didn't come back.");
    return out.url || null;
  };

  // The newest stored PDF, so a returning client can download without waiting
  // for a re-render.
  CBB.latestExport = async function () {
    if (!CBB.project) return null;
    var r = await CBB.sb.from("blueprint_snapshots")
      .select("id, pdf_path, created_at").eq("project_id", CBB.project.id)
      .not("pdf_path", "is", null).order("created_at", { ascending: false }).limit(1);
    if (r.error || !r.data || !r.data.length) return null;
    var row = r.data[0];
    var link = await CBB.sb.storage.from("blueprint-exports")
      .createSignedUrl(row.pdf_path, 60 * 60, { download: true });
    return link.data ? link.data.signedUrl : null;
  };

  CBB.listSnapshots = async function () {
    var r = await CBB.sb.from("blueprint_snapshots")
      .select("id, label, created_at").eq("project_id", CBB.project.id)
      .order("created_at", { ascending: false }).limit(25);
    if (r.error) throw r.error;
    return r.data || [];
  };

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c];
    });
  }
  function stripHtml(s) {
    var d = document.createElement("div");
    d.innerHTML = String(s || "");
    return (d.textContent || "").trim();
  }
  CBB.stripHtml = stripHtml;
})();
