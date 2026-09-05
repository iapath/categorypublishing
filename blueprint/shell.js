/* shell.js — sign in, pick a blueprint, then hand the document its answers.
   Runs after store.js and before the document scripts finish hydrating. */
(function () {
  var CBB = window.CBB;
  var veil, bar;

  function el(tag, cls, html) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  }
  function screen(inner, wide) {
    if (!veil) { veil = el("div", "cbb-shell cbb-veil"); document.body.appendChild(veil); }
    veil.innerHTML = "";
    var card = el("div", "cbb-card" + (wide ? " wide" : ""));
    card.appendChild(inner);
    veil.appendChild(card);
    veil.style.display = "flex";
    return card;
  }
  function hideVeil() { if (veil) veil.style.display = "none"; }

  // ── Not configured yet ────────────────────────────────────────────────────
  function setupScreen() {
    var w = el("div");
    w.appendChild(el("div", "cbb-eyebrow", "SETUP"));
    w.appendChild(el("h1", "cbb-h", "Add the two keys."));
    w.appendChild(el("p", "cbb-sub",
      "Open <code>blueprint/config.js</code> and paste the same Supabase URL and " +
      "publishable key that Smart Publishing Studio uses. Commit it, and this page works."));
    w.appendChild(el("p", "cbb-note",
      "Publishable key only — never the service_role key. This file is public."));
    screen(w);
  }

  function offlineScreen(msg) {
    var w = el("div");
    w.appendChild(el("div", "cbb-eyebrow", "OFFLINE"));
    w.appendChild(el("h1", "cbb-h", "Can't connect."));
    w.appendChild(el("p", "cbb-sub", msg));
    var again = el("button", "cbb-btn", "Reload");
    again.onclick = function () { location.reload(); };
    w.appendChild(again);
    screen(w);
  }

  // ── Sign in ───────────────────────────────────────────────────────────────
  function authScreen(mode) {
    var isUp = mode === "signup";
    var w = el("div");
    w.appendChild(el("div", "cbb-eyebrow", "CATEGORY BOOK BLUEPRINT"));
    w.appendChild(el("h1", "cbb-h", isUp ? "Create your account." : "Sign in."));
    w.appendChild(el("p", "cbb-sub", isUp
      ? "Use any email you like — this becomes your login for the blueprint."
      : "Same email and password as Smart Publishing Studio."));
    var err = el("p", "cbb-err", "");
    w.appendChild(err);

    w.appendChild(el("label", "cbb-label", "EMAIL"));
    var email = el("input", "cbb-input"); email.type = "email"; email.autocomplete = "username";
    w.appendChild(email);
    w.appendChild(el("label", "cbb-label", "PASSWORD"));
    var pw = el("input", "cbb-input"); pw.type = "password";
    pw.autocomplete = isUp ? "new-password" : "current-password";
    w.appendChild(pw);

    var go = el("button", "cbb-btn", isUp ? "Create account" : "Sign in");
    w.appendChild(go);

    var swap = el("button", "cbb-link", isUp ? "Already have an account? Sign in" : "Create an account");
    swap.onclick = function () { authScreen(isUp ? "signin" : "signup"); };
    w.appendChild(swap);

    if (!isUp) {
      var forgot = el("button", "cbb-link", "Forgot your password?");
      forgot.style.marginLeft = "14px";
      forgot.onclick = async function () {
        if (!email.value) { err.textContent = "Type your email first."; return; }
        try { await CBB.resetPassword(email.value); err.style.color = "#4ED18A";
              err.textContent = "Check your inbox for the reset link."; }
        catch (e) { err.textContent = e.message; }
      };
      w.appendChild(forgot);
    }

    async function submit() {
      err.style.color = ""; err.textContent = "";
      if (!email.value || !pw.value) { err.textContent = "Email and password, please."; return; }
      go.disabled = true; go.textContent = isUp ? "Creating…" : "Signing in…";
      try {
        if (isUp) {
          var r = await CBB.signUp(email.value, pw.value);
          if (r.needsConfirmation) {
            err.style.color = "#4ED18A";
            err.textContent = "Almost there — click the link in your inbox, then sign in.";
            go.disabled = false; go.textContent = "Create account";
            return;
          }
        } else {
          await CBB.signIn(email.value, pw.value);
        }
        projectScreen();
      } catch (e) {
        err.textContent = e.message;
        go.disabled = false; go.textContent = isUp ? "Create account" : "Sign in";
      }
    }
    go.onclick = submit;
    [email, pw].forEach(function (i) {
      i.addEventListener("keydown", function (e) { if (e.key === "Enter") submit(); });
    });
    screen(w);
    email.focus();
  }

  // ── Pick a blueprint ──────────────────────────────────────────────────────
  async function projectScreen() {
    var w = el("div");
    w.appendChild(el("div", "cbb-eyebrow", "YOUR BLUEPRINTS"));
    w.appendChild(el("h1", "cbb-h", "Open one, or start a new one."));
    var err = el("p", "cbb-err", ""); w.appendChild(err);
    var rows = el("div", "cbb-rows", '<p class="cbb-empty">Loading…</p>');
    w.appendChild(rows);

    w.appendChild(el("label", "cbb-label", "NEW BLUEPRINT"));
    var name = el("input", "cbb-input"); name.placeholder = "Client name"; w.appendChild(name);
    var cat = el("input", "cbb-input"); cat.placeholder = "Category (if you know it yet)"; w.appendChild(cat);
    var make = el("button", "cbb-btn", "Start a blueprint");
    make.onclick = async function () {
      if (!name.value.trim()) { err.textContent = "Give it a client name so you can find it later."; return; }
      make.disabled = true; make.textContent = "Creating…";
      try {
        var p = await CBB.createProject(name.value.trim(), cat.value.trim());
        await open(p.id);
      } catch (e) {
        err.textContent = CBB.friendly(e);
        make.disabled = false; make.textContent = "Start a blueprint";
      }
    };
    w.appendChild(make);

    var out = el("button", "cbb-link", "Sign out");
    out.onclick = async function () { await CBB.signOut(); authScreen("signin"); };
    w.appendChild(out);

    screen(w, true);

    try {
      var list = await CBB.listProjects();
      rows.innerHTML = "";
      if (!list.length) {
        rows.appendChild(el("p", "cbb-empty", "Nothing here yet. Start your first one below."));
      }
      list.forEach(function (p) {
        var row = el("div", "cbb-row");
        var main = el("div", "cbb-row-main");
        main.appendChild(el("div", "cbb-row-name", esc(p.client_name || "Untitled")));
        main.appendChild(el("div", "cbb-row-meta",
          (p.category_name ? esc(p.category_name) + " · " : "") + "edited " + when(p.updated_at)));
        row.appendChild(main);
        main.onclick = function () { open(p.id); };
        if (p.owner_user_id === CBB.appUserId) {
          var del = el("button", "cbb-row-del", "DELETE");
          del.onclick = async function (e) {
            e.stopPropagation();
            if (!confirm("Delete “" + (p.client_name || "Untitled") + "”? This can't be undone.")) return;
            try { await CBB.deleteProject(p.id); projectScreen(); }
            catch (er) { err.textContent = CBB.friendly(er); }
          };
          row.appendChild(del);
        }
        rows.appendChild(row);
      });
    } catch (e) {
      rows.innerHTML = "";
      err.textContent = CBB.friendly(e);
    }
  }

  // ── Open a blueprint ──────────────────────────────────────────────────────
  async function open(id) {
    await CBB.openProject(id);
    window.CBBDoc.hydrate(CBB.fields);
    document.querySelectorAll("image-slot").forEach(function (s) {
      if (typeof s.hydrate === "function") s.hydrate(CBB.imageUrlFor(s.id));
    });
    buildBar();
    hideVeil();
    document.body.classList.add("cbb-live");
    window.dispatchEvent(new Event("resize"));  // let doc-page re-measure
  }

  // ── Toolbar ───────────────────────────────────────────────────────────────
  function buildBar() {
    if (bar) bar.remove();
    bar = el("div", "cbb-shell cbb-bar");
    var nm = el("span", "cbb-bar-name", esc(CBB.project.client_name || "Untitled"));
    bar.appendChild(nm);
    var ct = el("span", "cbb-bar-cat", esc(CBB.project.category_name || ""));
    bar.appendChild(ct);
    bar.appendChild(el("span", "cbb-bar-spacer"));

    var status = el("span", "cbb-status", "SAVED");
    status.setAttribute("data-s", "saved");
    bar.appendChild(status);
    CBB.onStatus = function (s) {
      status.setAttribute("data-s", s);
      status.textContent = s === "saving" ? "SAVING…" : s === "error" ? "NOT SAVED" : "SAVED";
    };
    CBB.onProject = function (p) {
      nm.textContent = p.client_name || "Untitled";
      ct.textContent = p.category_name || "";
    };

    var exp = el("button", "cbb-btn ghost", "Export PDF");
    exp.onclick = async function () {
      exp.disabled = true; exp.textContent = "Saving…";
      try {
        await CBB.snapshot("Export " + new Date().toLocaleString());
        exp.textContent = "Export PDF";
        exp.disabled = false;
        window.print();
      } catch (e) {
        exp.disabled = false; exp.textContent = "Export PDF";
        alert(CBB.friendly(e));
      }
    };
    bar.appendChild(exp);

    var back = el("button", "cbb-btn ghost", "All blueprints");
    back.onclick = async function () {
      await CBB.flushNow();
      document.body.classList.remove("cbb-live");
      projectScreen();
    };
    bar.appendChild(back);

    document.body.appendChild(bar);
  }

  function esc(s) { var d = document.createElement("div"); d.textContent = String(s || ""); return d.innerHTML; }
  function when(ts) {
    if (!ts) return "never";
    var d = new Date(ts), diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 90) return "just now";
    if (diff < 3600) return Math.round(diff / 60) + " min ago";
    if (diff < 86400) return Math.round(diff / 3600) + "h ago";
    if (diff < 604800) return Math.round(diff / 86400) + "d ago";
    return d.toLocaleDateString();
  }

  // Don't lose the last keystroke on the way out.
  window.addEventListener("beforeunload", function () { if (CBB.project) CBB.flushNow(); });

  // ── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", async function () {
    if (!CBB.configured) { setupScreen(); return; }
    try {
      var user = await CBB.init();
      if (user) projectScreen(); else authScreen("signin");
    } catch (e) {
      console.error("[blueprint] boot", e);
      // Never show a sign-in form that cannot possibly work.
      offlineScreen(e && e.code === "sdk"
        ? "The page couldn't load its connection library. Check your internet and reload."
        : "Couldn't reach the blueprint service. Check your connection and reload.");
    }
  });
})();
