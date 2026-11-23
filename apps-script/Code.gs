/**
 * LMC Academy: Google Apps Script backend, bound to a Google Sheet.
 *
 * What it does
 *  - Invites sheet: who may sign in (Email, Name, Role = learner | admin). You can edit it by hand.
 *  - Sign-in by email link: sends a link from your Google account; the link holds a signed, time-limited token.
 *  - Progress sheet: one row per person per module (readable columns + the full data in the last column).
 *  - The handbook content is a private JSON file in your Google Drive (loaded by an admin in the app).
 *  - Once a day it emails people whose postcards are due.
 *
 * Setup (once): Extensions → Apps Script → paste this file → Run "setup" → allow access →
 *   Deploy → New deployment → Web app → Execute as: Me, Who has access: Anyone → Deploy → copy the Web app URL.
 */

var APP_URL = "https://camillamiehs.github.io/LMC-Academy/"; // where sign-in links point to
var APP_NAME = "LMC Academy";
var LOGIN_MINUTES = 60;          // sign-in links work for 1 hour
var SESSION_DAYS = 180;          // people stay signed in for ~6 months on a device
var INVITE_HEADERS = ["Email", "Name", "Role", "Invited at", "Invited by", "Last active"];
var PROGRESS_HEADERS = ["Email", "Name", "Module", "Title", "Status", "Started", "Finished", "Minutes", "Tries", "Best %", "Signed by", "Signed at", "Postcard week 1", "Postcard week 4", "Documents opened", "Updated", "Data"];

/* ---------------- setup ---------------- */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  props.setProperty("SPREADSHEET_ID", ss.getId());
  if (!props.getProperty("SECRET")) props.setProperty("SECRET", Utilities.getUuid() + Utilities.getUuid());
  var inv = sheet_("Invites", INVITE_HEADERS), prog = sheet_("Progress", PROGRESS_HEADERS);
  var me = (Session.getEffectiveUser().getEmail() || "").toLowerCase();
  if (me && !findInvite_(me)) inv.appendRow([me, "Camilla", "admin", new Date(), "setup", ""]);
  var has = ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === "sendPostcardReminders"; });
  if (!has) ScriptApp.newTrigger("sendPostcardReminders").timeBased().everyDays(1).atHour(8).create();
  Logger.log("Setup done. Admin: " + me + ". Now: Deploy → New deployment → Web app (Execute as: Me, Who has access: Anyone).");
  return "ok";
}
function sheet_(name, headers) {
  var ss = ss_(), sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.getRange(1, 1, 1, headers.length).setValues([headers]); sh.setFrozenRows(1); }
  return sh;
}
function ss_() { var id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID"); return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActiveSpreadsheet(); }
function appUrl_() { return PropertiesService.getScriptProperties().getProperty("APP_URL") || APP_URL; }

/* ---------------- web entry points ---------------- */
function doGet() { return json_({ ok: true, app: APP_NAME }); }
function doPost(e) {
  var req; try { req = JSON.parse(e.postData.contents); } catch (x) { return json_({ error: "Bad request" }); }
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    var fn = ACTIONS[req.action];
    if (!fn) return json_({ error: "Unknown action" });
    return json_(fn(req));
  } catch (err) {
    return json_({ error: String(err && err.message || err) });
  } finally { try { lock.releaseLock(); } catch (x) {} }
}
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

/* ---------------- tokens ---------------- */
function sign_(payload) {
  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(payload, secret)).replace(/=+$/, "");
}
function makeToken_(email, type, ms) {
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify({ e: email, t: type, x: Date.now() + ms, n: Utilities.getUuid().slice(0, 8) })).replace(/=+$/, "");
  return payload + "." + sign_(payload);
}
function readToken_(token, type) {
  if (!token || String(token).indexOf(".") < 0) throw new Error("Please sign in again.");
  var parts = String(token).split(".");
  if (sign_(parts[0]) !== parts[1]) throw new Error("Please sign in again.");
  var pad = parts[0] + "===".slice((parts[0].length + 3) % 4);
  var data = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
  if (data.t !== type) throw new Error("Please sign in again.");
  if (data.x < Date.now()) throw new Error(type === "login" ? "This sign-in link has expired. Request a new one." : "Please sign in again.");
  return data.e;
}
function user_(req, needAdmin) {
  var email = readToken_(req.session, "session"), inv = findInvite_(email);
  if (!inv) throw new Error("NOT_INVITED");
  if (needAdmin && inv.role !== "admin") throw new Error("Admins only.");
  return inv;
}

