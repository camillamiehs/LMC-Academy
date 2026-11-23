# LMC Academy: one-time setup (about 15 minutes)

You do this once. After that, the team only needs the link, and Claude can update the app for you.

## 1. Create the GitHub repository (1 minute)

1. Go to **github.com/new**.
2. Name: **lmc-academy**. Choose **Public**. Don't add a README. Click **Create repository**.
3. Tell Claude. Claude uploads the app (without the handbook content, which stays private).
4. In the repo: **Settings → Pages → Deploy from a branch → main / (root) → Save**.
   The app will live at **https://camillamiehs.github.io/lmc-academy/**

Also make sure the Claude GitHub app can see the new repo: **github.com/settings/installations → Claude → Configure → add lmc-academy**.

## 2. Create the Firebase project (10 minutes)

Firebase is Google's service for sign-in and the progress database. Use your Google account.

1. Go to **console.firebase.google.com** → **Create a project**. If you already have a Google Cloud project you want to use, pick it under **"Add Firebase to a Google Cloud project"**. Otherwise name a new one **lmc-academy**. Google Analytics: **off**.
2. **Upgrade to the Blaze plan** (bottom-left, "Upgrade"). If your Google Cloud already has a billing account, just select it. At our size it costs **0 USD**.
   Why: the free plan only sends **5 sign-in emails a day**, which isn't enough for 15 people on launch day.
   Then set a budget alert: Google Cloud → Billing → Budgets & alerts → **1 USD**, so you're warned if anything ever costs money.
3. **Sign-in:** Build → **Authentication** → Get started → **Email/Password** → turn on **Email link (passwordless sign-in)** → Save.
   Then Authentication → **Settings → Authorized domains → Add domain** → `camillamiehs.github.io`.
4. **Database:** Build → **Firestore Database** → Create database → location **europe-west1 (Belgium)** or another **EU** region → **Production mode**.
5. **Security rules:** Firestore → **Rules** tab → delete what's there → paste the contents of `firestore.rules` from the repo → **Publish**.
6. **Make yourself admin:** Firestore → **Data** → **Start collection**
   - Collection ID: `allow`
   - Document ID: your email in lower case (the one you'll sign in with)
   - Fields: `name` (string) = your name, `role` (string) = `admin`
   - Save.
7. **Web app config:** Project settings (gear icon) → **Your apps** → **Web** (`</>`) → nickname `lmc-academy` → Register (no hosting).
   Copy the `firebaseConfig` block (apiKey, authDomain, projectId, appId) and **paste it to Claude**. It isn't a password.

## 3. Load the content and invite the team (3 minutes)

1. Open **https://camillamiehs.github.io/lmc-academy/** and sign in with your email (you'll get a link).
2. You land on **Admin → Content**. Load the **content.json** file Claude sent you. Keep that file private: it holds the handbook content.
3. **Admin → Invite people**: paste one person per line, `Name, email`. Make Jakob and Brian **Admin** with the single-invite form.
4. Post the link in Teams. Done.

## Good to know

- **Who sees what:** everyone sees only their own progress. Admins see everyone's. Only invited emails can sign in and read the content.
- **Data location:** the EU (Firestore region you chose). Google is the data processor under Firebase's data processing terms.
- **Updating content:** Claude regenerates `content.json`, and you load it again on Admin → Content. Progress is kept.
- **Postcards:** they appear in the app (Journey and Postcards tabs) 7 and 28 days after a module. The app doesn't send emails; use "Copy not-finished list" in Admin to nudge people in Teams.
- **Testing:** `cd tests && npm install && npm test` runs the full test against local Firebase emulators.
