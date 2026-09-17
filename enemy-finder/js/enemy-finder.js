/* Enemy Finder — one question at a time, and a board that visibly moves.

   Three things this file is careful about:

   1. The star is a promise. A starred name is pinned in state, sent to the
      server as "kept", and handed back untouched. It never leaves the board
      until the author unstars it.
   2. The churn has to be legible. Cards are keyed by name, so each turn splits
      into leave / stay / arrive. Leavers collapse first, then newcomers rise,
      so you can see what survived instead of watching the list blink.
   3. Nothing from the engine is ever written as HTML. Every string goes in
      through textContent. */
(function () {
  var CFG = window.ENEMY_CONFIG || {};
  var FN = CFG.supabaseUrl ? CFG.supabaseUrl + "/functions/v1/enemy-finder" : "";
  var STORE = "enemy-finder-v1";
  var EXIT_MS = 300;          // must match .card.leaving in the stylesheet
  var MAX_Q = 8;              // must match MAX_QUESTIONS in the function

  var S = null;               // the whole run, mirrored to localStorage
  var el = {};                // cached nodes
  var busy = false;

  // ── Boot ──────────────────────────────────────────────────────────────────
  document.addEventListener("DOMContentLoaded", function () {
    ["setup","setup-form","setup-err","resume","resume-go","resume-new","tool",
     "strip","strip-person","strip-problem","strip-pov","strip-edit","ask",
     "board","list-normal","list-consequence","count-normal","count-consequence",
     "actions","sharpen","sharpen-list","sharpen-closing","keep","keep-list",
     "keep-copy","keep-again"].forEach(function (id) {
      el[id] = document.getElementById(id);
    });

    autogrow(document.querySelectorAll("textarea"));
    el["setup-form"].addEventListener("submit", onSetup);
    el["strip-edit"].addEventListener("click", editSetup);
    el["keep-again"].addEventListener("click", startOver);
    el["keep-copy"].addEventListener("click", copyKeep);

    var saved = load();
    if (saved && saved.history && saved.history.length) {
      S = saved;
      el.resume.hidden = false;
      el["resume-go"].addEventListener("click", function () {
        el.resume.hidden = true;
        el.setup.hidden = true;
        el.tool.hidden = false;
        paintStrip();
        paintBoard(true);
        paintAsk();
        paintActions();
        el.tool.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      el["resume-new"].addEventListener("click", function () {
        el.resume.hidden = true;
        clear();
        S = null;
      });
    }
  });

  // ── Setup: the three blanks ───────────────────────────────────────────────
  function onSetup(e) {
    e.preventDefault();
    var f = el["setup-form"];
    var person = f.person.value.trim();
    var problem = f.problem.value.trim();
    var pov = f.pov.value.trim();

    if (!person || !problem) { setupErr("Fill in who you're writing to and what they're stuck on."); return; }
    if (!FN) { setupErr("The tool isn't connected yet. (Admin: fill in js/enemy-config.js.)"); return; }
    setupErr("");

    S = {
      id: uuid(),
      person: person, problem: problem, pov: pov,
      history: [],                                  // [{q, a}]
      board: { normal: [], consequence: [] },       // [{name, meaning, starred}]
      read: "", hint: firstHint(), question: firstQuestion(problem),
      stage: "dig", picks: null, closing: ""
    };
    save();

    el.resume.hidden = true;
    el.setup.hidden = true;
    el.tool.hidden = false;
    paintStrip();
    paintBoard(true);
    paintAsk();
    paintActions();
    el.tool.scrollIntoView({ behavior: "smooth", block: "start" });
    focusAnswer();
  }

  // Question one never needs the engine: the whole point is that it is always
  // the same question, so it lands instantly instead of after a spinner.
  function firstQuestion(problem) {
    var p = problem.replace(/\s+/g, " ").trim().replace(/[.?!]+$/, "");
    if (p.length > 90) return "What's the normal advice for the problem you just described?";
    return "What's the normal advice for " + lowerFirst(p) + "?";
  }
  function firstHint() { return "What does everyone in your world tell them to do?"; }
  function lowerFirst(s) {
    // Only soften a plain noun phrase. "AI" and "KDP" keep their shape.
    return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
  }

  function setupErr(msg) {
    el["setup-err"].textContent = msg;
    el["setup-err"].hidden = !msg;
  }

  function editSetup() {
    var f = el["setup-form"];
    f.person.value = S.person; f.problem.value = S.problem; f.pov.value = S.pov;
    autogrow(f.querySelectorAll("textarea"));
    el.tool.hidden = true;
    el.setup.hidden = false;
    el.setup.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function paintStrip() {
    el["strip-person"].textContent = S.person;
    el["strip-problem"].textContent = S.problem;
    el["strip-pov"].textContent = S.pov || "still working it out";
  }

  // ── The ask: exactly one question on screen ───────────────────────────────
  function paintAsk() {
    el.ask.innerHTML = "";
    if (S.stage !== "dig") return;

    var step = S.history.length + 1;
    var top = div("ask-top");
    top.appendChild(span("ask-step", "Question " + step));
    var dots = div("dots");
    for (var i = 1; i <= MAX_Q; i++) dots.appendChild(div("dot" + (i <= S.history.length ? " on" : "")));
    top.appendChild(dots);
    el.ask.appendChild(top);

    if (S.read) el.ask.appendChild(node("p", "read", S.read));
    el.ask.appendChild(node("h3", "", S.question));
    if (S.hint) el.ask.appendChild(node("p", "hint", S.hint));

    var ta = document.createElement("textarea");
    ta.id = "answer";
    ta.rows = 3;
    ta.placeholder = "Say it the way you'd say it out loud.";
    ta.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); onAnswer(); }
    });
    autogrow([ta]);
    el.ask.appendChild(ta);

    var err = node("p", "err", "");
    err.id = "ask-err";
    err.hidden = true;
    el.ask.appendChild(err);

    var row = div("ask-row");
    var next = button("btn btn-sm", step >= MAX_Q ? "Answer and finish" : "Next question");
    next.id = "ask-next";
    next.addEventListener("click", onAnswer);
    row.appendChild(next);
    row.appendChild(span("keys", "Or press " + (isMac() ? "\u2318" : "Ctrl") + " + Enter"));
    el.ask.appendChild(row);
  }

  function focusAnswer() {
    var ta = document.getElementById("answer");
    if (ta) ta.focus({ preventScroll: true });
  }

  function onAnswer() {
    if (busy) return;
    var ta = document.getElementById("answer");
    var text = (ta ? ta.value : "").trim();
    if (!text) { askErr("Give it a line or two. Anything is better than nothing."); return; }
    askErr("");
    S.history.push({ q: S.question, a: text });
    save();
    takeTurn(S.history.length >= MAX_Q);
  }

  function askErr(msg) {
    var err = document.getElementById("ask-err");
    if (!err) return;
    err.textContent = msg;
    err.hidden = !msg;
  }

  // ── A turn ────────────────────────────────────────────────────────────────
  function takeTurn(final) {
    setBusy(true, final ? "Pulling the whole list together\u2026" : "Reading that, and reworking the board\u2026");

    post({
      action: "turn",
      session_id: S.id,
      person: S.person, problem: S.problem, pov: S.pov,
      history: S.history,
      kept: flat(true),
      open: flat(false),
      final: !!final
    }).then(function (r) {
      S.read = r.read || "";
      S.question = r.question || "";
      S.hint = r.hint || "";
      if (final || !r.question) S.stage = "picks";
      save();

      merge(r);
      paintBoard(false);
      paintAsk();
      paintActions();
      if (S.stage === "picks") el.actions.scrollIntoView({ behavior: "smooth", block: "nearest" });
      else focusAnswer();
    }).catch(function (e) {
      // The answer is already in history, so put it back in the box and let
      // them send it again rather than making them retype it.
      var last = S.history.pop();
      save();
      paintAsk();
      var ta = document.getElementById("answer");
      if (ta && last) ta.value = last.a;
      autogrow(ta ? [ta] : []);
      askErr(e.message);
    }).then(function () { setBusy(false); });
  }

  function setBusy(on, msg) {
    busy = on;
    el.board.classList.toggle("busy", on);
    var next = document.getElementById("ask-next");
    if (next) { next.disabled = on; next.textContent = on ? "Working\u2026" : (S.history.length >= MAX_Q ? "Answer and finish" : "Next question"); }
    document.querySelectorAll("#actions button").forEach(function (b) { b.disabled = on; });

    var w = document.getElementById("working");
    if (w) w.remove();
    if (on) {
      var box = div("working");
      box.id = "working";
      box.appendChild(document.createElement("i"));
      box.appendChild(document.createTextNode(msg || "Working\u2026"));
      el.actions.parentNode.insertBefore(box, el.actions);
    }
  }

  // Fold the engine's lists into state, carrying every starred name through
  // untouched. The server does this too; doing it here as well means a starred
  // name survives even a garbled reply.
  function merge(r) {
    ["normal", "consequence"].forEach(function (list) {
      var kept = S.board[list].filter(function (n) { return n.starred; });
      var fresh = (r[list] || [])
        .filter(function (n) { return n && n.name && n.meaning; })
        .filter(function (n) { return !kept.some(function (k) { return same(k.name, n.name); }); })
        .map(function (n) { return { name: n.name, meaning: n.meaning, starred: false }; });
      S.board[list] = kept.concat(fresh);
    });
    save();
  }

  function flat(starred) {
    var out = [];
    ["normal", "consequence"].forEach(function (list) {
      S.board[list].forEach(function (n) {
        if (!!n.starred === starred) out.push({ name: n.name, meaning: n.meaning, list: list });
      });
    });
    return out;
  }

  // ── The board ─────────────────────────────────────────────────────────────
  // Two phases on purpose. Leavers collapse, and only once they're gone do the
  // newcomers rise. One pass would just look like the list blinking.
  function paintBoard(instant) {
    ["normal", "consequence"].forEach(function (list) {
      var host = el["list-" + list];
      var want = S.board[list];
      el["count-" + list].textContent = want.length
        ? want.length + " name" + (want.length === 1 ? "" : "s")
        : "";

      var have = {};
      Array.prototype.forEach.call(host.querySelectorAll(".card"), function (c) {
        if (!c.classList.contains("leaving")) have[c.dataset.key] = c;
      });
      var keys = want.map(function (n) { return key(n.name); });
      var leaving = Object.keys(have).filter(function (k) { return keys.indexOf(k) < 0; });

      if (instant || !leaving.length) { settle(host, want, have, instant); return; }

      leaving.forEach(function (k) {
        var c = have[k];
        c.style.height = c.offsetHeight + "px";
        void c.offsetHeight;                      // commit the height before collapsing
        c.classList.add("leaving");
        delete have[k];
      });
      setTimeout(function () {
        leaving.forEach(function (k) {
          var gone = host.querySelector('.card.leaving[data-key="' + cssEsc(k) + '"]');
          if (gone) gone.remove();
        });
        settle(host, want, have, false);
      }, EXIT_MS);
    });

    var empty = !S.board.normal.length && !S.board.consequence.length;
    document.querySelectorAll(".empty").forEach(function (n) { n.hidden = !empty; });
  }

  function settle(host, want, have, instant) {
    want.forEach(function (n, i) {
      var k = key(n.name);
      var card = have[k];
      if (card) {
        // A survivor keeps its place and its animation state. Only its class
        // and wording are refreshed, so "this one stayed" reads as staying.
        card.classList.remove("enter");
        var tag = card.querySelector(".tag-new");
        if (tag) tag.remove();
        paintCard(card, n);
      } else {
        card = buildCard(n, list(host));
        if (!instant) card.classList.add("enter");
        if (!instant) card.appendChild(span("tag tag-new", "New"));
      }
      var at = host.children[i];
      if (at !== card) host.insertBefore(card, at || null);
    });
  }

  function list(host) { return host === el["list-normal"] ? "normal" : "consequence"; }

  function buildCard(n, listName) {
    var card = div("card");
    card.dataset.key = key(n.name);
    card.dataset.list = listName;
    card.appendChild(node("div", "name", n.name));
    card.appendChild(node("p", "meaning", n.meaning));

    var star = button("star", "");
    star.type = "button";
    star.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.7l5.8-.8z"/></svg>';
    star.addEventListener("click", function () { toggleStar(card, listName, n.name, star); });
    card.appendChild(star);

    paintCard(card, n);
    return card;
  }

  function paintCard(card, n) {
    card.querySelector(".name").textContent = n.name;
    card.querySelector(".meaning").textContent = n.meaning;
    card.classList.toggle("starred", !!n.starred);
    var star = card.querySelector(".star");
    if (star) {
      star.setAttribute("aria-pressed", n.starred ? "true" : "false");
      star.title = n.starred ? "Kept. Click to let it go." : "Keep this one. It never leaves.";
      star.setAttribute("aria-label", star.title);
    }
    var kept = card.querySelector(".tag-kept");
    if (n.starred && !kept) card.appendChild(span("tag tag-kept", "Kept"));
    if (!n.starred && kept) kept.remove();
  }

  function toggleStar(card, listName, name, star) {
    var found = S.board[listName].filter(function (n) { return same(n.name, name); })[0];
    if (!found) return;
    found.starred = !found.starred;
    save();
    paintCard(card, found);
    star.classList.add("pop");
    setTimeout(function () { star.classList.remove("pop"); }, 190);
    paintActions();
  }

  // ── What they can do next ─────────────────────────────────────────────────
  function paintActions() {
    el.actions.innerHTML = "";
    if (!S) return;
    var stars = flat(true).length;

    if (S.stage === "dig") {
      if (S.history.length >= 2) {
        var full = button("btn btn-ghost", "I've got enough, show the full lists");
        full.addEventListener("click", function () { if (!busy) takeTurn(true); });
        el.actions.appendChild(full);
      }
    } else if (S.stage === "picks") {
      var sharpen = button("btn", stars ? "Sharpen my " + stars + " pick" + (stars === 1 ? "" : "s") : "Star the ones that hit");
      sharpen.disabled = !stars;
      sharpen.addEventListener("click", onSharpen);
      el.actions.appendChild(sharpen);
      if (!stars) el.actions.appendChild(span("keys", "Star a name to keep it for good."));
    } else if (S.stage === "done") {
      var again = button("btn btn-ghost", "Sharpen again");
      again.addEventListener("click", onSharpen);
      el.actions.appendChild(again);
    }

    var over = button("btn btn-ghost", "Start over");
    over.addEventListener("click", startOver);
    el.actions.appendChild(over);
  }

  // ── Sharpening ────────────────────────────────────────────────────────────
  function onSharpen() {
    if (busy) return;
    setBusy(true, "Holding your picks up to the light\u2026");
    post({
      action: "sharpen",
      session_id: S.id,
      person: S.person, problem: S.problem, pov: S.pov,
      history: S.history,
      picks: flat(true)
    }).then(function (r) {
      S.picks = r.picks || [];
      S.closing = r.closing || "";
      S.stage = "done";
      save();
      paintSharpen();
      paintKeep();
      paintActions();
      el.sharpen.scrollIntoView({ behavior: "smooth", block: "start" });
    }).catch(function (e) {
      var err = node("p", "err", e.message);
      el.actions.parentNode.insertBefore(err, el.actions);
      setTimeout(function () { err.remove(); }, 6000);
    }).then(function () { setBusy(false); });
  }

  function paintSharpen() {
    el["sharpen-list"].innerHTML = "";
    (S.picks || []).forEach(function (p) {
      var box = div("sharp");
      var head = div("sharp-head");
      head.appendChild(node("div", "sharp-name", p.name));
      head.appendChild(span("verdict-tag " + (p.lands ? "yes" : "no"), p.lands ? "This one has teeth" : "Not there yet"));
      box.appendChild(head);
      box.appendChild(node("p", "verdict", p.verdict));

      if (p.better) {
        var swap = div("swap");
        var left = document.createElement("div");
        left.appendChild(span("label", p.lands ? "Worth weighing" : "Sharper"));
        left.appendChild(node("div", "swap-name", p.better));
        if (p.better_meaning) left.appendChild(node("p", "swap-meaning", p.better_meaning));
        swap.appendChild(left);
        var use = button("btn btn-ghost", "Use this instead");
        use.addEventListener("click", function () { swapName(p, use); });
        swap.appendChild(use);
        box.appendChild(swap);
      }
      el["sharpen-list"].appendChild(box);
    });
    el["sharpen-closing"].textContent = S.closing || "";
    el["sharpen-closing"].hidden = !S.closing;
    el.sharpen.hidden = false;
  }

  function swapName(p, btn) {
    var listName = p.list === "consequence" ? "consequence" : "normal";
    var found = S.board[listName].filter(function (n) { return same(n.name, p.name); })[0];
    if (!found) return;
    found.name = p.better;
    found.meaning = p.better_meaning || found.meaning;
    p.name = p.better;
    save();
    paintBoard(false);
    paintKeep();
    btn.textContent = "Swapped";
    btn.disabled = true;
  }

  // ── What they walk away with ──────────────────────────────────────────────
  function paintKeep() {
    var picks = flat(true);
    el["keep-list"].innerHTML = "";
    picks.forEach(function (n, i) {
      var li = document.createElement("li");
      li.appendChild(node("div", "n", pad(i + 1)));
      var body = document.createElement("div");
      body.appendChild(node("div", "name", n.name));
      body.appendChild(node("p", "meaning", n.meaning));
      body.appendChild(node("div", "from", n.list === "consequence" ? "What gets them" : "The normal way"));
      li.appendChild(body);
      el["keep-list"].appendChild(li);
    });
    el.keep.hidden = !picks.length;
  }

  function copyKeep() {
    var picks = flat(true);
    var text = "THE ENEMY\n\n"
      + "Person:  " + S.person + "\nProblem: " + S.problem + "\nPOV:     " + (S.pov || "") + "\n\n"
      + picks.map(function (n) {
          return (n.list === "consequence" ? "[What gets them] " : "[The normal way] ") + n.name + "\n" + n.meaning;
        }).join("\n\n")
      + (S.closing ? "\n\n" + S.closing : "");
    var done = function () {
      el["keep-copy"].textContent = "Copied";
      setTimeout(function () { el["keep-copy"].textContent = "Copy all of this"; }, 1800);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, fallback);
    else fallback();
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0";
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand("copy"); done(); } catch (e) { /* nothing left to try */ }
      ta.remove();
    }
  }

  function startOver() {
    if (S && S.history.length && !confirm("Start over? Your answers and starred names go with it.")) return;
    clear();
    S = null;
    el.tool.hidden = true;
    el.sharpen.hidden = true;
    el.keep.hidden = true;
    el["setup-form"].reset();
    autogrow(el["setup-form"].querySelectorAll("textarea"));
    el.setup.hidden = false;
    el.setup.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // ── Wire ──────────────────────────────────────────────────────────────────
  // Both the apikey header AND a bearer token. A function deployed from the
  // dashboard has its JWT check switched on by default, and the gateway turns
  // away anything without an Authorization header before our own code ever
  // runs. The publishable key is itself a valid token, so sending it as the
  // bearer works whether that check is on or off.
  function post(payload) {
    if (!FN) return Promise.reject(new Error("The tool isn't connected yet. (Admin: fill in js/enemy-config.js.)"));
    var key = CFG.supabaseAnonKey || "";
    return fetch(FN, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: key,
        Authorization: "Bearer " + key
      },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(reason(r.status, b));
        return b;
      });
    }, function () {
      throw new Error("Couldn't reach the tool. Check your connection and try again.");
    });
  }

  // Anything our own code returns carries "error" and is already written for
  // the author. Anything else comes from the gateway in front of it, and a bare
  // "something went wrong" there just hides which of two setup steps is missing.
  function reason(status, body) {
    if (body && body.error) return body.error;
    var detail = (body && (body.message || body.msg || body.hint)) || "";
    console.error("[enemy-finder] HTTP " + status, body);
    if (status === 404) return "The idea engine isn't switched on yet. (Admin: deploy enemy-finder.)";
    if (status === 401 || status === 403) {
      return "The idea engine turned us away at the door. (Admin: switch off the JWT check on enemy-finder.)";
    }
    if (status === 429) return "That's a lot of digging in one hour. Come back a little later.";
    if (status >= 500) return "The idea engine hit a snag. Try that again in a moment.";
    return "Something went wrong" + (detail ? " (" + detail + ")" : " (" + status + ")") + ". Try that again.";
  }

  // ── Storage ───────────────────────────────────────────────────────────────
  function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) { /* private mode */ } }
  function clear() { try { localStorage.removeItem(STORE); } catch (e) { /* private mode */ } }
  function load() {
    try {
      var raw = localStorage.getItem(STORE);
      var s = raw ? JSON.parse(raw) : null;
      if (!s || !s.person || !s.board) return null;
      s.board.normal = s.board.normal || [];
      s.board.consequence = s.board.consequence || [];
      s.history = s.history || [];
      return s;
    } catch (e) { return null; }
  }

  // ── Small helpers ─────────────────────────────────────────────────────────
  function div(cls) { var n = document.createElement("div"); if (cls) n.className = cls; return n; }
  function span(cls, text) { var n = document.createElement("span"); n.className = cls; n.textContent = text; return n; }
  function node(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; n.textContent = text; return n; }
  function button(cls, text) { var n = document.createElement("button"); n.type = "button"; n.className = cls; n.textContent = text; return n; }
  function key(name) { return String(name).toLowerCase().replace(/[^a-z0-9]/g, ""); }
  function same(a, b) { return key(a) === key(b); }
  function cssEsc(s) { return s.replace(/["\\]/g, "\\$&"); }
  function pad(n) { return String(n).padStart(2, "0"); }
  function isMac() { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent); }
  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0;
      return (c === "x" ? r : (r & 0x3 | 0x8)).toString(16);
    });
  }
  function autogrow(nodes) {
    Array.prototype.forEach.call(nodes || [], function (ta) {
      if (!ta || ta.__grow) return;
      ta.__grow = true;
      var fit = function () { ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px"; };
      ta.addEventListener("input", fit);
      fit();
    });
  }
})();
