# CategoryPublishing.com

Static site. No build step, no dependencies — Netlify serves this folder as-is.

## Structure

```
index.html                              Home page (single 1440px canvas, scales down on narrow screens)
articles/index.html                     Article index
articles/<slug>/index.html              One folder per article
assets/                                 Images, logos, book covers
netlify.toml                            Cache headers + publish config
robots.txt / sitemap.xml                SEO
```

## Adding an article

1. Copy `articles/category-abandonment/` to `articles/your-slug/`
2. Edit `index.html` inside it — replace the `<h1>`, the `.meta` byline, and the body copy
3. Add a `.card` link for it in `articles/index.html`
4. Add its URL to `sitemap.xml`
5. Commit and push — Netlify deploys automatically

All article styling lives in the `<style>` block of each article file: headings, paragraphs, lists, and `<blockquote>` pull quotes are already handled.

## Netlify setup

1. Netlify → Add new site → Import an existing project → GitHub → this repo
2. Build command: leave empty. Publish directory: `/` (or the folder this README sits in)
3. Domain settings → Add custom domain → `categorypublishing.com`
4. Point your DNS at Netlify (either their nameservers, or an ALIAS/A record to their load balancer)

Every push to `main` redeploys.

## Brand

| | |
|---|---|
| Deep navy | `#0D0B2A` |
| Hot pink | `#E91E75` / `#E2006A` on light |
| Violet | `#7C5CE0` |
| Lavender text | `#C9C5E4` |
| Gold (milestones only) | `#E2C46A` |
| Display face | Bebas Neue |
| Everything else | Montserrat 400/500/600/700/800 |

## Home page note

The home page is one fixed 1440px canvas that scales proportionally below that width. It is not a reflowing responsive layout — on phones it renders as a scaled-down version of the desktop design. A true mobile layout is a separate build.
