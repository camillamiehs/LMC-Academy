/* End-to-end test of LMC Academy with the real apps-script/Code.gs running in a local Apps Script stand-in (gas-sim.js).
   Run from tests/:  npm install && npm test
   Needs ../private/content.json (the private handbook content). Screenshots go to tests/shots/. */
const path = require('path'), fs = require('fs'), http = require('http');
const { chromium } = require('playwright');
const { makeSim } = require('./gas-sim');
const ROOT = path.resolve(__dirname, '..'), OUT = path.join(__dirname, 'shots'); fs.mkdirSync(OUT, { recursive: true });
const CONTENT = path.join(ROOT, 'private', 'content.json'), content = JSON.parse(fs.readFileSync(CONTENT, 'utf8'));
const BASE = 'http://127.0.0.1:8124/', API = 'http://127.0.0.1:8125/exec', DAY = 86400000;
const errs = [], checks = [];
function ok(cond, msg) { checks.push((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) errs.push(msg); }

(async () => {
  const sim = makeSim({ owner: 'camilla.test@example.org', appUrl: BASE });
  sim.addInvite('amani@example.org', 'Amani Kibet', 'learner');
  const apiServer = sim.listen(8125);
  const web = http.createServer((q, s) => {
    let f = decodeURIComponent(q.url.split('?')[0]); if (f === '/') f = '/index.html';
    if (f === '/config.js') { s.writeHead(200, { 'content-type': 'text/javascript' }); return s.end(`window.LMC_API="${API}";window.LMC_TEST=true;`); }
    const p = path.join(ROOT, f); if (!p.startsWith(ROOT) || !fs.existsSync(p) || /^\/(private|handbook|prototype|tests|apps-script)/.test(f)) { s.writeHead(404); return s.end(); }
    s.writeHead(200, { 'content-type': f.endsWith('.js') ? 'text/javascript' : f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8' }); s.end(fs.readFileSync(p));
  }).listen(8124, '127.0.0.1');

  const browser = await chromium.launch();
  async function user(name, vp) {
    const ctx = await browser.newContext({ viewport: vp || { width: 1280, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(name + ' pageerror: ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts\.g|ERR_NAME|Failed to load resource/.test(m.text())) errs.push(name + ' console: ' + m.text().slice(0, 200)); });
    return p;
  }
  function lastLink(email) { const m = sim.outbox.filter(x => x.to === email).pop(); const u = m && /href="([^"]+login=[^"]+)"/.exec(m.htmlBody); return u && u[1].replace(/&amp;/g, '&'); }
  async function signIn(p, email) {
    await p.goto(BASE); await p.waitForSelector('#em'); await p.fill('#em', email); await p.click('#send');
    await p.waitForSelector('text=Check your inbox', { timeout: 10000 });
    const link = lastLink(email); ok(!!link && link.startsWith(BASE), 'sign-in email for ' + email + ' links to the Academy');
    await p.goto(link);
  }
  const shot = (p, n) => p.screenshot({ path: path.join(OUT, n + '.png'), fullPage: true });

  /* 1. Admin loads content, invites people */
  const admin = await user('admin');
  await signIn(admin, 'camilla.test@example.org');
  await admin.waitForSelector('#file', { timeout: 15000 });
  ok(await admin.isVisible('text=No content loaded yet'), 'admin is sent to the content tab when nothing is loaded');
  await admin.setInputFiles('#file', CONTENT); await admin.waitForSelector('text=Loaded version', { timeout: 15000 });
  ok(Object.values(sim.files).some(f => f.includes('"modules"')), 'content is stored as a private Drive file');
  await admin.goto(BASE + '#admin/invite'); await admin.waitForSelector('#bulk');
  await admin.fill('#bulk', 'Grace Test, grace@example.org'); await admin.click('#addbulk');
  await admin.waitForSelector('td:has-text("grace@example.org")', { timeout: 10000 });
  ok(sim.sheets.Invites._rows.some(r => r[0] === 'grace@example.org'), 'invite lands in the Invites sheet');
  await shot(admin, '01-admin-invite');

  /* 2. Someone not on the list */
  const stranger = await user('stranger');
  await stranger.goto(BASE); await stranger.fill('#em', 'stranger@example.org'); await stranger.click('#send');
  await stranger.waitForSelector('text=isn’t on the LMC Academy invite list');
  ok(!sim.outbox.some(m => m.to === 'stranger@example.org'), 'no email is sent to people who aren\'t invited');

  /* 3. Learner on a phone: module 3.1 with a confidently-wrong case and the sign-off */
  const amani = await user('amani', { width: 390, height: 844 });
  await signIn(amani, 'amani@example.org');
  await amani.waitForSelector('.road', { timeout: 15000 }); await shot(amani, '02-learner-journey');
  const m31 = content.modules.find(m => m.id === '3.1');
  await amani.goto(BASE + '#m/3.1'); await amani.waitForSelector('[data-g]');
  await amani.click('[data-g="0"]'); await amani.click('#nx');
  const firstCase = m31.steps.findIndex(x => x.type === 'case');
  for (const [i, s] of m31.steps.entries()) {
    if (s.type === 'card') { await amani.click('#nx'); continue; }
    if (s.type === 'check') { await amani.click(`[data-k="${s.a}"]`); await amani.click('#nx'); continue; }
    const wrong = i === firstCase;
    await amani.click(`[data-c="${wrong ? (s.a + 1) % s.opts.length : s.a}"]`); await amani.click(`[data-f="${wrong ? 2 : 1}"]`);
    await amani.click('#chk'); if (wrong) await shot(amani, '03-learner-case'); await amani.click('#nx');
  }
  await amani.waitForSelector('text=Checkpoint passed'); ok(await amani.isVisible('text=4 of 5 right'), 'checkpoint scores 4 of 5 and passes at 80%');
  await amani.click('#nx'); await amani.waitForSelector('#ok');
  await amani.check('#ok'); await amani.fill('#nm', 'Amani Kibet'); await amani.click('#fin');
  await amani.waitForSelector('text=Welcome to your next stop'); await shot(amani, '04-learner-arrival');

  /* 4. Module 0.1 with a failed checkpoint and a retry */
  const m01 = content.modules.find(m => m.id === '0.1');
  await amani.goto(BASE + '#m/0.1'); await amani.waitForSelector('[data-g]');
  await amani.click(`[data-g="${m01.departure.a}"]`); await amani.click('#nx');
  for (const s of m01.steps) {
    if (s.type === 'card') { await amani.click('#nx'); continue; }
    const pick = (s.a + 1) % s.opts.length;
    if (s.type === 'check') { await amani.click(`[data-k="${pick}"]`); await amani.click('#nx'); }
    else { await amani.click(`[data-c="${pick}"]`); await amani.click('[data-f="0"]'); await amani.click('#chk'); await amani.click('#nx'); }
  }
  await amani.waitForSelector('#retry'); ok(await amani.isVisible('text=Almost there: 0 of 5'), 'a failed checkpoint asks for a retry');
  await amani.click('#retry');
  for (const s of m01.steps.slice(1)) {
    if (s.type === 'card') { await amani.click('#nx'); continue; }
    if (s.type === 'check') { await amani.click(`[data-k="${s.a}"]`); await amani.click('#nx'); }
    else { await amani.click(`[data-c="${s.a}"]`); await amani.click('[data-f="2"]'); await amani.click('#chk'); await amani.click('#nx'); }
  }
  await amani.waitForSelector('text=Checkpoint passed'); await amani.click('#nx');
  for (const cb of await amani.$$('.item input')) await cb.check();
  await amani.click('#fin'); await amani.waitForSelector('text=Welcome to your next stop');
  ok(true, 'learner finished an action-type module after one retry');

  /* 5. Progress persists: reload on a "new" page, and it's readable in the Progress sheet */
  await amani.waitForTimeout(1500); // let the save queue finish
  await amani.reload(); await amani.goto(BASE + '#passport'); await amani.waitForSelector('.stamps');
  ok((await amani.$$('.stamp:not(.empty)')).length === 2, 'passport shows 2 stamps after reloading (progress saved in the sheet)');
  const prow = sim.sheets.Progress._rows.find(r => r[0] === 'amani@example.org' && r[2] === '3.1');
  ok(sim.sheets.Progress._rows.filter(r => r[0] === 'amani@example.org').length === 2, 'one Progress row per person per module (no duplicates)');
  ok(prow && prow[4] === 'done' && prow[10] === 'Amani Kibet' && prow[3] === 'Code of Conduct', 'Progress sheet row for 3.1: done, signed by Amani Kibet, titled');
  await shot(amani, '05-learner-passport');

  /* 6. Security: learners can't do admin things; tampered sessions are refused */
  const sess = await amani.evaluate(() => localStorage.getItem('lmcSession'));
  const r1 = sim.call({ action: 'adminData', session: sess }), r2 = sim.call({ action: 'setContent', session: sess, json: '{"version":"x","modules":[1]}' });
  const r3 = sim.call({ action: 'invite', session: sess, people: [{ email: 'evil@example.org', role: 'admin' }] });
  const forged = sess.split('.')[0] + '.' + 'AAAA' + sess.split('.')[1].slice(4);
  const r4 = sim.call({ action: 'me', session: forged }), r5 = sim.call({ action: 'me' });
  const loginTok = /login=([^"&]+)/.exec(lastLink('amani@example.org'))[1], r6 = sim.call({ action: 'me', session: loginTok });
  ok(r1.error === 'Admins only.', 'learner cannot read everyone\'s progress (' + r1.error + ')');
  ok(r2.error === 'Admins only.', 'learner cannot change the content (' + r2.error + ')');
  ok(r3.error === 'Admins only.', 'learner cannot invite people or make admins (' + r3.error + ')');
  ok(/sign in again/i.test(r4.error || ''), 'a tampered session token is refused');
  ok(/sign in again/i.test(r5.error || ''), 'requests without a session are refused');
  ok(/sign in again/i.test(r6.error || ''), 'a sign-in link token can\'t be used as a session');

  /* 7. Eight days later: reminder email, postcard, gold stamp */
  sim.setShift(8 * DAY);
  const sent = sim.ctx.sendPostcardReminders();
  const rem = sim.outbox.filter(m => m.to === 'amani@example.org' && /Postcards home/.test(m.subject));
  ok(sent === 1 && rem.length === 1 && /Code of Conduct/.test(rem[0].htmlBody), 'daily job emails a postcard reminder');
  ok(sim.ctx.sendPostcardReminders() === 0, 'the same postcard isn\'t reminded twice');
  await amani.evaluate(ms => localStorage.setItem('lmcShift', String(ms)), 8 * DAY);
  await amani.goto(BASE + '#journey'); await amani.reload(); await amani.waitForSelector('.banner', { timeout: 15000 });
  ok(await amani.isVisible('text=2 waiting'), 'two postcards are waiting after 8 days');
  await amani.goto(BASE + '#pc/3.1/w1'); await amani.waitForSelector('.postcard');
  for (const [i, q] of m31.postcards.entries()) await amani.click(`[data-q="${i}"][data-k="${q.a}"]`);
  await amani.waitForSelector('text=Stamp turned gold'); await shot(amani, '06-learner-postcard');
  await amani.waitForTimeout(1500);
  ok(sim.ctx.sendPostcardReminders() === 0, 'no reminder after the postcard is answered (or for one already reminded)');
  const row2 = sim.sheets.Progress._rows.find(r => r[0] === 'amani@example.org' && r[2] === '3.1');
  ok(row2 && row2[12] === 'remembered', 'Progress sheet shows "remembered" for the week-1 postcard');

  /* 8. Admin dashboard, person page, CSV */
  await admin.goto(BASE + '#admin'); await admin.waitForSelector('#rf'); await admin.click('#rf');
  await admin.waitForSelector('a.pname:has-text("Amani Kibet")', { timeout: 15000 });
  const rowText = await admin.textContent('tr:has(a.pname:has-text("Amani Kibet"))');
  ok(/10%/.test(rowText), 'learner progress shows 10% (2 of 20)');
  ok((await admin.textContent('tr:has(a.pname:has-text("Grace Test"))')).includes('Not signed in yet'), 'dashboard shows invited people who haven\'t signed in');
  ok(await admin.isVisible('text=3.1 · Your brother'), 'confidently-wrong panel shows the 3.1 case');
  await shot(admin, '07-admin-dashboard');
  const [dl] = await Promise.all([admin.waitForEvent('download'), admin.click('#csv')]);
  const csv = fs.readFileSync(await dl.path(), 'utf8');
  ok(csv.includes('Amani Kibet') && csv.includes('Signed at'), 'CSV export has a row per person and module');
  await admin.click('a.pname:has-text("Amani Kibet")'); await admin.waitForSelector('text=Documents opened');
  await shot(admin, '08-admin-person');

  /* 9. Removing someone stops their access */
  await admin.goto(BASE + '#admin/invite'); await admin.waitForSelector('[data-rm="amani@example.org"]');
  await admin.click('[data-rm="amani@example.org"]'); await admin.click('[data-rm="amani@example.org"]');
  await admin.waitForSelector('text=Removed');
  await amani.reload(); await amani.waitForSelector('text=isn’t on the list', { timeout: 15000 });
  ok(true, 'a removed person loses access on their next visit');

  console.log(checks.join('\n'));
  console.log(errs.length ? '\nERRORS:\n' + errs.join('\n') : '\nAll checks passed.');
  await browser.close(); web.close(); apiServer.close(); process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); console.log(checks.join('\n')); process.exit(1); });
