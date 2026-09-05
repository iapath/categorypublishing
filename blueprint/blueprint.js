/* Category Book Blueprint — editing, autosave and pagination.
   Every element with data-k is editable and persists to the open blueprint.
   Elements with data-chk toggle between an empty and a checked box.
   Fields sharing a data-k stay in sync (e.g. the client name). */
(function () {
  var nodes = function () { return Array.prototype.slice.call(document.querySelectorAll('[data-k]')); };

  /* The shell fills the document once a blueprint is open. Until then the page
     shows its own blank template, so nothing is lost if sign-in is cancelled. */
  var blank = null;
  window.CBBDoc = {
    hydrate: function (map) {
      if (blank === null) {
        blank = {};
        nodes().forEach(function (n) { blank[n.getAttribute('data-k')] = n.innerHTML; });
      }
      nodes().forEach(function (n) {
        var k = n.getAttribute('data-k');
        n.innerHTML = typeof map[k] === 'string' ? map[k] : blank[k];
      });
    },
    collect: collect
  };

  function collect() {
    var out = {};
    nodes().forEach(function (n) {
      var v = n.innerHTML.trim();
      if (v) out[n.getAttribute('data-k')] = v;
    });
    return out;
  }

  var t;
  function save() {
    if (window.CBB && window.CBB.project) window.CBB.saveFields(collect());
  }

  document.addEventListener('input', function (e) {
    var el = e.target.closest && e.target.closest('[data-k]');
    if (!el) return;
    var k = el.getAttribute('data-k');
    nodes().forEach(function (n) {
      if (n !== el && n.getAttribute('data-k') === k) n.innerHTML = el.innerHTML;
    });
    clearTimeout(t);
    t = setTimeout(save, 300);
  });

  document.addEventListener('paste', function (e) {
    var el = e.target.closest && e.target.closest('[contenteditable]');
    if (!el) return;
    e.preventDefault();
    var text = (e.clipboardData || window.clipboardData).getData('text/plain');
    document.execCommand('insertText', false, text);
  });

  document.addEventListener('click', function (e) {
    var box = e.target.closest && e.target.closest('[data-chk]');
    if (!box) return;
    box.innerHTML = box.textContent.trim() === '\u2610' ? '\u2611' : '\u2610';
    save();
  });

  /* doc-page detects its pages inside a requestAnimationFrame that can stay
     pending when the document loads in a hidden tab or iframe. Nudge it. */
  function kick() {
    document.querySelectorAll('doc-page').forEach(function (dp) {
      if (typeof dp._measure !== 'function' || !dp._sheet) return;
      dp._raf = null;
      try { dp._measure(); } catch (err) {}
    });
  }
  [0, 120, 400, 1200, 2500].forEach(function (ms) { setTimeout(kick, ms); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(kick);
  window.addEventListener('load', kick);
})();