/* ---------------- invites ---------------- */
function invites_() {
  var sh = sheet_("Invites", INVITE_HEADERS), n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, INVITE_HEADERS.length).getValues().map(function (r, i) {
    return { row: i + 2, email: String(r[0]).trim().toLowerCase(), name: String(r[1] || "").trim(), role: String(r[2] || "learner").trim().toLowerCase() === "admin" ? "admin" : "learner", invitedAt: time_(r[3]), lastActive: time_(r[5]) };
  }).filter(function (x) { return x.email; });
}
function findInvite_(email) { email = String(email || "").trim().toLowerCase(); return invites_().filter(function (i) { return i.email === email; })[0] || null; }
function time_(v) { if (!v) return 0; if (v instanceof Date) return v.getTime(); var n = Number(v); return isNaN(n) ? (Date.parse(v) || 0) : n; }

/* ---------------- content ---------------- */
function contentText_() {
  var id = PropertiesService.getScriptProperties().getProperty("CONTENT_FILE_ID");
  return id ? DriveApp.getFileById(id).getBlob().getDataAsString() : "";
}
function contentTitles_() {
  try { var c = JSON.parse(contentText_() || "{}"); var t = {}; (c.modules || []).forEach(function (m) { t[m.id] = m.title; }); return t; } catch (e) { return {}; }
}

/* ---------------- progress ---------------- */
function progressRows_() {
  var sh = sheet_("Progress", PROGRESS_HEADERS), n = sh.getLastRow();
  if (n < 2) return { sh: sh, rows: [] };
  var vals = sh.getRange(2, 1, n - 1, PROGRESS_HEADERS.length).getValues();
  return { sh: sh, rows: vals.map(function (r, i) { var d = {}; try { d = JSON.parse(r[16] || "{}"); } catch (e) {} return { row: i + 2, email: String(r[0]).toLowerCase(), key: String(r[2]).replace(/\./g, "_"), data: d }; }) };
}
function dt_(ms) { return ms ? new Date(ms) : ""; }
function pcText_(c) { if (!c) return ""; if (c.doneAt) return "remembered"; if (c.firstCorrect !== undefined) return c.firstCorrect + "/" + c.total + " first try"; return "due " + Utilities.formatDate(new Date(c.dueAt), "GMT", "yyyy-MM-dd"); }
function rowFor_(inv, key, d, title) {
  var pc = d.postcards || {};
  return [inv.email, inv.name, key.replace(/_/g, "."), title || "", d.status === "done" ? "done" : "in progress", dt_(d.startedAt), dt_(d.completedAt),
    Math.round((d.timeSec || 0) / 60), d.attempts || 1, d.best !== undefined ? Math.round(d.best * 100) : "", d.signed ? d.signed.name : "", d.signed ? dt_(d.signed.at) : "",
    pcText_(pc.w1), pcText_(pc.w4), d.docs ? Object.keys(d.docs).join("; ") : "", new Date(), JSON.stringify(d)];
}
function touch_(inv) { if (inv.row) sheet_("Invites", INVITE_HEADERS).getRange(inv.row, 6).setValue(new Date()); }

