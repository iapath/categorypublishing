// Shelf Finder landing page behavior
document.addEventListener('DOMContentLoaded', function () {
  var form = document.getElementById('shelf-form');
  var done = document.getElementById('shelf-done');
  var file = document.getElementById('manuscript');
  var name = document.getElementById('file-name');
  var again = document.getElementById('shelf-again');

  if (file) file.addEventListener('change', function () {
    name.textContent = file.files && file.files[0] ? file.files[0].name : 'No file chosen';
  });

  if (form) form.addEventListener('submit', function (e) {
    e.preventDefault();
    var summary = form.summary.value.trim();
    if (!summary && !(file.files && file.files.length)) {
      alert('Upload your manuscript or paste a summary.');
      return;
    }
    // POST to your endpoint. It should run the tool and send the email.
    fetch(form.action, { method: 'POST', body: new FormData(form) }).catch(function () {});
    form.hidden = true;
    done.hidden = false;
  });

  if (again) again.addEventListener('click', function () {
    form.reset();
    name.textContent = 'No file chosen';
    done.hidden = true;
    form.hidden = false;
  });

  // Copy buttons on the results page
  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var text = btn.getAttribute('data-copy');
      if (navigator.clipboard) navigator.clipboard.writeText(text);
      var old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = old; }, 1800);
    });
  });
});
