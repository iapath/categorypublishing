/* <image-slot> — drag-and-drop image placeholder for the standalone packet.
   Drop an image on it (or click to browse). The image is stored in
   localStorage against the slot's id, so it survives a reload.
   Attributes: id (required), shape, radius, fit (cover|contain), placeholder. */
(function () {
  var KEY = 'cbb.slots.v1';

  function read() {
    try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; }
  }
  function write(map) {
    try { localStorage.setItem(KEY, JSON.stringify(map)); } catch (e) {
      alert('This image is too large to store in the browser. Try a smaller file.');
    }
  }

  var CSS = [
    ':host{display:block;width:100%;height:100%;position:relative}',
    ':host([hidden]){display:none}',
    '.box{position:absolute;inset:0;overflow:hidden;background:#efeae6;',
    'border:1px dashed #b8b2ad;display:flex;align-items:center;justify-content:center;',
    'font:500 11px/1.4 Montserrat,system-ui,sans-serif;letter-spacing:.04em;color:#6c6a78;',
    'text-align:center;padding:8px;box-sizing:border-box;cursor:pointer;transition:background .18s ease}',
    '.box.filled{border-style:solid;border-color:transparent;background:transparent;cursor:default}',
    '.box.over{background:#fbe4ee;border-color:#E2006A;color:#E2006A}',
    'img{width:100%;height:100%;object-fit:cover;display:block}',
    'img.contain{object-fit:contain}',
    '.clear{position:absolute;top:6px;right:6px;border:0;border-radius:2px;background:rgba(13,22,84,.85);',
    'color:#fff;font:700 9px/1 Montserrat,system-ui,sans-serif;letter-spacing:.12em;padding:5px 7px;',
    'cursor:pointer;opacity:0;transition:opacity .18s ease}',
    ':host(:hover) .clear{opacity:1}',
    '@media print{.box{border:0;background:transparent}.clear{display:none}',
    '.box:not(.filled){border:1px solid #ddd7d2}}'
  ].join('');

  var ImageSlot = function () {};
  ImageSlot = class extends HTMLElement {
    connectedCallback() {
      if (this._built) return;
      this._built = true;
      var shape = this.getAttribute('shape') || 'rounded';
      var radius = this.getAttribute('radius');
      var r = shape === 'circle' ? '50%' : shape === 'pill' ? '999px'
        : shape === 'rect' ? '0' : (radius ? radius + 'px' : '12px');
      var fit = (this.getAttribute('fit') || 'cover') === 'contain' ? ' contain' : '';
      var ph = this.getAttribute('placeholder') || 'Drop an image';

      var root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>' + CSS + '</style>' +
        '<div class="box" style="border-radius:' + r + '">' +
        '<span class="ph"></span>' +
        '<button class="clear" type="button" hidden>REPLACE</button></div>' +
        '<input type="file" accept="image/*" hidden>';

      this._box = root.querySelector('.box');
      this._ph = root.querySelector('.ph');
      this._clear = root.querySelector('.clear');
      this._input = root.querySelector('input');
      this._fit = fit;
      this._ph.textContent = ph;

      var self = this;
      this._box.addEventListener('click', function () { self._input.click(); });
      this._clear.addEventListener('click', function (e) {
        e.stopPropagation();
        self._input.click();
      });
      this._input.addEventListener('change', function () {
        if (self._input.files && self._input.files[0]) self._load(self._input.files[0]);
      });
      ['dragenter', 'dragover'].forEach(function (evt) {
        self._box.addEventListener(evt, function (e) {
          e.preventDefault();
          self._box.classList.add('over');
        });
      });
      ['dragleave', 'dragend'].forEach(function (evt) {
        self._box.addEventListener(evt, function () { self._box.classList.remove('over'); });
      });
      this._box.addEventListener('drop', function (e) {
        e.preventDefault();
        self._box.classList.remove('over');
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) self._load(f);
      });

      var stored = read()[this.id];
      if (stored) this._show(stored);
      else if (this.getAttribute('src')) this._show(this.getAttribute('src'), true);
    }

    _load(file) {
      if (!/^image\//.test(file.type)) return;
      var self = this;
      var fr = new FileReader();
      fr.onload = function () {
        var map = read();
        if (self.id) { map[self.id] = fr.result; write(map); }
        self._show(fr.result);
      };
      fr.readAsDataURL(file);
    }

    _show(src, transient) {
      var img = this._box.querySelector('img');
      if (!img) {
        img = document.createElement('img');
        this._box.insertBefore(img, this._clear);
      }
      img.className = this._fit.trim();
      img.src = src;
      this._ph.hidden = true;
      this._box.classList.add('filled');
      this._clear.hidden = !!transient ? false : false;
    }
  };

  if (!customElements.get('image-slot')) customElements.define('image-slot', ImageSlot);
})();
