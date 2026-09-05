# /shelf-finder — Shelf Finder

Free category finder for your book. Serves at
**categorypublishing.com/shelf-finder**.

Drop the files in and Netlify publishes them as-is — no build step, same as
`/articles/`, `/blueprint` and `/book-marketing`.

| Put | Where |
|---|---|
| The tool | `shelf-finder/index.html` |
| Images | `shelf-finder/assets/` — reference as `assets/<name>` |
| Extra CSS/JS | `shelf-finder/` — reference as `<name>.css` |

Lowercase filenames with hyphens: `Hero-Image.PNG` works on a Mac and 404s on
Netlify.

Delete this README once the tool is in.

## Two things I'll check once it's loaded

- **Metadata.** If it's a Claude Design bundle like `/book-marketing`, its head
  will say "Bundled Page" and the unpacker will wipe whatever is only in the
  outer head. That needs fixing in both heads, plus the favicon and the
  placeholder logo.
- **Where the leads go.** A free tool wants somewhere to send people afterwards.
  Tell me if it should collect emails, and whether it points at the Lazy Book
  Marketing System or a call.
