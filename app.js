/* LMC Academy: "Going the Last Mile" as short learning journeys, with named progress tracking.
   Plain JavaScript + Firebase (email-link sign-in, Firestore). No build step.
   Data (Firestore):
     allow/{email}      invite list: { name, role: "learner"|"admin", invitedAt, invitedBy }
     content/current   { version, json (the modules as a JSON string), updatedAt, updatedBy }
     progress/{uid}    { email, name, createdAt, lastActive, modules: { "3_1": {...} } }
   The handbook content is NOT in this repository: an admin loads it from a file on the Admin → Content tab. */
(function () {
  "use strict";
  var CFG = window.LMC_FIREBASE || {};
  var EMU = window.LMC_EMULATOR || null; // { auth: "http://127.0.0.1:9099", firestore: ["127.0.0.1", 8080] } in tests only
  var app = document.getElementById("app");
  var S = { user: null, invite: null, isAdmin: false, content: null, prog: null, saving: null, adminCache: null, playing: null };
  var LOGO = '<svg width="30" height="26" viewBox="0 0 30 26" aria-hidden="true"><path d="M3 3l8 10-8 10M12 3l8 10-8 10" fill="none" stroke="#682813" stroke-width="3" stroke-linejoin="round"/><path d="M25 2v22" stroke="#682813" stroke-width="3"/></svg>';
  var TAPE = '<svg class="tape" viewBox="0 0 420 150" aria-hidden="true"><g stroke-width="14"><path d="M10 120l60-26" stroke="#E64904"/><path d="M70 94l70-20" stroke="#B1CAD6"/><path d="M140 74l50-34" stroke="#4E7445"/><path d="M190 40l60 10" stroke="#F8D3C0"/><path d="M250 50l40-36" stroke="#FDC201"/><path d="M290 14l70 18" stroke="#B1CAD6"/><path d="M360 32l40-26" stroke="#4E7445"/><path d="M228 118l52-30" stroke="#FDC201"/><path d="M280 88l64 6" stroke="#E64904"/></g></svg>';
  var AVC = ["#3E6580", "#E64904", "#4E7445", "#682813", "#8A6A55", "#B23B1E", "#2A1810", "#A66F00"];
  var CONF = ["Guessing", "Fairly sure", "Certain"];
  var DAY = 86400000;

  /* ---------- helpers ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k) || ""; if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} return ""; }
  function NOW() { var shift = EMU ? (+store("lmcShift") || 0) : 0; return Date.now() + shift; }
  function key(id) { return String(id).replace(/\./g, "_"); }
  function hash(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); }
  function av(name) { var n = String(name || "?").trim() || "?"; var ini = n.split(/\s+/).map(function (w) { return w[0]; }).join("").slice(0, 2).toUpperCase(); return '<span class="av" style="--avc:' + AVC[hash(n) % AVC.length] + '">' + esc(ini) + "</span>"; }
  function fmtMin(sec) { sec = Math.round(sec || 0); if (sec < 60) return sec ? "<1m" : "0m"; var m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + "h " + (m % 60) + "m" : m + "m"; }
  function fmtDate(ms) { return ms ? new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""; }
  function fmtDT(ms) { return ms ? new Date(ms).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : ""; }
  function ago(ms) { if (!ms) return "Never"; var d = Math.floor((NOW() - ms) / DAY); return d <= 0 ? "Today" : d === 1 ? "Yesterday" : d < 7 ? d + " days ago" : d < 14 ? "1 week ago" : Math.floor(d / 7) + " weeks ago"; }
  function toast(t) { var e = document.createElement("div"); e.className = "toast"; e.setAttribute("role", "status"); e.textContent = t; document.body.appendChild(e); setTimeout(function () { e.remove(); }, 2600); }
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function on(sel, ev, fn, root) { $$(sel, root).forEach(function (el) { el.addEventListener(ev, fn); }); }
  function mods() { return S.content ? S.content.modules : []; }
  function modById(id) { return mods().filter(function (m) { return m.id === id; })[0]; }
  function stageOf(m) { return S.content.stages.filter(function (s) { return s.id === m.stage; })[0]; }
  function mp(id, create) { var k = key(id); if (!S.prog.modules[k] && create) S.prog.modules[k] = { status: "started", startedAt: NOW(), pos: 0, answers: {}, first: {}, attempts: 1, timeSec: 0, docs: {}, actions: {} }; return S.prog.modules[k]; }
  function isDone(p) { return p && p.status === "done"; }
  function isGold(p) { return isDone(p) && p.postcards && p.postcards.w1 && p.postcards.w1.doneAt; }

  /* ---------- Firebase ---------- */
  var fb, auth, db;
  try {
    fb = firebase.initializeApp(CFG);
    auth = firebase.auth(); db = firebase.firestore();
    if (EMU) { auth.useEmulator(EMU.auth); db.useEmulator(EMU.firestore[0], EMU.firestore[1]); }
  } catch (e) {
    app.innerHTML = '<div class="center card"><h2>Setup needed</h2><p>The Firebase settings in <code>firebase-config.js</code> are missing or wrong. See SETUP.md.</p><p class="err">' + esc(e.message) + "</p></div>";
    return;
  }
  var save = function () {
    if (!S.user || !S.prog) return Promise.resolve();
    S.prog.lastActive = NOW();
    var data = JSON.parse(JSON.stringify(S.prog));
    S.saving = db.collection("progress").doc(S.user.uid).set(data).catch(function (e) { toast("Couldn't save. Check your connection; we'll try again."); console.error(e); });
    return S.saving;
  };

  /* ---------- chrome ---------- */
  function appbar(active) {
    var tabs = [["#journey", "Journey"], ["#passport", "Passport"], ["#postcards", "Postcards" + (dueCards().length ? " (" + dueCards().length + ")" : "")]];
    if (S.isAdmin) tabs.push(["#admin", "Admin"]);
    return '<div class="appbar"><a class="brand" href="#journey" style="text-decoration:none">' + LOGO + '<span>Last Mile<br>Climate</span><small>Academy</small></a>' +
      '<nav class="tabs" aria-label="Main">' + tabs.map(function (t) { return '<a href="' + t[0] + '" aria-current="' + (active === t[0] ? "page" : "false") + '">' + t[1] + "</a>"; }).join("") + "</nav>" +
      '<span class="me">' + av(S.prog.name) + '<span style="display:flex;flex-direction:column;line-height:1.2">' + esc(S.prog.name) + '<button id="out" type="button">Sign out</button></span></span></div>';
  }
  function wireBar() { var o = $("#out"); if (o) o.addEventListener("click", function () { auth.signOut(); }); }
  function show(html, active) { app.innerHTML = (active === null ? "" : appbar(active)) + html; wireBar(); window.scrollTo(0, 0); }

  /* ---------- sign in ---------- */
  function vSignin(msg, err) {
    app.innerHTML = '<section class="card center view">' + TAPE.replace('class="tape"', 'class="tape" style="opacity:.6;width:200px;height:80px;top:-20px"') +
      '<p class="eyebrow">LMC Academy</p><h1>The handbook, one short trip at a time</h1>' +
      '<p class="muted">20 short modules, 3 to 6 minutes each. Sign in with your work email. No password: we email you a link.</p>' +
      '<form id="f" style="display:flex;flex-direction:column;gap:10px"><label class="f" for="em">Work email<input id="em" type="email" autocomplete="email" required placeholder="name@lastmileclimate.org" value="' + esc(store("lmcEmail")) + '"></label><button class="btn go" type="submit" id="send">Email me a sign-in link</button></form>' +
      (msg ? '<div class="ok" role="status">' + msg + "</div>" : "") + (err ? '<div class="err" role="alert">' + esc(err) + "</div>" : "") +
      '<details><summary class="small">What we track and why</summary><p class="small muted" style="margin-top:8px">' + PRIVACY + "</p></details></section>";
    $("#f").addEventListener("submit", function (e) {
      e.preventDefault(); var em = $("#em").value.trim().toLowerCase(); if (!em) return;
      $("#send").disabled = true;
      auth.sendSignInLinkToEmail(em, { url: location.origin + location.pathname, handleCodeInApp: true }).then(function () {
        store("lmcEmail", em); vSignin("<strong>Check your inbox.</strong> We sent a sign-in link to <b>" + esc(em) + "</b>. Open it on this device. It works once.");
      }).catch(function (er) { vSignin("", "We couldn't send the link: " + er.message); });
    });
  }
  var PRIVACY = "We record which modules you open and finish, your time on each (only while the page is open), your answers and scores, policy sign-offs with date and time, and which documents you open from the modules. Only you and the Academy admins can see it. It's there to support onboarding, not for performance ratings. It's stored in the EU with Google Firebase.";
  function vConfirmEmail() {
    app.innerHTML = '<section class="card center view"><p class="eyebrow">One more step</p><h2>Confirm your email</h2><p class="muted">You opened the sign-in link on a different device or browser. Type the email you used.</p><form id="f" style="display:flex;flex-direction:column;gap:10px"><label class="f" for="em">Work email<input id="em" type="email" required></label><button class="btn go" type="submit">Sign in</button></form></section>';
    $("#f").addEventListener("submit", function (e) { e.preventDefault(); finishLink($("#em").value.trim().toLowerCase()); });
  }
  function finishLink(email) {
    auth.signInWithEmailLink(email, location.href).then(function () {
      store("lmcEmail", email); history.replaceState(null, "", location.pathname + (location.hash || ""));
    }).catch(function (er) { history.replaceState(null, "", location.pathname); vSignin("", "That sign-in link didn't work (" + er.code + "). Links work once and expire after a while. Request a new one."); });
  }
  function vNotInvited() {
    app.innerHTML = '<section class="card center view"><p class="eyebrow">Not on the list yet</p><h2>You’re signed in as ' + esc(S.user.email) + '</h2><p>This email isn’t on the LMC Academy invite list. Ask Camilla, Jakob or Brian to add you, then sign in again.</p><div class="btns"><button class="btn" id="o">Sign out</button></div></section>';
    $("#o").addEventListener("click", function () { auth.signOut(); });
  }

  /* ---------- load after sign-in ---------- */
  function boot(user) {
    S.user = user; var email = user.email.toLowerCase();
    db.collection("allow").doc(email).get().then(function (inv) {
      if (!inv.exists) { vNotInvited(); return; }
      S.invite = inv.data(); S.isAdmin = S.invite.role === "admin";
      return Promise.all([db.collection("content").doc("current").get(), db.collection("progress").doc(user.uid).get()]).then(function (r) {
        S.content = r[0].exists ? JSON.parse(r[0].data().json) : null;
        S.contentVersion = r[0].exists ? r[0].data().version : "";
        S.prog = r[1].exists ? r[1].data() : { email: email, name: S.invite.name || email, createdAt: NOW(), modules: {} };
        S.prog.email = email; if (S.invite.name) S.prog.name = S.invite.name; S.prog.modules = S.prog.modules || {};
        save(); route();
      });
    }).catch(function (e) { app.innerHTML = '<div class="center card"><h2>Something went wrong</h2><p class="err">' + esc(e.message) + '</p><button class="btn" id="o">Sign out</button></div>'; $("#o").addEventListener("click", function () { auth.signOut(); }); });
  }

  /* ---------- router ---------- */
  function route() {
    if (!S.prog) return;
    var h = (location.hash || "#journey").slice(1).split("/");
    if (!S.content) { if (S.isAdmin && h[0] === "admin") return vAdmin(h); if (S.isAdmin) { location.hash = "#admin/content"; return; } return show('<section class="card center"><h2>Almost ready</h2><p>The handbook modules haven’t been loaded yet. Check back soon.</p></section>', "#journey"); }
    if (S.playing && h[0] !== "m") stopTimer();
    if (h[0] === "m" && modById(h[1])) return vModule(modById(h[1]));
    if (h[0] === "passport") return vPassport();
    if (h[0] === "postcards") return vPostcards();
    if (h[0] === "pc" && modById(h[1])) return vPostcard(modById(h[1]), h[2]);
    if (h[0] === "certificate") return vCertificate();
    if (h[0] === "admin" && S.isAdmin) return vAdmin(h);
    return vJourney();
  }
  window.addEventListener("hashchange", route);

  /* ---------- journey ---------- */
  function nextModule() { return mods().filter(function (m) { return !isDone(S.prog.modules[key(m.id)]); })[0]; }
  function totalTime() { var t = 0; Object.keys(S.prog.modules).forEach(function (k) { t += S.prog.modules[k].timeSec || 0; }); return t; }
  function vJourney() {
    var ms = mods(), done = ms.filter(function (m) { return isDone(S.prog.modules[key(m.id)]); }).length, pct = Math.round(done / ms.length * 100), nx = nextModule(), due = dueCards();
    var legs = S.content.stages.map(function (s, si) {
      var ch = ms.filter(function (m) { return m.stage === s.id; }), d = ch.filter(function (m) { return isDone(S.prog.modules[key(m.id)]); }).length, all = d === ch.length;
      return '<div class="leg' + (all ? " done" : "") + '" style="--sc:' + s.color + '"><span class="badge" aria-hidden="true">' + (all ? "✓" : si) + '</span><div class="body"><div class="head"><div><p class="eyebrow" style="color:' + s.color + '">' + esc(s.label) + "</p><h2>" + esc(s.n) + '</h2></div><span class="small muted">' + d + " of " + ch.length + ' done</span></div><p class="muted small">' + esc(s.sub) + '</p><div class="stops">' +
        ch.map(function (m) { var p = S.prog.modules[key(m.id)], isD = isDone(p), isN = nx && nx.id === m.id; return '<a class="stop' + (isD ? " done" : isN ? " doing here" : "") + '" href="#m/' + m.id + '" style="--sc:' + s.color + '"><span class="st" aria-hidden="true">' + (isD ? (isGold(p) ? "★" : "✓") : m.id) + '</span><span class="tx"><b>' + esc(m.title) + "</b><span>" + (isD ? "Done" + (isGold(p) ? " · remembered" : "") : isN ? "Next stop · " + m.minutes + " min" : p ? "In progress" : m.minutes + " min" + (m.arrival.type === "sign" ? " · sign-off" : "")) + "</span></span></a>"; }).join("") + "</div></div></div>";
    }).join("");
    var hero = nx ? '<p class="eyebrow">' + (done ? "Next stop" : "Your journey starts here") + "</p><h1>" + esc(nx.id + " " + nx.title) + "</h1><p>" + esc(nx.tagline) + " · " + nx.minutes + " min</p>"
      : '<p class="eyebrow">You made it</p><h1>The whole journey, done</h1><p>All ' + ms.length + " modules finished. Keep answering your postcards to turn every stamp gold.</p>";
    show((due.length ? '<div class="banner view"><span><span class="hand">Postcards home!</span> ' + due.length + " waiting. One minute each.</span><a class=\"btn small\" href=\"#postcards\">Open postcards</a></div>" : "") +
      '<section class="card hero view">' + TAPE + '<div class="next"><div style="display:flex;flex-direction:column;gap:10px">' + hero +
      '<div class="bar" style="max-width:420px" aria-label="' + pct + '% of the journey"><i style="width:' + pct + '%"></i></div><p class="small muted">' + done + " of " + ms.length + " modules · " + pct + "% of the way · " + fmtMin(totalTime()) + ' so far</p><p class="hand">' + (done ? "Pick up where you left off. Pamoja!" : "Short trips. 10 minutes a day is plenty.") + "</p></div>" +
      '<div class="btns">' + (nx ? '<a class="btn go" href="#m/' + nx.id + '">' + (S.prog.modules[key(nx.id)] ? "Continue" : "Start") + "</a>" : '<a class="btn go" href="#certificate">My certificate</a>') + '<a class="btn alt" href="#passport">My passport</a></div></div></section>' +
      '<section class="road view" aria-label="Journey map">' + legs + '<div class="finish"><span class="badge" aria-hidden="true">🏁</span><div><h2>Finish line</h2><p class="muted small">Your certificate, and a shout-out at the Monday meeting.</p></div></div></section>' +
      '<p class="small muted"><a href="#" id="pv">What we track and why</a></p><p id="pvt" class="note small" hidden>' + PRIVACY + "</p>", "#journey");
    $("#pv").addEventListener("click", function (e) { e.preventDefault(); $("#pvt").hidden = !$("#pvt").hidden; });
  }

  /* ---------- module player ---------- */
  var timer = { at: 0 };
  function tick() { if (!S.playing) return; var p = mp(S.playing, false); if (!p) return; var t = NOW(); if (timer.at && document.visibilityState === "visible") p.timeSec = (p.timeSec || 0) + Math.min(180, (t - timer.at) / 1000); timer.at = t; }
  function stopTimer() { tick(); S.playing = null; timer.at = 0; save(); }
  document.addEventListener("visibilitychange", function () { if (!S.playing) return; if (document.visibilityState === "hidden") { tick(); save(); } else timer.at = NOW(); });
  window.addEventListener("pagehide", function () { if (S.playing) { tick(); save(); } });
  function flow(m) {
    var f = [{ k: "departure", st: 0 }];
    m.steps.forEach(function (s, i) { f.push({ k: s.type, s: s, i: i, st: s.type === "case" ? 2 : 1 }); });
    f.push({ k: "result", st: 3 }, { k: "arrival", st: 3 });
    return f;
  }
  function score(m, p) { var n = 0, c = 0; m.steps.forEach(function (s, i) { if (s.type === "check" || s.type === "case") { n++; if (p.answers[i] && p.answers[i].correct) c++; } }); return { n: n, c: c }; }
  function docLinks(m, p) { return m.links.length ? '<div class="doc"><span class="hand">open it</span><div class="doclinks">' + m.links.map(function (l, i) { return '<a href="' + esc(l.url) + '" target="_blank" rel="noopener" data-doc="' + i + '">' + esc(l.label) + "</a>"; }).join("") + '</div><span class="small muted"><b>Ask:</b> ' + esc(m.ask || "Your manager") + "</span></div>" : ""; }
  function vModule(m) {
    var p = mp(m.id, false);
    if (S.playing !== m.id) { if (S.playing) stopTimer(); S.playing = m.id; timer.at = NOW(); }
    var st = stageOf(m), F = flow(m);
    if (!p) { p = mp(m.id, true); p.version = S.contentVersion; save(); }
    var rvw = S.review === m.id;
    if (isDone(p) && !rvw) return vModuleDone(m, p);
    var pos = Math.min((rvw ? S.reviewPos : p.pos) || 0, F.length - 1), f = F[pos], body = "";
    var STN = ["Departure", "The journey", "Checkpoint", "Arrival"];
    var stations = '<ol class="stations" aria-label="Station ' + (f.st + 1) + " of 4: " + STN[f.st] + '">' + STN.map(function (t, k) { return '<li class="' + (k < f.st ? "past" : k === f.st ? "on" : "") + '">' + t + "</li>"; }).join("") + "</ol>";
    var head = '<div class="player view" style="display:flex;flex-direction:column;gap:14px;--s3:' + st.color + '"><div class="btns" style="justify-content:space-between"><a class="btn alt small" href="#journey">← Journey map</a><span class="small muted">' + esc(st.label + " · " + st.n) + "</span></div>" +
      '<div style="display:flex;gap:14px;align-items:center"><span class="chip" style="--sc:' + st.color + ';height:38px;min-width:56px;font-size:20px">' + esc(m.id) + "</span><h1>" + esc(m.title) + '</h1></div><p class="muted" style="margin-top:-6px">' + esc(m.tagline) + "</p>" + (rvw ? '<p class="note small">Review mode: your result is saved. Nothing you do now changes it. <a href="#" id="endrev">Back to summary</a></p>' : "") + stations;
    function optsHTML(opts, picked, reveal, a, attr) { return '<div class="opts">' + opts.map(function (o, k) { var cls = "opt"; if (reveal) { if (k === a) cls += " right"; else if (k === picked) cls += " wrong"; } return '<button type="button" class="' + cls + '" data-' + attr + '="' + k + '" aria-pressed="' + (picked === k) + '" ' + (reveal ? "disabled" : "") + '><span class="k">' + "ABCDEF"[k] + "</span><span>" + esc(o) + "</span></button>"; }).join("") + "</div>"; }
    if (f.k === "departure") {
      var g = p.guess ? p.guess.pick : undefined;
      body = '<section class="card"><span class="beat">Departure · make your guess</span><h2>' + esc(m.departure.q) + '</h2><p class="small muted">It doesn’t count. Guessing first, even wrong, helps you remember the answer later.</p>' + optsHTML(m.departure.opts, g, false, null, "g") +
        (g !== undefined ? '<div class="guess" role="status"><span class="hand" style="color:var(--brown)">Guess packed!</span><p class="small">We’ll tell you if you were right at the end of the trip.</p></div>' : "") +
        '<div class="btns"><button class="btn go" id="nx" ' + (g !== undefined ? "" : "disabled") + ">Set off →</button></div></section>";
    } else if (f.k === "card") {
      var ci = F.slice(0, pos + 1).filter(function (x) { return x.k === "card"; }).length, ct = F.filter(function (x) { return x.k === "card"; }).length;
      body = '<section class="card"><span class="beat">The journey · ' + ci + " of " + ct + "</span><h2>" + esc(f.s.t) + '</h2><ul style="margin:0;padding-left:20px;display:flex;flex-direction:column;gap:6px">' + f.s.li.map(function (l) { return "<li>" + esc(l) + "</li>"; }).join("") + "</ul>" + (ci === 1 ? docLinks(m, p) : "") +
        '<div class="btns"><button class="btn alt" id="bk">← Back</button><button class="btn go" id="nx">Next →</button></div></section>';
    } else if (f.k === "check") {
      var a = p.answers[f.i], picked = a ? a.pick : undefined, rev = a !== undefined || rvw;
      body = '<section class="card"><span class="beat">The journey · quick check</span><h2>' + esc(f.s.q) + "</h2>" + optsHTML(f.s.opts, picked, rev, f.s.a, "k") +
        (rev ? '<div class="fb ' + (picked === f.s.a || rvw && picked === undefined ? "good" : "bad") + '" role="status"><strong>' + (picked === f.s.a ? "Spot on." : rvw && picked === undefined ? "The answer" : "Not quite.") + "</strong><p>" + esc(f.s.why) + "</p></div>" : "") +
        '<div class="btns"><button class="btn alt" id="bk">← Back</button><button class="btn go" id="nx" ' + (rev ? "" : "disabled") + ">Next →</button></div></section>";
    } else if (f.k === "case") {
      var ca = p.answers[f.i], sel = S.sel && S.sel.pos === pos ? S.sel : {}, revc = ca !== undefined || rvw;
      var ci2 = F.slice(0, pos + 1).filter(function (x) { return x.k === "case"; }).length, ct2 = F.filter(function (x) { return x.k === "case"; }).length;
      var shown = ca ? ca.pick : (rvw ? f.s.a : sel.pick);
      body = '<section class="card"><span class="beat">Checkpoint · case ' + ci2 + " of " + ct2 + "</span><h2>" + esc(f.s.q) + "</h2>" + optsHTML(f.s.opts, revc ? shown : sel.pick, revc, f.s.a, "c") +
        (revc ? '<div class="story" role="status"><span class="hand">What happens next…</span><p>' + esc(f.s.out[shown]) + "</p>" + (shown !== f.s.a ? '<p class="small"><b>The better choice:</b> ' + esc(f.s.opts[f.s.a]) + ".</p>" : "") + (ca ? '<p class="small muted">You said: ' + CONF[ca.conf] + (shown !== f.s.a && ca.conf === 2 ? ". Certain and wrong: that’s the one worth remembering." : "") + "</p>" : "") + "</div>"
          : '<div style="display:flex;flex-direction:column;gap:8px"><p class="small" style="font-weight:700">How sure are you?</p><div class="conf">' + CONF.map(function (c, k) { return '<button type="button" data-f="' + k + '" aria-pressed="' + (sel.conf === k) + '">' + c + "</button>"; }).join("") + "</div></div>") +
        '<div class="btns"><button class="btn alt" id="bk">← Back</button>' + (revc ? '<button class="btn go" id="nx">Next →</button>' : '<button class="btn go" id="chk" ' + (sel.pick !== undefined && sel.conf !== undefined ? "" : "disabled") + ">See what happens</button>") + "</div></section>";
    } else if (f.k === "result") {
      var sc = score(m, p), pass = sc.c / sc.n >= (S.content.passMark || 0.8), gp = p.guess ? p.guess.pick : -1, gok = gp === m.departure.a;
      var guess = '<div class="guess"><div><p class="hand" style="color:var(--brown)">Remember your guess?</p><p class="small">At departure you said “' + esc(m.departure.opts[gp] || "–") + "”. " + (gok ? "Right from the start. " : "") + esc(m.departure.reveal) + "</p></div></div>";
      if (rvw) pass = true;
      body = pass ? '<section class="card"><span class="beat" style="color:var(--good)">Checkpoint passed</span><h2>' + sc.c + " of " + sc.n + " right" + (sc.c === sc.n ? ". Perfect." : ".") + "</h2>" + guess + '<div class="btns"><button class="btn alt" id="bk">← Back</button><button class="btn go" id="nx">On to arrival →</button></div></section>'
        : '<section class="card"><span class="beat">Checkpoint</span><h2>Almost there: ' + sc.c + " of " + sc.n + '</h2><p>You need 80% to pass the checkpoint. Have another go at the questions. The explanations will help.</p>' + guess + '<div class="btns"><button class="btn go" id="retry">Try the questions again</button></div></section>';
    } else {
      var ar = m.arrival;
      if (ar.type === "sign") {
        body = '<section class="card"><span class="beat">Arrival · sign it</span><h2>Sign the ' + esc(ar.policy) + '</h2><div class="sign"><label for="ok"><input type="checkbox" id="ok"><span>' + esc(ar.ack) + '</span></label><label for="nm" class="small" style="font-weight:700;display:block">Type your full name to sign</label><input type="text" id="nm" placeholder="Full name" autocomplete="name"><div class="btns"><button class="btn go" id="fin" disabled>Sign and get your stamp</button></div></div>' + docLinks(m, p) + "</section>";
      } else {
        var need = ar.min || ar.items.length;
        body = '<section class="card"><span class="beat">Arrival · do it</span><h2>' + esc(ar.text) + '</h2><div class="items">' + ar.items.map(function (it, i) { return '<label class="item" for="it' + i + '"><input type="checkbox" id="it' + i + '" data-i="' + i + '" ' + (p.actions && p.actions[i] ? "checked" : "") + "><span>" + (it.url ? '<a href="' + esc(it.url) + '" target="_blank" rel="noopener" data-act="' + i + '">' + esc(it.t) + " ↗</a>" : esc(it.t)) + "</span></label>"; }).join("") + "</div>" +
          '<p class="small muted">' + (need < ar.items.length ? "Tick at least " + need + "." : "Tick each one when it’s done.") + '</p><div class="btns"><button class="btn alt" id="bk">← Back</button><button class="btn go" id="fin" disabled>Finish and get your stamp</button></div></section>';
      }
    }
    show(head + body + '<p class="small muted">Saved after every step. Time on this module: ' + fmtMin(p.timeSec) + ".</p></div>", "#journey");
    var er = $("#endrev"); if (er) er.addEventListener("click", function (e) { e.preventDefault(); S.review = null; vModule(m); });
    function go(d) { tick(); var np = Math.max(0, Math.min(F.length - 1, pos + d)); if (rvw) { if (F[np].k === "arrival") { S.review = null; return vModule(m); } S.reviewPos = np; } else { p.pos = np; save(); } vModule(m); }
    on("[data-g]", "click", function () { tick(); p.guess = { pick: +this.dataset.g, at: NOW() }; save(); vModule(m); });
    on("[data-k]", "click", function () { tick(); var k = +this.dataset.k, ok = k === f.s.a; p.answers[f.i] = { pick: k, correct: ok }; if (!p.first[f.i]) p.first[f.i] = { pick: k, correct: ok }; save(); vModule(m); });
    on("[data-c]", "click", function () { S.sel = { pos: pos, pick: +this.dataset.c, conf: (S.sel && S.sel.pos === pos) ? S.sel.conf : undefined }; vModule(m); });
    on("[data-f]", "click", function () { S.sel = { pos: pos, pick: (S.sel && S.sel.pos === pos) ? S.sel.pick : undefined, conf: +this.dataset.f }; vModule(m); });
    var chk = $("#chk"); if (chk) chk.addEventListener("click", function () { tick(); var ok = S.sel.pick === f.s.a; p.answers[f.i] = { pick: S.sel.pick, correct: ok, conf: S.sel.conf }; if (!p.first[f.i]) p.first[f.i] = { pick: S.sel.pick, correct: ok, conf: S.sel.conf }; S.sel = null; save(); vModule(m); });
    var nx = $("#nx"); if (nx) nx.addEventListener("click", function () { go(1); });
    var bk = $("#bk"); if (bk) bk.addEventListener("click", function () { go(-1); });
    var rt = $("#retry"); if (rt) rt.addEventListener("click", function () { tick(); m.steps.forEach(function (s, i) { if (s.type !== "card") delete p.answers[i]; }); p.attempts = (p.attempts || 1) + 1; p.pos = 2; save(); vModule(m); });
    on("[data-doc]", "click", function () { p.docs = p.docs || {}; p.docs[m.links[+this.dataset.doc].label] = NOW(); save(); });
    on("[data-act]", "click", function () { p.docs = p.docs || {}; p.docs[m.arrival.items[+this.dataset.act].t] = NOW(); save(); });
    var fin = $("#fin");
    if (fin && m.arrival.type === "sign") { var ok = $("#ok"), nm = $("#nm"); var c = function () { fin.disabled = !(ok.checked && nm.value.trim().split(/\s+/).length >= 2); }; ok.addEventListener("change", c); nm.addEventListener("input", c);
      fin.addEventListener("click", function () { p.signed = { name: nm.value.trim(), at: NOW(), policy: m.arrival.policy, version: S.contentVersion }; complete(m, p); }); }
    if (fin && m.arrival.type === "action") { var need2 = m.arrival.min || m.arrival.items.length; var c2 = function () { p.actions = p.actions || {}; $$(".item input").forEach(function (i) { if (i.checked) p.actions[i.dataset.i] = p.actions[i.dataset.i] || NOW(); else delete p.actions[i.dataset.i]; }); fin.disabled = Object.keys(p.actions).length < need2; };
      on(".item input", "change", function () { c2(); save(); }); c2(); fin.addEventListener("click", function () { complete(m, p); }); }
  }
  function complete(m, p) {
    tick(); var sc = score(m, p), t = NOW(), d = S.content.postcardDays || [7, 28];
    p.status = "done"; p.completedAt = t; p.score = sc.c / sc.n; p.best = Math.max(p.best || 0, p.score); p.version = S.contentVersion;
    p.postcards = p.postcards || { w1: { dueAt: t + d[0] * DAY }, w4: { dueAt: t + d[1] * DAY } };
    save(); toast("Stamp added to your passport!"); vModuleDone(m, p, true);
  }
  function vModuleDone(m, p, fresh) {
    var st = stageOf(m), nx = nextModule();
    show('<div class="player view" style="display:flex;flex-direction:column;gap:14px;--s3:' + st.color + '"><div class="btns" style="justify-content:space-between"><a class="btn alt small" href="#journey">← Journey map</a><span class="small muted">' + esc(st.label + " · " + st.n) + "</span></div>" +
      '<div style="display:flex;gap:14px;align-items:center"><span class="chip" style="--sc:' + st.color + ';height:38px;min-width:56px;font-size:20px">' + esc(m.id) + "</span><h1>" + esc(m.title) + "</h1></div>" +
      '<section class="card"><span class="beat" style="color:var(--good)">Arrival</span><h2>' + (fresh ? "Welcome to your next stop." : "You’ve completed this module.") + "</h2>" +
      '<div class="meta"><span>Checkpoint ' + Math.round((p.best || 0) * 100) + "%" + (p.attempts > 1 ? " (" + p.attempts + " tries)" : "") + "</span><span>Time " + fmtMin(p.timeSec) + "</span><span>Finished " + fmtDT(p.completedAt) + "</span>" + (p.signed ? "<span>Signed by " + esc(p.signed.name) + "</span>" : "") + "</div>" +
      '<div class="guess"><div><p class="hand" style="color:var(--brown)">Postcards home</p><p class="small">' + (isGold(p) ? "Your stamp is gold: you remembered it a week later. One more postcard arrives four weeks after you finished." : "In 1 week and again in 4 weeks you’ll get a postcard here with two quick questions about this module. Get both right and your stamp turns gold.") + "</p></div></div>" +
      docLinks(m, p) + '<div class="btns">' + (nx ? '<a class="btn go" href="#m/' + nx.id + '">Next: ' + esc(nx.id + " " + nx.title) + " →</a>" : '<a class="btn go" href="#certificate">My certificate</a>') + '<a class="btn alt" href="#passport">My passport</a><button class="btn alt" id="rv">Read it again</button></div></section></div>', "#journey");
    $("#rv").addEventListener("click", function () { S.review = m.id; S.reviewPos = 1; vModule(m); });
    on("[data-doc]", "click", function () { p.docs = p.docs || {}; p.docs[m.links[+this.dataset.doc].label] = NOW(); save(); });
  }

  /* ---------- passport, postcards, certificate ---------- */
  function vPassport() {
    var rots = [-8, 5, -3, 9, -6, 4, -10, 7, -2, 6, -7, 3, -5, 8, -4, 2, -9, 5, -6, 4];
    var ms = mods(), done = 0, gold = 0;
    var stamps = ms.map(function (m, i) { var p = S.prog.modules[key(m.id)], d = isDone(p), g = isGold(p); if (d) done++; if (g) gold++;
      return '<a href="#m/' + m.id + '" class="stamp' + (d ? "" : " empty") + (g ? " gold" : "") + '" style="text-decoration:none;--stc:' + (d ? stageOf(m).color : "") + ";--rot:" + rots[i % rots.length] + 'deg" title="' + esc(m.title) + '"><span>' + esc(m.title) + "<small>" + (g ? "Remembered ★" : d ? fmtDate(p.completedAt) : m.id) + "</small></span></a>"; }).join("");
    show('<section class="pass view"><div class="btns" style="justify-content:space-between"><div><p class="eyebrow">Last Mile Passport</p><h1>' + done + " of " + ms.length + " stamps" + (gold ? " · " + gold + " gold" : "") + '</h1></div>' + (done === ms.length ? '<a class="btn small" style="background:var(--gold);color:var(--fg);border-color:var(--gold)" href="#certificate">My certificate</a>' : "") + "</div>" +
      '<p class="hand" style="color:var(--gold)">Pamoja, one stamp at a time.</p><p style="color:#F0DCC6;max-width:62ch">A stamp for every finished module. A <b style="color:var(--gold)">gold stamp</b> when you get its postcard right a week later. Collect all ' + ms.length + " for your certificate, plus a shout-out at the Monday meeting.</p><div class=\"stamps\">" + stamps + "</div></section>", "#passport");
  }
  function dueCards() {
    if (!S.content || !S.prog) return [];
    var out = []; mods().forEach(function (m) { var p = S.prog.modules[key(m.id)]; if (!isDone(p) || !p.postcards) return; ["w1", "w4"].forEach(function (w) { var c = p.postcards[w]; if (c && !c.doneAt && c.dueAt <= NOW() && true) out.push({ m: m, w: w }); }); });
    return out;
  }
  function vPostcards() {
    var due = dueCards(), upcoming = [];
    mods().forEach(function (m) { var p = S.prog.modules[key(m.id)]; if (!isDone(p) || !p.postcards) return; ["w1", "w4"].forEach(function (w) { var c = p.postcards[w]; if (c && !c.doneAt && c.dueAt > NOW()) upcoming.push({ m: m, w: w, at: c.dueAt }); }); });
    upcoming.sort(function (a, b) { return a.at - b.at; });
    show('<div class="view" style="display:flex;flex-direction:column;gap:16px"><div><p class="eyebrow">Postcards home</p><h1>' + (due.length ? due.length + " postcard" + (due.length > 1 ? "s" : "") + " waiting" : "No postcards right now") + '</h1><p class="muted">One week and four weeks after each module, a postcard with two questions. It’s how what you learned sticks.</p></div>' +
      (due.length ? '<div class="stops">' + due.map(function (d) { var st = stageOf(d.m); return '<a class="stop doing" style="--sc:' + st.color + '" href="#pc/' + d.m.id + "/" + d.w + '"><span class="st">' + esc(d.m.id) + '</span><span class="tx"><b>Greetings from ' + esc(d.m.title) + "</b><span>" + (d.w === "w1" ? "Week 1" : "Week 4") + " postcard · 1 min</span></span></a>"; }).join("") + "</div>" : "") +
      (upcoming.length ? '<section class="card"><h2>Coming up</h2>' + upcoming.slice(0, 8).map(function (u) { return '<p class="small">' + esc(u.m.id + " " + u.m.title) + ' <span class="muted">· ' + (u.w === "w1" ? "week 1" : "week 4") + " · " + fmtDate(u.at) + "</span></p>"; }).join("") + "</section>" : '<p class="muted">Finish a module, and its first postcard arrives a week later.</p>') + "</div>", "#postcards");
  }
  function vPostcard(m, w) {
    var p = S.prog.modules[key(m.id)];
    if (!isDone(p) || !p.postcards || !p.postcards[w]) { location.hash = "#postcards"; return; }
    var c = p.postcards[w], st = stageOf(m); S.pcAns = S.pcAns && S.pcAns.id === m.id + w ? S.pcAns : { id: m.id + w, a: {} };
    var all = m.postcards.every(function (_, i) { return S.pcAns.a[i] !== undefined; }), right = m.postcards.filter(function (q, i) { return S.pcAns.a[i] === q.a; }).length;
    var qs = m.postcards.map(function (q, i) { var a = S.pcAns.a[i], d = a !== undefined; return '<div style="display:flex;flex-direction:column;gap:10px"><h3>' + (i + 1) + ". " + esc(q.q) + '</h3><div class="opts">' + q.opts.map(function (o, k) { var cls = "opt"; if (d) { if (k === q.a) cls += " right"; else if (k === a) cls += " wrong"; } return '<button type="button" class="' + cls + '" data-q="' + i + '" data-k="' + k + '" ' + (d ? "disabled" : "") + '><span class="k">' + "ABCD"[k] + "</span><span>" + esc(o) + "</span></button>"; }).join("") + "</div>" + (d ? '<p class="small muted">' + esc(q.why) + "</p>" : "") + "</div>"; }).join("");
    show('<div class="view" style="display:flex;flex-direction:column;gap:18px"><div class="btns" style="justify-content:space-between"><a class="btn alt small" href="#postcards">← Postcards</a><span class="small muted">' + (w === "w1" ? "1 week" : "4 weeks") + " after " + esc(m.id) + "</span></div>" +
      '<article class="postcard" style="--s3:' + st.color + '"><div class="front" style="background:' + st.color + '"><div><p class="eyebrow" style="color:var(--gold)">Postcard home · ' + (w === "w1" ? "week 1" : "week 4") + "</p><h2>Greetings from " + esc(m.id + " " + m.title) + '</h2></div><p class="hand">Two questions, one minute. Do you still remember?</p><span class="small" style="opacity:.85">' + (w === "w1" ? "Get both right and your stamp turns gold." : "The last postcard for this module.") + "</span></div>" +
      '<div class="back"><span class="postmark" aria-hidden="true">Last Mile<br>Academy<br>' + esc(new Date(NOW()).toLocaleDateString("en-GB", { day: "numeric", month: "short" })) + '</span><p class="small muted" style="max-width:70%">To: ' + esc(S.prog.name) + "<br>From: your past self, the day you finished</p>" + qs +
      (all ? '<div class="fb ' + (right === m.postcards.length ? "good" : "bad") + '" role="status"><strong>' + (right === m.postcards.length ? (w === "w1" ? "Stamp turned gold!" : "Still remembered!") : right + " of " + m.postcards.length + ". Nearly!") + "</strong><p>" + (right === m.postcards.length ? "Nicely done." : "We’ll send this postcard again in a few days. Repeating it is how it sticks.") + '</p></div><div class="btns"><a class="btn go" href="#postcards">Back to postcards</a></div>' : "") + "</div></article></div>", "#postcards");
    on("[data-q]", "click", function () {
      S.pcAns.a[+this.dataset.q] = +this.dataset.k;
      if (m.postcards.every(function (_, i) { return S.pcAns.a[i] !== undefined; })) {
        var r = m.postcards.filter(function (q, i) { return S.pcAns.a[i] === q.a; }).length;
        c.tries = (c.tries || 0) + 1; if (c.firstCorrect === undefined) { c.firstCorrect = r; c.total = m.postcards.length; }
        if (r === m.postcards.length) c.doneAt = NOW(); else c.dueAt = NOW() + 3 * DAY;
        save();
      }
      vPostcard(m, w);
    });
  }
  function vCertificate() {
    var ms = mods(), done = ms.filter(function (m) { return isDone(S.prog.modules[key(m.id)]); });
    if (done.length < ms.length) { show('<section class="card center view"><h2>Not yet</h2><p>Your certificate unlocks when all ' + ms.length + " modules are done. You’ve done " + done.length + '.</p><a class="btn go" href="#journey">Back to the journey</a></section>', "#passport"); return; }
    var last = Math.max.apply(null, done.map(function (m) { return S.prog.modules[key(m.id)].completedAt; }));
    show('<section class="cert view">' + LOGO + '<p class="eyebrow">Certificate</p><h1>' + esc(S.prog.name) + '</h1><p>has gone the last mile: all ' + ms.length + ' modules of the Last Mile Climate handbook, “Going the Last Mile”.</p><p class="hand">Pamoja!</p><p class="small muted">Completed ' + fmtDate(last) + '</p></section><div class="btns noprint" style="justify-content:center"><button class="btn go" id="pr">Print or save as PDF</button><a class="btn alt" href="#passport">My passport</a></div>', "#passport");
    $("#pr").addEventListener("click", function () { window.print(); });
  }

  /* ---------- admin ---------- */
  function loadAdmin(force) {
    if (S.adminCache && !force) return Promise.resolve(S.adminCache);
    return Promise.all([db.collection("allow").get(), db.collection("progress").get()]).then(function (r) {
      var invites = r[0].docs.map(function (d) { var x = d.data(); x.email = d.id; return x; });
      var progs = r[1].docs.map(function (d) { var x = d.data(); x.uid = d.id; return x; });
      var people = invites.map(function (i) { var pr = progs.filter(function (p) { return p.email === i.email; })[0]; return { email: i.email, name: i.name || i.email, role: i.role, invitedAt: i.invitedAt, prog: pr }; });
      progs.forEach(function (p) { if (!invites.some(function (i) { return i.email === p.email; })) people.push({ email: p.email, name: p.name, role: "removed", prog: p }); });
      people.sort(function (a, b) { return doneCount(b) - doneCount(a) || a.name.localeCompare(b.name); });
      S.adminCache = { people: people, at: NOW() }; return S.adminCache;
    });
  }
  function doneCount(person) { if (!person.prog || !S.content) return 0; return mods().filter(function (m) { return isDone(person.prog.modules[key(m.id)]); }).length; }
  function adminTabs(t) { return '<nav class="tabs" aria-label="Admin">' + [["#admin", "Team progress"], ["#admin/invite", "Invite people"], ["#admin/content", "Content"]].map(function (x) { return '<a href="' + x[0] + '" aria-current="' + (t === x[0] ? "page" : "false") + '">' + x[1] + "</a>"; }).join("") + "</nav>"; }
  function vAdmin(h) {
    var sub = h[1] || "";
    if (sub === "content") return vAdminContent();
    if (!S.content) { location.hash = "#admin/content"; return; }
    show('<div class="view"><p class="muted">Loading team data…</p></div>', "#admin");
    loadAdmin(sub === "" && h[2] === "refresh").then(function (data) {
      if (sub === "invite") return vAdminInvite(data);
      if (sub === "person") return vAdminPerson(data, decodeURIComponent(h[2] || ""));
      vAdminTeam(data);
    }).catch(function (e) { show('<p class="err">' + esc(e.message) + "</p>", "#admin"); });
  }
  function vAdminTeam(data) {
    var ms = mods(), people = data.people.filter(function (p) { return p.role !== "removed"; }), n = people.length;
    var started = people.filter(function (p) { return p.prog && Object.keys(p.prog.modules || {}).length; }).length, fin = people.filter(function (p) { return doneCount(p) === ms.length; }).length;
    var signMods = ms.filter(function (m) { return m.arrival.type === "sign"; });
    var scores = [], pcTot = 0, pcOk = 0, cw = {}, missed = {}, mem = {};
    data.people.forEach(function (pe) { if (!pe.prog) return; ms.forEach(function (m) { var p = pe.prog.modules[key(m.id)]; if (!p) return; if (isDone(p)) scores.push(p.best || 0);
      m.steps.forEach(function (s, i) { var a = p.first && p.first[i]; if (!a || (s.type !== "check" && s.type !== "case")) return; var k = m.id + "#" + i; missed[k] = missed[k] || { m: m, s: s, n: 0, wrong: 0, cw: 0, conf: 0 }; missed[k].n++; if (!a.correct) missed[k].wrong++; if (s.type === "case") { missed[k].conf++; if (!a.correct && a.conf === 2) missed[k].cw++; } });
      if (p.postcards) ["w1", "w4"].forEach(function (w) { var c = p.postcards[w]; if (c && c.firstCorrect !== undefined) { pcTot += c.total; pcOk += c.firstCorrect; var sk = m.stage + w; mem[sk] = mem[sk] || [0, 0]; mem[sk][0] += c.firstCorrect; mem[sk][1] += c.total; } }); }); });
    var avg = scores.length ? Math.round(scores.reduce(function (a, b) { return a + b; }, 0) / scores.length * 100) + "%" : "–";
    var kpis = [[n, "Invited"], [started, "Started"], [fin, "Finished all"]].concat(signMods.map(function (m) { return [people.filter(function (p) { var x = p.prog && p.prog.modules[key(m.id)]; return x && x.signed; }).length + "/" + n, "Signed " + m.title]; })).concat([[avg, "Average score"], [pcTot ? Math.round(pcOk / pcTot * 100) + "%" : "–", "Still remember (postcards)"]]);
    var heads = ms.map(function (m) { return '<th class="c" title="' + esc(m.title) + '">' + esc(m.id) + "</th>"; }).join("");
    var rows = people.map(function (pe) {
      var t = 0, sc = []; var cells = ms.map(function (m) { var p = pe.prog && pe.prog.modules[key(m.id)]; if (p) t += p.timeSec || 0; if (isDone(p)) sc.push(p.best || 0); var c = !p ? "" : isGold(p) ? "dg" : isDone(p) ? "d" : "p"; return '<td class="c"><span class="cell ' + c + '" title="' + esc(pe.name + " · " + m.id + " " + m.title + ": " + (!p ? "not started" : isDone(p) ? "done " + fmtDate(p.completedAt) + (isGold(p) ? ", remembered" : "") : "in progress")) + '"></span></td>'; }).join("");
      var pct = Math.round(doneCount(pe) / ms.length * 100), cocs = signMods.map(function (m) { var x = pe.prog && pe.prog.modules[key(m.id)]; return '<td><span class="pill ' + (x && x.signed ? "ok" : "no") + '">' + (x && x.signed ? fmtDate(x.signed.at) : "Not yet") + "</span></td>"; }).join("");
      return '<tr><td><span style="display:flex;gap:8px;align-items:center">' + av(pe.name) + '<span><a class="pname" href="#admin/person/' + encodeURIComponent(pe.email) + '">' + esc(pe.name) + '</a><br><span class="small muted">' + esc(pe.email) + '</span></span></span></td><td><span class="pill ' + (pct === 100 ? "ok" : pct > 0 ? "mid" : "no") + '">' + pct + "%</span></td>" + cells + "<td>" + fmtMin(t) + "</td><td>" + (sc.length ? Math.round(sc.reduce(function (a, b) { return a + b; }, 0) / sc.length * 100) + "%" : "–") + "</td>" + cocs + '<td class="muted">' + (pe.prog ? ago(pe.prog.lastActive) : "Not signed in yet") + "</td></tr>";
    }).join("");
    var cwl = Object.keys(missed).map(function (k) { return missed[k]; }).filter(function (x) { return x.cw > 0; }).sort(function (a, b) { return b.cw / b.conf - a.cw / a.conf; }).slice(0, 6);
    var ml = Object.keys(missed).map(function (k) { return missed[k]; }).filter(function (x) { return x.n >= 1 && x.wrong; }).sort(function (a, b) { return b.wrong / b.n - a.wrong / a.n; }).slice(0, 6);
    show(adminTabs("#admin") + '<div class="btns view" style="justify-content:space-between"><div><p class="eyebrow">Admin</p><h1>Team progress</h1></div><div class="btns"><a class="btn alt small" href="#admin//refresh" id="rf">Refresh</a><button class="btn small" id="csv">Export to Excel (CSV)</button><button class="btn alt small" id="nudge">Copy “not finished” list</button></div></div>' +
      '<div class="kpis view" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr))">' + kpis.map(function (k) { return '<div class="kpi"><span class="v">' + k[0] + '</span><span class="l">' + esc(k[1]) + "</span></div>"; }).join("") + "</div>" +
      '<section class="card view" style="gap:12px"><h2>Who has done what</h2><div class="legend"><span><i class="cell d"></i>Done</span><span><i class="cell dg"></i>Done and remembered (postcard)</span><span><i class="cell p"></i>In progress</span><span><i class="cell"></i>Not started</span><span>Click a name for the full history.</span></div>' +
      '<div class="tablewrap"><table><thead><tr><th>Person</th><th>Progress</th>' + heads + "<th>Time</th><th>Avg score</th>" + signMods.map(function (m) { return "<th>" + esc(m.title) + "</th>"; }).join("") + "<th>Last active</th></tr></thead><tbody>" + (rows || '<tr><td colspan="40" class="muted">No one invited yet. Go to “Invite people”.</td></tr>') + "</tbody></table></div></section>" +
      '<div class="two view"><section class="card"><h2>Confidently wrong</h2><p class="small muted">Checkpoint cases answered wrong while saying “Certain”, first try. That’s the real risk with policies.</p>' + (cwl.length ? cwl.map(function (x) { return '<div class="risk"><span class="q">' + esc(x.m.id + " · " + x.s.q) + '</span><span class="pill no">' + Math.round(x.cw / x.conf * 100) + "% certain + wrong</span><span class=\"d\">" + x.cw + " of " + x.conf + " people. Right answer: " + esc(x.s.opts[x.s.a]) + "</span></div>"; }).join("") : '<p class="small muted">Nothing yet.</p>') + "</section>" +
      '<section class="card"><h2>Do people remember?</h2><p class="small muted">Postcard questions answered right on the first try, 1 and 4 weeks after finishing.</p><div class="mem h"><span>Stage</span><b>Week 1</b><b>Week 4</b></div>' + S.content.stages.map(function (s) { var a = mem[s.id + "w1"], b = mem[s.id + "w4"]; function f(x) { return x && x[1] ? Math.round(x[0] / x[1] * 100) + "%" : "–"; } return '<div class="mem"><span>' + esc(s.n) + "</span><b>" + f(a) + "</b><b>" + f(b) + "</b></div>"; }).join("") + "</section></div>" +
      '<section class="card view"><h2>Most missed questions</h2><p class="small muted">First-try answers. A sign the handbook or the policy could be clearer.</p>' + (ml.length ? ml.map(function (x) { return '<div class="hbar"><span class="t">' + esc(x.m.id + " · " + x.s.q) + '</span><span class="track"><i style="width:' + Math.round(x.wrong / x.n * 100) + '%"></i></span><b>' + Math.round(x.wrong / x.n * 100) + "%</b></div>"; }).join("") : '<p class="small muted">Nothing yet.</p>') + "</section>" +
      '<p class="small muted">Data as of ' + fmtDT(data.at) + ".</p>", "#admin");
    $("#rf").addEventListener("click", function (e) { e.preventDefault(); S.adminCache = null; vAdmin(["admin"]); });
    $("#csv").addEventListener("click", function () { downloadCSV(data); });
    $("#nudge").addEventListener("click", function () { var list = people.filter(function (p) { return doneCount(p) < ms.length; }).map(function (p) { return p.name + " (" + doneCount(p) + "/" + ms.length + ")"; }); copyText("Still on the road with the handbook modules: " + list.join(", "), "List copied: paste it into Teams"); });
  }
  function copyText(t, msg) { try { navigator.clipboard.writeText(t).then(function () { toast(msg); }, function () { prompt("Copy this:", t); }); } catch (e) { prompt("Copy this:", t); } }
  function downloadCSV(data) {
    var rows = [["Name", "Email", "Module", "Title", "Status", "Started", "Finished", "Minutes", "Checkpoint tries", "Best score %", "Signed", "Signed at", "Postcard wk1", "Postcard wk4", "Documents opened"]];
    data.people.forEach(function (pe) { mods().forEach(function (m) { var p = pe.prog && pe.prog.modules[key(m.id)];
      function pcs(w) { var c = p && p.postcards && p.postcards[w]; return !c ? "" : c.doneAt ? "remembered" : c.firstCorrect !== undefined ? c.firstCorrect + "/" + c.total + " first try" : c.dueAt <= NOW() ? "due" : "due " + fmtDate(c.dueAt); }
      rows.push([pe.name, pe.email, m.id, m.title, !p ? "not started" : p.status === "done" ? "done" : "in progress", p ? fmtDate(p.startedAt) : "", p && p.completedAt ? fmtDate(p.completedAt) : "", p ? Math.round((p.timeSec || 0) / 60) : "", p ? p.attempts || 1 : "", p && p.best !== undefined ? Math.round(p.best * 100) : "", p && p.signed ? p.signed.name : "", p && p.signed ? fmtDT(p.signed.at) : "", pcs("w1"), pcs("w4"), p && p.docs ? Object.keys(p.docs).join("; ") : ""]); }); });
    var csv = "﻿" + rows.map(function (r) { return r.map(function (c) { c = String(c); return /[",;\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(","); }).join("\r\n");
    var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); a.download = "lmc-academy-progress-" + new Date(NOW()).toISOString().slice(0, 10) + ".csv"; document.body.appendChild(a); a.click(); a.remove();
  }
  function vAdminPerson(data, email) {
    var pe = data.people.filter(function (p) { return p.email === email; })[0]; if (!pe) { location.hash = "#admin"; return; }
    var rows = mods().map(function (m) { var p = pe.prog && pe.prog.modules[key(m.id)];
      var cw = 0; if (p && p.first) m.steps.forEach(function (s, i) { var a = p.first[i]; if (a && s.type === "case" && !a.correct && a.conf === 2) cw++; });
      return "<tr><td><b>" + esc(m.id) + "</b> " + esc(m.title) + "</td><td>" + (!p ? '<span class="pill no">Not started</span>' : isDone(p) ? '<span class="pill ok">Done ' + fmtDate(p.completedAt) + "</span>" : '<span class="pill mid">In progress</span>') + "</td><td>" + (p ? fmtMin(p.timeSec) : "") + "</td><td>" + (p && p.best !== undefined ? Math.round(p.best * 100) + "%" : "") + "</td><td>" + (p ? p.attempts || 1 : "") + "</td><td>" + (cw ? '<span class="pill no">' + cw + "</span>" : "") + "</td><td>" + (p && p.signed ? esc(p.signed.name) + "<br><span class=\"small muted\">" + fmtDT(p.signed.at) + "</span>" : "") + "</td><td>" + (p && p.postcards ? ["w1", "w4"].map(function (w) { var c = p.postcards[w]; return (w === "w1" ? "Wk1: " : "Wk4: ") + (c.doneAt ? "★" : c.firstCorrect !== undefined ? c.firstCorrect + "/" + c.total : c.dueAt <= NOW() ? "due" : fmtDate(c.dueAt)); }).join("<br>") : "") + '</td><td class="small">' + (p && p.docs ? Object.keys(p.docs).map(esc).join("<br>") : "") + "</td></tr>"; }).join("");
    show(adminTabs("#admin") + '<div class="view btns" style="justify-content:space-between"><div style="display:flex;gap:12px;align-items:center">' + av(pe.name) + "<div><h1>" + esc(pe.name) + '</h1><p class="muted small">' + esc(pe.email) + " · " + esc(pe.role) + (pe.invitedAt ? " · invited " + fmtDate(pe.invitedAt) : "") + '</p></div></div><a class="btn alt small" href="#admin">← Team progress</a></div>' +
      '<dl class="kv view"><dt>Modules done</dt><dd>' + doneCount(pe) + " of " + mods().length + "</dd><dt>Last active</dt><dd>" + (pe.prog ? ago(pe.prog.lastActive) : "Not signed in yet") + '</dd></dl><div class="tablewrap view"><table class="small-table"><thead><tr><th>Module</th><th>Status</th><th>Time</th><th>Best</th><th>Tries</th><th>Certain + wrong</th><th>Signed</th><th>Postcards</th><th>Documents opened</th></tr></thead><tbody>' + rows + "</tbody></table></div>", "#admin");
  }
  function vAdminInvite(data) {
    var list = data.people.filter(function (p) { return p.role !== "removed"; });
    show(adminTabs("#admin/invite") + '<div class="two view"><section class="card"><h2>Invite one person</h2><form id="one" style="display:flex;flex-direction:column;gap:10px"><label class="f" for="iname">Name<input id="iname" type="text" required placeholder="First and last name"></label><label class="f" for="iemail">Work email<input id="iemail" type="email" required></label><label class="f" for="irole">Role<select id="irole"><option value="learner">Learner</option><option value="admin">Admin (sees everyone’s progress)</option></select></label><button class="btn go" type="submit">Add to the invite list</button></form><p class="small muted">They then go to the Academy link and sign in with this email. Nothing is emailed automatically: send them the link in Teams.</p></section>' +
      '<section class="card"><h2>Invite several</h2><p class="small muted">One person per line: <code>Name, email</code></p><textarea id="bulk" placeholder="Amani Kibet, amani@lastmileclimate.org"></textarea><button class="btn" id="addbulk" type="button">Add all as learners</button><div id="bmsg"></div></section></div>' +
      '<section class="card view"><h2>On the list (' + list.length + ')</h2><div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Signed in</th><th></th></tr></thead><tbody>' + list.map(function (p) { return "<tr><td>" + esc(p.name) + "</td><td>" + esc(p.email) + "</td><td>" + esc(p.role) + "</td><td>" + (p.prog ? "Yes" : "Not yet") + "</td><td>" + (p.email === S.user.email.toLowerCase() ? "" : '<button class="btn alt small" data-rm="' + esc(p.email) + '">Remove</button>') + "</td></tr>"; }).join("") + "</tbody></table></div><p class=\"small muted\">Removing someone stops their access. Their progress stays in the records.</p></section>", "#admin");
    function add(name, email, role) { email = email.trim().toLowerCase(); return db.collection("allow").doc(email).set({ name: name.trim(), role: role, invitedAt: NOW(), invitedBy: S.user.email.toLowerCase() }); }
    $("#one").addEventListener("submit", function (e) { e.preventDefault(); add($("#iname").value, $("#iemail").value, $("#irole").value).then(function () { toast("Added."); S.adminCache = null; vAdmin(["admin", "invite"]); }).catch(function (er) { toast("Couldn't add: " + er.message); }); });
    $("#addbulk").addEventListener("click", function () { var lines = $("#bulk").value.split(/\n/).map(function (l) { return l.split(/[,;\t]/); }).filter(function (p) { return p.length >= 2 && /@/.test(p[p.length - 1]); });
      if (!lines.length) { $("#bmsg").innerHTML = '<p class="err">No lines in the format “Name, email” found.</p>'; return; }
      Promise.all(lines.map(function (p) { return add(p.slice(0, -1).join(" "), p[p.length - 1], "learner"); })).then(function () { toast(lines.length + " added."); S.adminCache = null; vAdmin(["admin", "invite"]); }).catch(function (er) { $("#bmsg").innerHTML = '<p class="err">' + esc(er.message) + "</p>"; }); });
    on("[data-rm]", "click", function () { var em = this.dataset.rm, b = this; if (b.dataset.sure !== "1") { b.dataset.sure = "1"; b.textContent = "Click again to remove"; return; } db.collection("allow").doc(em).delete().then(function () { toast("Removed."); S.adminCache = null; vAdmin(["admin", "invite"]); }); });
  }
  function validateContent(c) {
    if (!c || !Array.isArray(c.modules) || !Array.isArray(c.stages) || !c.version) return "Missing version, stages or modules.";
    for (var i = 0; i < c.modules.length; i++) { var m = c.modules[i]; if (!m.id || !m.title || !m.departure || !Array.isArray(m.steps) || !m.arrival || !Array.isArray(m.postcards)) return "Module " + (m.id || i) + " is incomplete."; }
    return "";
  }
  function vAdminContent() {
    show(adminTabs("#admin/content") + '<section class="card view"><h2>Handbook content</h2>' + (S.content ? '<p>Loaded: version <b>' + esc(S.contentVersion) + "</b> · " + mods().length + " modules.</p>" : '<p class="note">No content loaded yet. Load the <code>content.json</code> file you received.</p>') +
      '<label class="f" for="file">Load a content file (content.json)<input type="file" id="file" accept="application/json,.json"></label><div id="cmsg"></div>' +
      '<p class="small muted">The content is stored in your Firebase project, visible only to signed-in invited people. It’s not in the public code. Loading a new version keeps everyone’s progress; the dashboard records which version each person completed.</p>' + (S.content ? '<div class="btns"><button class="btn alt small" id="dl">Download the current content (backup)</button></div>' : "") + "</section>", "#admin");
    $("#file").addEventListener("change", function () { var f = this.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () {
      var c; try { c = JSON.parse(r.result); } catch (e) { $("#cmsg").innerHTML = '<p class="err">That file isn’t valid JSON.</p>'; return; }
      var bad = validateContent(c); if (bad) { $("#cmsg").innerHTML = '<p class="err">' + esc(bad) + "</p>"; return; }
      db.collection("content").doc("current").set({ version: c.version, json: JSON.stringify(c), updatedAt: NOW(), updatedBy: S.user.email.toLowerCase() }).then(function () {
        S.content = c; S.contentVersion = c.version; $("#cmsg").innerHTML = '<p class="ok">Loaded version ' + esc(c.version) + " with " + c.modules.length + ' modules. <a href="#journey">Open the journey</a></p>';
      }).catch(function (e) { $("#cmsg").innerHTML = '<p class="err">' + esc(e.message) + "</p>"; }); }; r.readAsText(f); });
    var dl = $("#dl"); if (dl) dl.addEventListener("click", function () { var a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(S.content, null, 1)], { type: "application/json" })); a.download = "lmc-academy-content-" + S.contentVersion + ".json"; document.body.appendChild(a); a.click(); a.remove(); });
  }

  /* ---------- start ---------- */
  if (auth.isSignInWithEmailLink(location.href)) { var em = store("lmcEmail"); if (em) finishLink(em); else vConfirmEmail(); }
  auth.onAuthStateChanged(function (u) { if (u) boot(u); else { S.user = S.prog = S.content = null; S.adminCache = null; if (!auth.isSignInWithEmailLink(location.href)) vSignin(); } });
})();