/* ---------------- actions ---------------- */
var ACTIONS = {
  requestLink: function (req) {
    var email = String(req.email || "").trim().toLowerCase(), inv = findInvite_(email);
    if (!inv) return { sent: false };
    var url = appUrl_() + (appUrl_().indexOf("?") < 0 ? "?" : "&") + "login=" + makeToken_(email, "login", LOGIN_MINUTES * 60000);
    MailApp.sendEmail({ to: email, name: APP_NAME, subject: "Your sign-in link for LMC Academy",
      htmlBody: '<div style="font-family:Arial,sans-serif;font-size:16px;color:#2A1810;max-width:520px">' +
        "<p>Hi " + esc_(inv.name || "") + ",</p><p>Here's your link to LMC Academy, the Last Mile Climate handbook as short learning journeys:</p>" +
        '<p><a href="' + url + '" style="display:inline-block;background:#E64904;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open LMC Academy</a></p>' +
        "<p style=\"color:#8A6A55;font-size:14px\">The link works for " + LOGIN_MINUTES + " minutes. You'll then stay signed in on this device. If you didn't ask for it, you can ignore this email.</p></div>" });
    return { sent: true };
  },
  exchange: function (req) {
    var email = readToken_(req.login, "login"), inv = findInvite_(email);
    if (!inv) throw new Error("NOT_INVITED");
    return { session: makeToken_(email, "session", SESSION_DAYS * 86400000), email: email };
  },
  me: function (req) {
    var inv = user_(req, false), p = progressRows_(), modules = {};
    p.rows.forEach(function (r) { if (r.email === inv.email) modules[r.key] = r.data; });
    touch_(inv);
    var props = PropertiesService.getScriptProperties();
    return { email: inv.email, name: inv.name || inv.email, role: inv.role, content: contentText_(), contentVersion: props.getProperty("CONTENT_VERSION") || "", modules: modules };
  },
  save: function (req) {
    var inv = user_(req, false), key = String(req.key || ""), d = req.data;
    if (!/^[0-9a-z_]{1,12}$/i.test(key) || !d || typeof d !== "object") throw new Error("Bad save.");
    var s = JSON.stringify(d); if (s.length > 45000) throw new Error("Too much data for one module.");
    var p = progressRows_(), hit = p.rows.filter(function (r) { return r.email === inv.email && r.key === key; })[0];
    if (hit && hit.data.postcards && d.postcards) ["w1", "w4"].forEach(function (w) { // keep "reminder sent" marks the app doesn't know about
      var o = hit.data.postcards[w], n = d.postcards[w]; if (o && n && o.remindedAt && !n.remindedAt && o.dueAt === n.dueAt) n.remindedAt = o.remindedAt; });
    var row = rowFor_(inv, key, d, contentTitles_()[key.replace(/_/g, ".")]);
    if (hit) p.sh.getRange(hit.row, 1, 1, row.length).setValues([row]); else p.sh.appendRow(row);
    touch_(inv);
    return { ok: true };
  },
  adminData: function (req) {
    user_(req, true);
    return { invites: invites_().map(function (i) { return { email: i.email, name: i.name, role: i.role, invitedAt: i.invitedAt, lastActive: i.lastActive }; }),
             rows: progressRows_().rows.map(function (r) { return { email: r.email, key: r.key, data: r.data }; }) };
  },
  invite: function (req) {
    var admin = user_(req, true), sh = sheet_("Invites", INVITE_HEADERS), list = req.people || [], added = 0;
    list.forEach(function (p) {
      var email = String(p.email || "").trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return;
      var role = p.role === "admin" ? "admin" : "learner", ex = findInvite_(email);
      if (ex) sh.getRange(ex.row, 2, 1, 2).setValues([[String(p.name || ex.name).trim(), role]]);
      else sh.appendRow([email, String(p.name || "").trim(), role, new Date(), admin.email, ""]);
      added++;
    });
    return { ok: true, added: added };
  },
  uninvite: function (req) {
    var admin = user_(req, true), email = String(req.email || "").toLowerCase();
    if (email === admin.email) throw new Error("You can't remove yourself.");
    var ex = findInvite_(email); if (ex) sheet_("Invites", INVITE_HEADERS).deleteRow(ex.row);
    return { ok: true };
  },
  setContent: function (req) {
    var admin = user_(req, true), c = JSON.parse(req.json || "{}");
    if (!c.version || !c.modules || !c.modules.length) throw new Error("That doesn't look like a content file.");
    var props = PropertiesService.getScriptProperties(), id = props.getProperty("CONTENT_FILE_ID"), text = JSON.stringify(c);
    if (id) DriveApp.getFileById(id).setContent(text);
    else props.setProperty("CONTENT_FILE_ID", DriveApp.createFile("LMC Academy content (private).json", text, MimeType.PLAIN_TEXT).getId());
    props.setProperty("CONTENT_VERSION", c.version);
    return { ok: true, version: c.version, modules: c.modules.length, by: admin.email };
  }
};
function esc_(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* ---------------- daily postcard reminders ---------------- */
function sendPostcardReminders() {
  var p = progressRows_(), now = Date.now(), due = {}, titles = contentTitles_(), invs = {};
  invites_().forEach(function (i) { invs[i.email] = i; });
  p.rows.forEach(function (r) {
    var pc = r.data.postcards; if (!pc || !invs[r.email]) return;
    ["w1", "w4"].forEach(function (w) {
      var c = pc[w]; if (!c || c.doneAt || c.dueAt > now || c.remindedAt) return;
      (due[r.email] = due[r.email] || []).push((titles[r.key.replace(/_/g, ".")] || r.key) + (w === "w1" ? " (week 1)" : " (week 4)"));
      c.remindedAt = now;
      p.sh.getRange(r.row, 17).setValue(JSON.stringify(r.data));
    });
  });
  Object.keys(due).forEach(function (email) {
    MailApp.sendEmail({ to: email, name: APP_NAME, subject: "Postcards home: " + due[email].length + " waiting",
      htmlBody: '<div style="font-family:Arial,sans-serif;font-size:16px;color:#2A1810;max-width:520px"><p>Hi ' + esc_(invs[email].name || "") + ",</p><p>You have postcards waiting in LMC Academy. Two questions each, one minute:</p><ul>" +
        due[email].map(function (t) { return "<li>" + esc_(t) + "</li>"; }).join("") + '</ul><p><a href="' + appUrl_() + '#postcards" style="display:inline-block;background:#E64904;color:#fff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:bold">Open my postcards</a></p></div>' });
  });
  return Object.keys(due).length;
}
