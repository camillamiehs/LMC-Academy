/* End-to-end test of LMC Academy against the Firebase emulators (Auth + Firestore) with the real security rules.
   Run from tests/:  npm test   (wraps: firebase emulators:exec --project demo-lmc "node academy-e2e.js")
   Needs ../private/content.json (the private handbook content). Screenshots go to tests/shots/. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const ROOT = path.resolve(__dirname, '..'), NM = path.join(__dirname, 'node_modules');
const OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const PROJECT = 'demo-lmc', AUTH = 'http://127.0.0.1:9099', FS = 'http://127.0.0.1:8080';
const CONTENT = path.join(ROOT, 'private', 'content.json');
const content = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));
const errs = [], checks = [];
function ok(cond, msg) { checks.push((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) errs.push(msg); }
const DAY = 86400000;

async function req(method, url, body, headers) {
  const r = await fetch(url, { method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); try { return JSON.parse(t); } catch (e) { return t; }
}
async function seedInvite(email, name, role) { // bypasses rules with the emulator's owner token
  await req('PATCH', `${FS}/v1/projects/${PROJECT}/databases/(default)/documents/allow/${encodeURIComponent(email)}`,
    { fields: { name: { stringValue: name }, role: { stringValue: role }, invitedAt: { integerValue: String(Date.now()) } } }, { Authorization: 'Bearer owner' });
}
async function oobLink(email) {
  for (let k = 0; k < 20; k++) {
    const r = await req('GET', `${AUTH}/emulator/v1/projects/${PROJECT}/oobCodes`);
    const c = (r.oobCodes || []).filter(o => o.email === email && o.requestType === 'EMAIL_SIGNIN').pop();
    if (c) return c.oobCode; await new Promise(r => setTimeout(r, 300));
  }
  throw new Error('no sign-in email for ' + email);
}

(async () => {
  await req('DELETE', `${FS}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`);
  await req('DELETE', `${AUTH}/emulator/v1/projects/${PROJECT}/accounts`);
  await seedInvite('camilla.test@example.org', 'Camilla Test', 'admin');
  await seedInvite('amani@example.org', 'Amani Kibet', 'learner');

  const server = http.createServer((q, s) => {
    const u = decodeURIComponent(q.url.split('?')[0]); let f = u === '/' ? '/index.html' : u;
    if (f === '/firebase-config.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(`window.LMC_FIREBASE={apiKey:"fake-key",authDomain:"127.0.0.1",projectId:"${PROJECT}",appId:"test"};window.LMC_EMULATOR={auth:"${AUTH}",firestore:["127.0.0.1",8080]};`); }
    const p = path.join(ROOT, f); if (!p.startsWith(ROOT) || !fs.existsSync(p) || f.startsWith('/private')) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); s.end(fs.readFileSync(p));
  }).listen(8124, '127.0.0.1');
  const BASE = 'http://127.0.0.1:8124/';

  const browser = await chromium.launch();
  async function user(name, vp) {
    const ctx = await browser.newContext({ viewport: vp || { width: 1280, height: 900 }, acceptDownloads: true });
    await ctx.route('https://www.gstatic.com/firebasejs/**', r => { const f = r.request().url().split('/').pop(); r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(NM, 'firebase', f)) }); });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_NAME|Failed to load resource/.test(m.text())) errs.push(name + ' console: ' + m.text().slice(0, 200)); });
    return p;
  }
  async function signIn(p, email) {
    await p.goto(BASE); await p.waitForSelector('#em'); await p.fill('#em', email); await p.click('#send');
    await p.waitForSelector('text=Check your inbox');
    const code = await oobLink(email);
    await p.goto(BASE + '?mode=signIn&oobCode=' + code + '&apiKey=fake-key&lang=en');
  }
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

  /* 1. Admin loads the content and invites someone */
  const admin = await user('admin');
  await signIn(admin, 'camilla.test@example.org');
  await admin.waitForSelector('#file', { timeout: 15000 });
  ok(await admin.isVisible('text=No content loaded yet'), 'admin is sent to the content tab when nothing is loaded');
  await admin.setInputFiles('#file', CONTENT);
  await admin.waitForSelector('text=Loaded version', { timeout: 10000 });
  ok(true, 'admin loaded content.json (' + content.modules.length + ' modules)');
  await admin.goto(BASE + '#admin/invite'); await admin.waitForSelector('#bulk');
  await admin.fill('#bulk', 'Grace Test, grace@example.org');
  await admin.click('#addbulk'); await admin.waitForSelector('text=grace@example.org');
  ok(true, 'admin invited a person in bulk');
  await shot(admin, '01-admin-invite');

  /* 2. A person who isn't invited gets a clear message, and can't read content */
  const stranger = await user('stranger');
  await signIn(stranger, 'stranger@example.org');
  await stranger.waitForSelector('text=Not on the list yet', { timeout: 15000 });
  const strangerRead = await stranger.evaluate(() => firebase.firestore().collection('content').doc('current').get().then(() => 'allowed', e => e.code));
  ok(strangerRead === 'permission-denied', 'stranger cannot read content (' + strangerRead + ')');

  /* 3. Learner on a phone: journey, then module 3.1 with one confidently-wrong case, sign-off */
  const amani = await user('amani', { width: 390, height: 844 });
  await signIn(amani, 'amani@example.org');
  await amani.waitForSelector('.road', { timeout: 15000 });
  await shot(amani, '02-learner-journey');
  const m31 = content.modules.find(m => m.id === '3.1');
  await amani.goto(BASE + '#m/3.1'); await amani.waitForSelector('[data-g]');
  await amani.click('[data-g="0"]'); await amani.click('#nx');                 // departure: wrong guess
  for (const [i, s] of m31.steps.entries()) {
    if (s.type === 'card') { await amani.click('#nx'); continue; }
    if (s.type === 'check') { await amani.click(`[data-k="${s.a}"]`); await amani.click('#nx'); continue; }
    if (s.type === 'case') {
      const wrong = i === m31.steps.findIndex(x => x.type === 'case');        // first case: wrong and certain
      await amani.click(`[data-c="${wrong ? (s.a + 1) % s.opts.length : s.a}"]`); await amani.click(`[data-f="${wrong ? 2 : 1}"]`);
      if (wrong) await shot(amani, '03-learner-case-before');
      await amani.click('#chk'); if (wrong) await shot(amani, '04-learner-case-after');
      await amani.click('#nx');
    }
  }
  await amani.waitForSelector('text=Checkpoint passed'); ok(await amani.isVisible('text=4 of 5 right'), 'checkpoint scores 4 of 5 and passes at 80%');
  await amani.click('#nx'); await amani.waitForSelector('#ok');
  await amani.check('#ok'); await amani.fill('#nm', 'Amani Kibet'); await shot(amani, '05-learner-sign');
  await amani.click('#fin'); await amani.waitForSelector('text=Welcome to your next stop');
  await shot(amani, '06-learner-arrival');

  /* 4. Learner completes 0.1 (action arrival) after a failed checkpoint and a retry */
  const m01 = content.modules.find(m => m.id === '0.1');
  await amani.goto(BASE + '#m/0.1'); await amani.waitForSelector('[data-g]');
  await amani.click(`[data-g="${m01.departure.a}"]`); await amani.click('#nx');
  async function playSteps(m, allWrong) {
    for (const s of m.steps) {
      if (s.type === 'card') { await amani.click('#nx'); continue; }
      const pick = allWrong ? (s.a + 1) % s.opts.length : s.a;
      if (s.type === 'check') { await amani.click(`[data-k="${pick}"]`); await amani.click('#nx'); }
      if (s.type === 'case') { await amani.click(`[data-c="${pick}"]`); await amani.click('[data-f="0"]'); await amani.click('#chk'); await amani.click('#nx'); }
    }
  }
  await playSteps(m01, true);
  await amani.waitForSelector('#retry'); ok(await amani.isVisible('text=Almost there: 0 of 5'), 'a failed checkpoint asks for a retry');
  await amani.click('#retry');
  // retry starts at the first check: play the rest correctly (cards in between)
  for (const s of m01.steps.slice(1)) {
    if (s.type === 'card') { await amani.click('#nx'); continue; }
    if (s.type === 'check') { await amani.click(`[data-k="${s.a}"]`); await amani.click('#nx'); }
    if (s.type === 'case') { await amani.click(`[data-c="${s.a}"]`); await amani.click('[data-f="2"]'); await amani.click('#chk'); await amani.click('#nx'); }
  }
  await amani.waitForSelector('text=Checkpoint passed'); await amani.click('#nx');
  for (const cb of await amani.$$('.item input')) await cb.check();
  await amani.click('#fin'); await amani.waitForSelector('text=Welcome to your next stop');
  ok(true, 'learner finished an action-type module after one retry');

  /* 5. Rules: a learner can't read others' progress or change content or invites */
  const adminUid = await admin.evaluate(() => firebase.auth().currentUser.uid);
  const r1 = await amani.evaluate(u => firebase.firestore().collection('progress').doc(u).get().then(() => 'allowed', e => e.code), adminUid);
  const r2 = await amani.evaluate(() => firebase.firestore().collection('content').doc('current').set({ version: 'x', json: '{}' }).then(() => 'allowed', e => e.code));
  const r3 = await amani.evaluate(() => firebase.firestore().collection('allow').doc('evil@example.org').set({ name: 'x', role: 'admin' }).then(() => 'allowed', e => e.code));
  const r4 = await amani.evaluate(u => firebase.firestore().collection('progress').doc(u).set({ email: 'amani@example.org', modules: {} }).then(() => 'allowed', e => e.code), adminUid);
  ok(r1 === 'permission-denied', 'learner cannot read another person\'s progress (' + r1 + ')');
  ok(r2 === 'permission-denied', 'learner cannot change the content (' + r2 + ')');
  ok(r3 === 'permission-denied', 'learner cannot invite people or make admins (' + r3 + ')');
  ok(r4 === 'permission-denied', 'learner cannot write someone else\'s progress (' + r4 + ')');

  /* 6. Passport, then 8 days later: postcard turns the 3.1 stamp gold */
  await amani.goto(BASE + '#passport'); await amani.waitForSelector('.stamps');
  ok((await amani.$$('.stamp:not(.empty)')).length === 2, 'passport shows 2 stamps');
  await shot(amani, '07-learner-passport');
  await amani.evaluate(ms => localStorage.setItem('lmcShift', String(ms)), 8 * DAY);
  await amani.goto(BASE + '#journey'); await amani.reload(); await amani.waitForSelector('.banner');
  ok(await amani.isVisible('text=2 waiting'), 'two postcards are waiting after 8 days');
  await amani.goto(BASE + '#pc/3.1/w1'); await amani.waitForSelector('.postcard');
  for (const [i, q] of m31.postcards.entries()) await amani.click(`[data-q="${i}"][data-k="${q.a}"]`);
  await amani.waitForSelector('text=Stamp turned gold'); await shot(amani, '08-learner-postcard');
  await amani.goto(BASE + '#passport'); await amani.waitForSelector('.stamp.gold');
  ok((await amani.$$('.stamp.gold')).length === 1, 'the 3.1 stamp is gold after a correct postcard');

  /* 7. Admin dashboard: grid, sign-off, confidently wrong, person page, CSV */
  await admin.goto(BASE + '#admin'); await admin.click('#rf').catch(() => {});
  await admin.waitForSelector('text=Who has done what');
  ok(await admin.isVisible('a.pname:has-text("Amani Kibet")'), 'dashboard lists the learner');
  ok((await admin.textContent('tr:has(a.pname:has-text("Grace Test"))')).includes('Not signed in yet'), 'dashboard shows invited people who haven\'t signed in');
  const rowText = await admin.textContent('tr:has(a.pname:has-text("Amani Kibet"))');
  ok(/10%/.test(rowText), 'learner progress shows 10% (2 of 20)');
  ok(await admin.isVisible('text=3.1 · Your brother'), 'confidently-wrong panel shows the 3.1 case');
  await shot(admin, '09-admin-dashboard');
  const [dl] = await Promise.all([admin.waitForEvent('download'), admin.click('#csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(csv.includes('Amani Kibet') && csv.includes('3.1') && csv.includes('Signed at'), 'CSV export has a row per person and module');
  await admin.click('a.pname:has-text("Amani Kibet")'); await admin.waitForSelector('text=Documents opened');
  await shot(admin, '10-admin-person');

  /* 8. Admin sees the invite list with sign-in status */
  await admin.goto(BASE + '#admin/invite'); await admin.waitForSelector('text=On the list');
  ok(await admin.isVisible('td:has-text("grace@example.org")'), 'invited person appears on the list');

  console.log(checks.join('\n'));
  console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nAll checks passed.');
  await browser.close(); server.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(checks.join('\n')); process.exit(1); });
