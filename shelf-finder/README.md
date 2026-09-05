# The Shelf Finder — static site export

    index.html            Landing page (opt-in). Anchor #gate is the form.
    results.html          On-site results page the email links to.
    email/results.html    Teaser email, table-based, 600px, inline styles.
    css/shelf-finder.css  All page styles + Smart Publishing Studio tokens.
    js/shelf-finder.js    File-name display, form submit + confirmation, copy-path buttons.

Fonts load from Google Fonts: Bebas Neue (display), Montserrat (body), JetBrains Mono (KDP paths).

## Wiring it up

1. Landing form posts multipart to `/api/shelf-finder` (change `action` on `#shelf-form`).
   Fields: `manuscript` (file, optional), `summary` (text, optional), `email` (required),
   `source` (hidden, `shelf-finder`). One of manuscript/summary is required — enforced client
   and server side.
2. On success the JS swaps the form for the "Check your inbox." panel. No redirect.
3. Your endpoint runs the tool, stores the three categories against a token, tags the contact
   `source = shelf-finder`, and sends the email.
4. Email template placeholders: `{{first_name}}`, `{{results_url}}`, `{{blueprint_url}}`,
   `{{unsubscribe_url}}`. `results_url` = `results.html?t=TOKEN`, live 30 days.
5. results.html carries sample categories. Render the three cards server side (or fetch by token)
   using the same markup: `.res-card` with name, rank line, KDP path, and "why it fits".
   The `data-copy` attribute holds the plain-text path for the copy button.

## Language rules

No specific sales figures anywhere. The only claim is that #1 takes under 20 sales a day based on
historical data research. Never claim guaranteed bestseller status.
