# LMC Academy

"Going the Last Mile", the Last Mile Climate handbook, as 20 short learning journeys.
Each module: **Departure** (make a guess) → **The journey** (cards and quick checks) → **Checkpoint** (real cases, "how sure are you?") → **Arrival** (sign-off or a real action, plus a passport stamp). **Postcards** with two questions arrive 1 and 4 weeks later.

People sign in with their work email (email link, no password). Admins see a team dashboard: progress per person and module, time, scores, policy sign-offs, postcards, "confidently wrong" answers, and a CSV export.

- App: plain HTML/CSS/JS (`index.html`, `app.css`, `app.js`, `config.js`), hosted on GitHub Pages.
- Sign-in and data: a Google Apps Script web app bound to a Google Sheet (`apps-script/Code.gs`): Invites and Progress tabs, signed email-link tokens, daily postcard reminder emails.
- The handbook content is **not** in this repository. An admin loads it from a private `content.json` (Admin → Content).

Setup: see [SETUP.md](SETUP.md). Tests: `cd tests && npm test` (a local Apps Script stand-in + Playwright).

Made by miehs consulting for Last Mile Climate.
