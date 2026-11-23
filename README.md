# LMC Academy

"Going the Last Mile", the Last Mile Climate handbook, as 20 short learning journeys.
Each module: **Departure** (make a guess) → **The journey** (cards and quick checks) → **Checkpoint** (real cases, "how sure are you?") → **Arrival** (sign-off or a real action, plus a passport stamp). **Postcards** with two questions arrive 1 and 4 weeks later.

People sign in with their work email (email link, no password). Admins see a team dashboard: progress per person and module, time, scores, policy sign-offs, postcards, "confidently wrong" answers, and a CSV export.

- App: plain HTML/CSS/JS (`index.html`, `app.css`, `app.js`), hosted on GitHub Pages.
- Sign-in and data: Firebase Authentication (email link) and Firestore (EU), protected by `firestore.rules`.
- The handbook content is **not** in this repository. An admin loads it from a private `content.json` (Admin → Content).

Setup: see [SETUP.md](SETUP.md). Tests: `cd tests && npm install && npm test` (Firebase emulators + Playwright).

Made by miehs consulting for Last Mile Climate.
