/* A small local stand-in for Google Apps Script, so apps-script/Code.gs can be tested without a Google account.
   Simulates SpreadsheetApp (in-memory sheets), PropertiesService, Utilities, MailApp (captured outbox), DriveApp,
   ContentService, LockService, Session and ScriptApp. Serves doPost/doGet over HTTP like a deployed web app. */
const fs = require('fs'), path = require('path'), vm = require('vm'), http = require('http'), crypto = require('crypto');

function makeSim(opts) {
  const props = {}, outbox = [], files = {}, sheets = {};
  let shift = 0;
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(Date.now() + shift); } static now() { return Date.now() + shift; } }
  function sheet(name) {
    const rows = [];
    return {
      _rows: rows, getName: () => name,
      getLastRow: () => rows.length,
      getRange(r, c, nr = 1, nc = 1) {
        return {
          getValues() { const out = []; for (let i = 0; i < nr; i++) { const row = rows[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] === undefined ? '' : row[c - 1 + j]); out.push(o); } return out; },
          setValues(v) { for (let i = 0; i < nr; i++) { rows[r - 1 + i] = rows[r - 1 + i] || []; for (let j = 0; j < nc; j++) rows[r - 1 + i][c - 1 + j] = v[i][j]; } return this; },
          setValue(v) { rows[r - 1] = rows[r - 1] || []; rows[r - 1][c - 1] = v; return this; }
        };
      },
      appendRow(v) { rows.push(v.slice()); }, deleteRow(r) { rows.splice(r - 1, 1); }, setFrozenRows() {}
    };
  }
  const ss = { getId: () => 'sheet-1', getSheetByName: n => sheets[n] || null, insertSheet: n => (sheets[n] = sheet(n)) };
  const toBytes = b => Array.from(b).map(x => (x > 127 ? x - 256 : x));
  const ctx = {
    Date: FakeDate, JSON, Math, String, Number, Object, Array, RegExp, Error, isNaN, parseInt,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, openById: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); } }) },
    Utilities: {
      getUuid: () => crypto.randomUUID(),
      computeHmacSha256Signature: (v, k) => toBytes(crypto.createHmac('sha256', k).update(v, 'utf8').digest()),
      base64EncodeWebSafe: d => (typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d.map(x => x & 255))).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64DecodeWebSafe: s => toBytes(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: b => ({ getDataAsString: () => Buffer.from(b.map(x => x & 255)).toString('utf8') }),
      formatDate: (d) => d.toISOString().slice(0, 10)
    },
    MailApp: { sendEmail: m => outbox.push(m) },
    DriveApp: {
      createFile: (n, c) => { const id = 'file-' + Object.keys(files).length; files[id] = c; return { getId: () => id }; },
      getFileById: id => ({ setContent: c => { files[id] = c; }, getBlob: () => ({ getDataAsString: () => files[id] }) })
    },
    MimeType: { PLAIN_TEXT: 'text/plain' },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: t => ({ text: t, setMimeType() { return this; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Session: { getEffectiveUser: () => ({ getEmail: () => opts.owner }) },
    ScriptApp: { getProjectTriggers: () => [], newTrigger: () => ({ timeBased: () => ({ everyDays: () => ({ atHour: () => ({ create() {} }) }) }) }) },
    Logger: { log() {} }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'apps-script', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  props.APP_URL = opts.appUrl;
  ctx.setup();
  return {
    ctx, props, outbox, sheets, files,
    setShift(ms) { shift = ms; },
    call(body) { return JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).text); },
    addInvite(email, name, role) { sheets.Invites.appendRow([email, name, role, new FakeDate(), 'test', '']); },
    listen(port) {
      return http.createServer((q, s) => {
        const cors = { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' };
        if (q.method === 'GET') { s.writeHead(200, cors); return s.end(ctx.doGet().text); }
        let b = ''; q.on('data', d => (b += d)); q.on('end', () => {
          setTimeout(() => { s.writeHead(200, cors); s.end(ctx.doPost({ postData: { contents: b } }).text); }, 120); // a little latency, like Google
        });
      }).listen(port, '127.0.0.1');
    }
  };
}
module.exports = { makeSim };
