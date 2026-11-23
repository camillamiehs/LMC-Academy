# LMC Academy: setup (about 10 minutes, free)

Everything runs on what you already have: **GitHub** for the website, and **Google Sheets + Apps Script** in your Google account for sign-in and progress. No new accounts, no plans to pay for.

## 1. Switch on the website (1 minute)

In **github.com/camillamiehs/LMC-Academy** → **Settings** → **Pages** → under "Branch" choose **main** and **/ (root)** → **Save**.
The site will be at **https://camillamiehs.github.io/LMC-Academy/**

## 2. Create the Google Sheet with the script (5 minutes)

1. Go to **sheets.new** (a new Google Sheet). Name it **LMC Academy**.
2. Menu **Extensions → Apps Script**. A code editor opens.
3. Delete everything in the editor, and paste the whole of **apps-script/Code.gs** (I'll send it to you). Click the **save** icon.
4. At the top, next to "Debug", pick **setup** in the function list and click **▶ Run**.
   Google asks for permission: **Review permissions → your account → Advanced → Go to LMC Academy (unsafe) → Allow.**
   ("Unsafe" only means Google hasn't reviewed your own script. It asks to manage the sheet, send email as you and store one file in your Drive.)
5. Click **Deploy → New deployment** → the gear icon → **Web app**.
   - Description: `LMC Academy`
   - Execute as: **Me**
   - Who has access: **Anyone**
   - Click **Deploy**, then copy the **Web app URL** (it ends in `/exec`).
6. **Send me that URL.** I put it in the website (it's not a password: every request still needs a signed-in, invited person).

Your Sheet now has two tabs: **Invites** (you're already in it as admin) and **Progress**.

## 3. Load the content and invite the team (3 minutes)

1. Open **https://camillamiehs.github.io/LMC-Academy/** and sign in with the same email as your Google account. The link arrives by email.
2. You land on **Admin → Content**. Load **content.json** (I sent it; keep it private).
3. **Admin → Invite people**: paste `Name, email` lines. Make Jakob and Brian **Admin**. You can also type rows straight into the **Invites** tab (Role = `learner` or `admin`).
4. Post the link in Teams. Done.

## Good to know

- **Sign-in emails and postcard reminders** come from your Google account, with the sender name "LMC Academy". A free Google account can send about 100 a day; Workspace about 1,500.
- **Postcard reminders** go out once a day at about 8:00 when a postcard is due (set up by `setup`).
- **The Progress tab** is readable: one row per person per module, with status, dates, minutes, score, signature, postcards and documents opened. The last column holds the full data the app needs; please don't edit it.
- **Who sees what:** learners see only their own progress in the app; admins see everyone's. Only people in the Invites tab can sign in. Removing someone there stops their access on their next visit.
- **Updating content:** I regenerate content.json; you load it again on Admin → Content. Progress is kept.
- **Changing the script later:** after pasting a new version, use **Deploy → Manage deployments → edit (pencil) → Version: New version → Deploy**. The URL stays the same.
- **Tests:** `cd tests && npm test` runs the whole app against a local stand-in for Google Apps Script.
