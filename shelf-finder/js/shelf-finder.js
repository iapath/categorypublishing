/* Shelf Finder — landing page and results page behaviour.

   Submitting is two steps on purpose. A manuscript can be 25 MB, so it goes
   straight to storage through a one-time signed URL rather than through the
   function, and the results email only fires once the categories exist. */
(function () {
  var CFG = window.SHELF_CONFIG || {};
  var FN = CFG.supabaseUrl ? CFG.supabaseUrl + "/functions/v1/shelf-finder" : "";

  function post(payload) {
    return fetch(FN, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: CFG.supabaseAnonKey || "" },
      body: JSON.stringify(payload)
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (b) {
        if (!r.ok) throw new Error(b.error || "Something went wrong. Try again.");
        return b;
      });
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    wireForm();
    wireResults();
    wireCopyButtons();
  });

  // ── Landing page ──────────────────────────────────────────────────────────
  function wireForm() {
    var form = document.getElementById('shelf-form');
    if (!form) return;
    var done = document.getElementById('shelf-done');
    var file = document.getElementById('manuscript');
    var name = document.getElementById('file-name');
    var again = document.getElementById('shelf-again');
    var button = form.querySelector('button[type=submit]');
    var err = document.createElement('p');
    err.style.cssText = 'color:#ff7ba8;font-weight:700;margin:0';
    err.hidden = true;
    form.insertBefore(err, button);

    if (file) file.addEventListener('change', function () {
      name.textContent = file.files && file.files[0] ? file.files[0].name : 'No file chosen';
    });

    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      err.hidden = true;
      var summary = form.summary.value.trim();
      var chosen = file && file.files && file.files[0];
      if (!summary && !chosen) { fail('Upload your manuscript or paste a summary.'); return; }
      if (chosen && chosen.size > 25 * 1024 * 1024) { fail('That file is over 25 MB.'); return; }
      if (!FN) { fail("The tool isn't connected yet. (Admin: fill in js/shelf-config.js.)"); return; }

      button.disabled = true;
      button.textContent = chosen ? 'Uploading…' : 'Reading your book…';
      try {
        var started = await post({
          action: 'start', email: form.email.value.trim(), summary: summary,
          file_name: chosen ? chosen.name : '', file_size: chosen ? chosen.size : 0
        });

        if (chosen && started.upload_url) {
          var put = await fetch(started.upload_url, {
            method: 'PUT',
            headers: { 'content-type': chosen.type || 'application/octet-stream' },
            body: chosen
          });
          if (!put.ok) throw new Error("That file didn't upload. Try again, or paste a summary.");
        }

        button.textContent = 'Reading your book…';
        await post({ action: 'run', token: started.token });

        form.hidden = true;
        done.hidden = false;
      } catch (e2) {
        fail(e2.message);
      } finally {
        button.disabled = false;
        button.textContent = 'Send My Categories';
      }
    });

    function fail(msg) { err.textContent = msg; err.hidden = false; }

    if (again) again.addEventListener('click', function () {
      form.reset();
      if (name) name.textContent = 'No file chosen';
      err.hidden = true;
      done.hidden = true;
      form.hidden = false;
    });
  }

  // ── Results page ──────────────────────────────────────────────────────────
  function wireResults() {
    var list = document.getElementById('res-list');
    if (!list) return;
    var token = new URLSearchParams(location.search).get('t');
    if (!token) { message(list, 'That link is missing its code.', 'Use the button in your email.'); return; }
    if (!CFG.supabaseUrl) { message(list, 'Not connected yet.', '(Admin: fill in js/shelf-config.js.)'); return; }

    fetch(CFG.supabaseUrl + '/rest/v1/rpc/get_shelf_results', {
      method: 'POST',
      headers: { 'content-type': 'application/json', apikey: CFG.supabaseAnonKey, Authorization: 'Bearer ' + CFG.supabaseAnonKey },
      body: JSON.stringify({ p_token: token })
    }).then(function (r) { return r.json(); }).then(function (rows) {
      var run = Array.isArray(rows) ? rows[0] : rows;
      if (!run) { message(list, 'This link has expired.', 'Results stay live for 30 days. Run your book again any time.'); return; }
      if (run.status !== 'ready') {
        message(list, 'Still reading your book.', 'Refresh in a minute — this page updates when the categories are in.');
        return;
      }
      paint(list, run);
    }).catch(function () {
      message(list, "Couldn't load your results.", 'Check your connection and refresh.');
    });
  }

  function paint(list, run) {
    document.querySelectorAll('[data-fill="first_name"]').forEach(function (n) {
      n.textContent = run.first_name || 'you';
    });
    document.querySelectorAll('[data-fill="date"]').forEach(function (n) {
      n.textContent = new Date(run.created_at).toLocaleDateString(undefined,
        { year: 'numeric', month: 'long', day: 'numeric' });
    });

    var tpl = list.querySelector('.res-card');
    var cards = (run.results || []).map(function (r, i) {
      var el = tpl.cloneNode(true);
      set(el, '.res-num', String(i + 1).padStart(2, '0'));
      set(el, '.res-name', r.name);
      set(el, '.res-rank', r.rank_line || '');
      set(el, '.res-path', r.path);
      set(el, '.res-why', r.why);
      var btn = el.querySelector('.copy');
      if (btn) btn.setAttribute('data-copy', r.path);
      return el;
    });
    list.innerHTML = '';
    if (!cards.length) {
      message(list, 'No clean fit this time.', 'Send a fuller summary and run it again.');
      return;
    }
    cards.forEach(function (c) { list.appendChild(c); });
    wireCopyButtons();
  }

  function set(root, sel, text) {
    var n = root.querySelector(sel);
    if (n && text != null) n.textContent = text;
  }

  function message(list, head, sub) {
    list.innerHTML = '';
    var box = document.createElement('div');
    box.style.cssText = 'padding:40px 0;text-align:center';
    var h = document.createElement('div');
    h.style.cssText = 'font-family:var(--font-display,inherit);font-size:34px;line-height:1;text-transform:uppercase;color:#fff;margin-bottom:10px';
    h.textContent = head;
    var p = document.createElement('p');
    p.style.cssText = 'color:#b8b4d9;margin:0';
    p.textContent = sub;
    box.appendChild(h); box.appendChild(p);
    list.appendChild(box);
  }

  // ── Copy path buttons ─────────────────────────────────────────────────────
  function wireCopyButtons() {
    document.querySelectorAll('[data-copy]').forEach(function (btn) {
      if (btn.__wired) return;
      btn.__wired = true;
      btn.addEventListener('click', function () {
        var text = btn.getAttribute('data-copy');
        if (navigator.clipboard) navigator.clipboard.writeText(text);
        var old = btn.textContent;
        btn.textContent = 'Copied';
        setTimeout(function () { btn.textContent = old; }, 1800);
      });
    });
  }
})();
