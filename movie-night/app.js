/* Movie Night - guest phone page (static site; talks to the Samsung TV through the encrypted relay, see net.js).
 * Holds nothing but tonight's code/seat (net.js) and, optionally, the name you typed last time. */
(function () {
  "use strict";
  var C = window.MNCards, esc = C.esc;
  function $(id) { return document.getElementById(id); }
  var N = window.MNNet, pid = N.pid(), over = false;
  var S = null, polling = false, deckSig = "", idx = 0, busy = false, lastMatchSeq = -1, history = [];
  var RT = [[0, "Any"], [100, "< 1h 40"], [120, "< 2h"], [150, "< 2h 30"]];

  function api(path, body) {
    body = body || {}; body.pid = pid;
    if (over) return Promise.resolve({ ok: false, ended: true });
    return MNFetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (j) { if (j && j.ended) ended(); return j; })
      .catch(function () { toast("Can't reach the TV. Is Movie Night open on it?"); return { ok: false }; });
  }
  var gen = 0;
  function poll(force) {
    if (over || (polling && !force)) return; polling = true;
    var my = ++gen;
    MNFetch("/api/state?pid=" + encodeURIComponent(pid) + "&v=" + (S && !force ? S.v : -1), { cache: "no-store" })
      .then(function (r) { return r.json(); })
      .then(function (s) { if (my !== gen) return; polling = false; if (s && s.ended) { ended(); return; } S = s; render(); poll(); })
      .catch(function () { if (my !== gen) return; polling = false; if (!S) $("connTxt").textContent = "Still trying\u2026 Is Movie Night open on the TV?"; setTimeout(poll, 2000); });
  }
  document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(true); });

  /** the TV ended this night (new night, End & exit, or 12 h): forget the code and control nothing */
  function ended() {
    if (over) return; over = true; pid = ""; S = null; N.ended(); closeSheet();
    $("who").textContent = ""; $("net").classList.add("hidden"); view("vEnded");
  }
  function view(id) {
    ["vPair", "vConnect", "vJoin", "vLobby", "vBuild", "vSwipe", "vWait", "vResults", "vEnded"].forEach(function (v) { $(v).classList.toggle("hidden", v !== id); });
  }

  function render() {
    if (!S) return;
    if (pid && !S.you) { pid = ""; N.setPid(""); }
    $("who").textContent = S.you ? S.you.name : "";
    if (lastMatchSeq < 0) lastMatchSeq = S.matchSeq;
    if (S.matchSeq > lastMatchSeq) { lastMatchSeq = S.matchSeq; if (S.pendingMatch) matchPop(S.pendingMatch); }
    if (!S.you) { view("vJoin"); renderJoin(); return; }
    if (S.phase === "lobby") { view("vLobby"); renderLobby(); return; }
    if (S.phase === "building") { view("vBuild"); return; }
    if (S.phase === "swiping") {
      var sig = (S.deck || []).map(function (m) { return m.id; }).join(",");
      if (sig !== deckSig) { deckSig = sig; idx = S.you.next; history = []; drawStack(); }
      if (idx < S.deck.length) { view("vSwipe"); updateCount(); }
      else { view("vWait"); var w = others().filter(function (p) { return !p.done && !p.away; }); $("waitTxt").textContent = w.length ? "Waiting for " + w.map(function (p) { return p.name + " (" + p.progress + " of " + S.deckSize + ")"; }).join(", ") : "Finishing up\u2026"; }
      return;
    }
    if (S.phase === "results") { view("vResults"); renderResults(); deckSig = ""; }
  }
  function others() { return (S.players || []).filter(function (p) { return !p.you; }); }

  // ---------------------------------------------------------------- join
  function renderJoin() {
    var n = (S.players || []).length, max = S.maxPlayers || 6;
    $("joinInfo").textContent = n ? n + " of " + max + " seats taken" : "You're first! Up to " + max + " people.";
    if (!$("name").value && !$("name").getAttribute("data-filled")) { $("name").value = localStorage.getItem("mn.name") || ""; $("name").setAttribute("data-filled", "1"); }
  }
  $("joinForm").addEventListener("submit", function (e) { e.preventDefault(); join($("name").value.trim()); });
  function join(n) {
    try { if (n) localStorage.setItem("mn.name", n); else localStorage.removeItem("mn.name"); } catch (x) {}
    api("/api/join", { name: n }).then(function (j) {
      if (!j.ok) { if (!j.ended) $("joinErr").textContent = j.error || "Couldn't join"; return; }
      pid = j.pid; N.setPid(pid); $("joinErr").textContent = "";
      if (n && j.name !== n) toast("Someone already has that name, so you're " + j.name);
      poll(true);
    });
  }
  $("leave").addEventListener("click", function (e) {
    e.preventDefault();
    api("/api/leave").then(function () { pid = ""; N.setPid(""); poll(true); });
  });

  // ---------------------------------------------------------------- lobby
  function renderLobby() {
    var o = others();
    $("partner").innerHTML = o.length ? o.map(function (p) { return '<div class="av av-' + p.color + (p.away ? " away" : "") + '">' + esc(p.name.charAt(0).toUpperCase()) + "</div>"; }).join("") +
        "<span>" + esc(o.map(function (p) { return p.name + (p.away ? " (away)" : ""); }).join(", ")) + (o.length === 1 ? " is" : " are") + " here too</span>"
      : '<div class="av av-empty">?</div><span class="muted">Waiting for others to scan the TV\u2026</span>';
    $("feed").innerHTML = (S.feed || []).length ? '<div class="feedh">Recent filter changes</div>' + S.feed.map(function (x) { return "<div><b>" + esc(x.by) + "</b> " + esc(x.what) + "</div>"; }).join("") : '<div class="feedh">Anyone can change the filters. Changes show here and on the TV.</div>';
    var f = S.filters, h = "";
    S.moodDefs.forEach(function (m) { h += '<button class="chip' + (f.moods.indexOf(m.key) >= 0 ? " on" : "") + '" data-mood="' + m.key + '">' + esc(m.label) + "</button>"; });
    $("moods").innerHTML = h;
    h = ""; RT.forEach(function (r) { h += '<button class="chip' + (f.maxRuntime === r[0] ? " on" : "") + '" data-rt="' + r[0] + '">' + r[1] + "</button>"; });
    $("rts").innerHTML = h;
    [["hols", S.holidayDefs, "holiday"], ["eras", S.eraDefs, "era"], ["rateds", S.ratedDefs, "rated"]].forEach(function (x) {   // v0.5.1 single-pick rows
      $(x[0]).innerHTML = (x[1] || []).map(function (d) { return '<button class="chip' + ((f[x[2]] || "") === d.key ? " on" : "") + '" data-v="' + d.key + '">' + esc(d.label) + "</button>"; }).join("");
    });
    h = ""; S.installed.forEach(function (a) { h += '<button class="chip' + (f.services.indexOf(a.key) >= 0 ? " on" : "") + (S.tmdb ? "" : " dis") + '" data-svc="' + a.key + '">' + esc(a.name) + "</button>"; });
    $("svcs").innerHTML = h;
    $("svcWrap").classList.toggle("hidden", !S.installed.length);
    $("fit").textContent = S.tmdb ? "Movie data: TMDB" : S.fitCount + " movies fit these filters";
    var ready = (S.active || 0) >= 2;
    $("startBtn").disabled = !ready;
    $("startBtn").textContent = ready ? "Start swiping" : "Waiting for 2 people\u2026";
  }
  $("moods").addEventListener("click", function (e) {
    var k = e.target.getAttribute("data-mood"); if (!k) return;
    var ms = S.filters.moods.slice(), i = ms.indexOf(k); if (i >= 0) ms.splice(i, 1); else ms.push(k);
    S.filters.moods = ms; renderLobby(); api("/api/filters", { moods: ms });
  });
  $("rts").addEventListener("click", function (e) {
    var k = e.target.getAttribute("data-rt"); if (k === null) return;
    S.filters.maxRuntime = +k; renderLobby(); api("/api/filters", { maxRuntime: +k });
  });
  ["hols", "eras", "rateds"].forEach(function (id) {
    $(id).addEventListener("click", function (e) {
      var v = e.target.getAttribute("data-v"); if (v === null) return;
      var fk = $(id).getAttribute("data-f"), o = {}; o[fk] = v; S.filters[fk] = v; renderLobby(); api("/api/filters", o);
    });
  });
  $("svcs").addEventListener("click", function (e) {
    var k = e.target.getAttribute("data-svc"); if (!k) return;
    if (!S.tmdb) { toast("App filters need live movie data on the TV"); return; }
    var sv = S.filters.services.slice(), i = sv.indexOf(k); if (i >= 0) sv.splice(i, 1); else sv.push(k);
    S.filters.services = sv; renderLobby(); api("/api/filters", { services: sv });
  });
  $("startBtn").addEventListener("click", function () { api("/api/start").then(function (j) { if (!j.ok) toast(j.error); }); });

  // ---------------------------------------------------------------- swiping
  function cardHtml(m) {
    var on = (S.installed || []).filter(function (x) { return (m.providers || []).indexOf(x.key) >= 0; }).map(function (x) { return x.name; });
    var pv = on.length ? '<div class="pv">On ' + esc(on.join(", ")) + "</div>" : "";
    return '<button class="infobtn" type="button" aria-label="More info">ⓘ More</button>' + C.card(m, 38, "", pv + (m.overview ? '<div class="ov">' + esc(m.overview) + "</div>" : "")) +
      '<div class="stamp yes">YES</div><div class="stamp no">NOPE</div><div class="stamp maybe">MAYBE</div>';
  }
  function drawStack() {
    var st = $("stack"), d = S.deck || [], h = "";
    if (idx + 1 < d.length) h += '<div class="swcard next" id="cNext">' + cardHtml(d[idx + 1]) + "</div>";
    if (idx < d.length) h += '<div class="swcard" id="cTop">' + cardHtml(d[idx]) + "</div>";
    st.innerHTML = h; attach($("cTop")); updateCount();
  }
  function updateCount() {
    var n = (S.deck || []).length;
    $("count").textContent = Math.min(idx + 1, n) + " / " + n;
    $("undo").disabled = !history.length;
  }
  function setStamps(el, dx, dy) {
    var s = el.querySelectorAll(".stamp");
    s[0].style.opacity = Math.max(0, Math.min(1, dx / 90));
    s[1].style.opacity = Math.max(0, Math.min(1, -dx / 90));
    s[2].style.opacity = Math.abs(dx) < 60 ? Math.max(0, Math.min(1, -dy / 100)) : 0;
  }
  function attach(el) {
    if (!el) return;
    var sx = 0, sy = 0, dx = 0, dy = 0, down = false;
    el.addEventListener("pointerdown", function (e) { if (busy || sheetOpen || (e.target.closest && e.target.closest(".infobtn"))) return; down = true; sx = e.clientX; sy = e.clientY; dx = dy = 0; el.style.transition = "none"; try { el.setPointerCapture(e.pointerId); } catch (x) {} });
    el.addEventListener("pointermove", function (e) {
      if (!down) return; dx = e.clientX - sx; dy = e.clientY - sy;
      el.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (dx / 18) + "deg)"; setStamps(el, dx, dy);
    });
    function end() {
      if (!down) return; down = false;
      if (dx > 95) decide("yes"); else if (dx < -95) decide("no"); else if (dy < -110) decide("maybe");
      else if (Math.abs(dx) < 8 && Math.abs(dy) < 8) { el.style.transform = ""; setStamps(el, 0, 0); openSheet(S.deck[idx]); }   // a tap = details
      else { el.style.transition = "transform .2s"; el.style.transform = ""; setStamps(el, 0, 0); }
    }
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  }
  function decide(v) {
    var el = $("cTop"); if (!el || busy || !S.deck || idx >= S.deck.length) return;
    busy = true;
    var m = S.deck[idx];
    var tx = v === "yes" ? "translate(140%, 30px) rotate(22deg)" : v === "no" ? "translate(-140%, 30px) rotate(-22deg)" : "translate(0,-130%)";
    setStamps(el, v === "yes" ? 120 : v === "no" ? -120 : 0, v === "maybe" ? -150 : 0);
    el.style.transition = "transform .22s ease-in"; el.style.transform = tx;
    history.push(m.id); idx++;
    api("/api/vote", { id: m.id, v: v }).then(function (j) { if (j && j.match) matchPop(m); });
    setTimeout(function () {
      busy = false;
      if (idx < S.deck.length) drawStack(); else render();
    }, 200);
    if (navigator.vibrate) try { navigator.vibrate(8); } catch (x) {}
  }
  $("stack").addEventListener("click", function (e) { if (e.target.closest && e.target.closest(".infobtn") && S.deck && S.deck[idx]) openSheet(S.deck[idx]); });

  // ---------------------------------------------------------------- full-detail sheet (doesn't vote)
  var sheetOpen = false, sheetMovie = null;
  var SVC = { netflix: "Netflix", hulu: "Hulu", prime: "Prime Video", disney: "Disney+", max: "Max", peacock: "Peacock", paramount: "Paramount+", appletv: "Apple TV+", vix: "ViX", tubi: "Tubi" };
  function openSheet(m) {
    if (!m) return;
    sheetMovie = m; sheetOpen = true;
    $("shMedia").innerHTML = m.poster ? '<img src="' + esc(m.poster) + '" alt="">' : "";
    $("shTitle").textContent = m.title;
    $("shMeta").textContent = [m.year || "", C.runtime(m.runtime), m.rating || ""].filter(Boolean).join(" · ");
    $("shGenres").innerHTML = (m.genres || []).map(function (g) { return "<span>" + esc(g) + "</span>"; }).join("");
    var mine = (S.filters && S.filters.services && S.filters.services.length ? S.filters.services : (S.installed || []).map(function (a) { return a.key; }));
    var on = (m.providers || []).filter(function (k) { return mine.indexOf(k) >= 0; }).map(function (k) { return SVC[k] || k; });
    var other = (m.providers || []).filter(function (k) { return mine.indexOf(k) < 0; }).map(function (k) { return SVC[k] || k; });
    $("shWhere").textContent = on.length ? "On " + on.join(", ") : other.length ? "Not on the TV's apps (on " + other.join(", ") + ")" : "Streaming info not available";
    $("shWhere").className = "shwhere" + (on.length ? "" : " none");
    $("shOv").textContent = m.overview || "No description on TMDB.";
    var t = /^[A-Za-z0-9_-]{6,20}$/.test(m.trailer || "") ? m.trailer : "";
    $("shTrailer").classList.toggle("hidden", !t);
    $("shYt").innerHTML = t ? 'Trailer not playing? <a href="https://www.youtube.com/watch?v=' + t + '" target="_blank" rel="noopener">Open it in YouTube</a>' : "";
    $("sheet").classList.remove("hidden"); document.body.classList.add("noscroll");
    $("sheet").querySelector(".sheetbody").scrollTop = 0;
  }
  function closeSheet() {
    sheetOpen = false; sheetMovie = null; $("shMedia").innerHTML = "";   // removing the iframe stops the trailer
    $("sheet").classList.add("hidden"); document.body.classList.remove("noscroll");
  }
  $("sheet").addEventListener("click", function (e) { if (e.target.getAttribute("data-close")) closeSheet(); });
  $("shPlay").addEventListener("click", function () {
    var m = sheetMovie; if (!m || !m.trailer) return;
    $("shMedia").innerHTML = '<div class="yt"><iframe src="https://www.youtube-nocookie.com/embed/' + encodeURIComponent(m.trailer) + '?autoplay=1&playsinline=1&rel=0&modestbranding=1" title="Trailer" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
  });
  $("shTv").addEventListener("click", function () {
    var m = sheetMovie; if (!m) return;
    api("/api/trailer", { id: m.id }).then(function (j) { toast(j && j.ok ? "Playing on the TV. Press Back on the remote to return" : (j && j.error) || "Couldn't play it on the TV"); });
  });
  $("rList").addEventListener("click", function (e) {
    var el = e.target.closest && e.target.closest("[data-mid]"); if (!el) return;
    var id = el.getAttribute("data-mid"), r = S.results || {}, all = (r.matches || []).concat((r.majority || []).concat(r.closest || []).map(function (c) { return c.movie; }));
    for (var i = 0; i < all.length; i++) if (all[i].id === id) { openSheet(all[i]); return; }
  });

  $("bYes").addEventListener("click", function () { decide("yes"); });
  $("bNo").addEventListener("click", function () { decide("no"); });
  $("bMaybe").addEventListener("click", function () { decide("maybe"); });
  $("undo").addEventListener("click", function () {
    if (!history.length || busy) return;
    api("/api/undo").then(function (j) { if (j.ok) { history.pop(); idx = Math.max(0, idx - 1); drawStack(); render(); } });
  });

  var popT = null;
  function matchPop(m) {
    $("matchPop").innerHTML = "\ud83c\udf7f It's a match: " + esc(m.title) + "<small>Look at the TV. Keep swiping for more.</small>";
    $("matchPop").classList.remove("hidden");
    if (navigator.vibrate) try { navigator.vibrate([60, 40, 140]); } catch (x) {}
    clearTimeout(popT); popT = setTimeout(function () { $("matchPop").classList.add("hidden"); }, 4500);
  }

  // ---------------------------------------------------------------- results
  function renderResults() {
    var r = S.results || { matches: [], closest: [] }, h = "";
    if (r.matches.length) {
      $("rTitle").textContent = r.matches.length === 1 ? "It's a match!" : r.matches.length + " matches!";
      $("rSub").textContent = "Pick one on the TV to watch.";
      r.matches.forEach(function (m) { h += row(m, "Everyone said yes" + where(m)); });
    }
    if ((r.majority || []).length) {
      if (!r.matches.length) { $("rTitle").textContent = "Most of the group liked\u2026"; $("rSub").textContent = "No movie got everyone, but these got a majority."; }
      h += '<h3 class="rsec">Most of the group liked</h3>';
      r.majority.forEach(function (c) { h += row(c.movie, c.why + where(c.movie)); });
    }
    if (!r.matches.length && !(r.majority || []).length) {
      $("rTitle").textContent = "No perfect match";
      $("rSub").textContent = r.closest.length ? "Closest calls (they're on the TV too):" : "Try a new round with different filters.";
      r.closest.forEach(function (c) { h += row(c.movie, c.why + where(c.movie)); });
    }
    $("rList").innerHTML = h;
  }
  function where(m) {
    var a = (S.installed || []).filter(function (x) { return (m.providers || []).indexOf(x.key) >= 0; });
    return a.length ? " · on " + a.map(function (x) { return x.name; }).join(", ") : "";
  }
  function row(m, why) {
    return '<div class="ritem" data-mid="' + esc(m.id) + '">' + C.card(m, 13, "bare") + '<div><div class="rt">' + esc(m.title) + '</div><div class="rm">' + esc(C.meta(m)) + '</div><div class="rm">' + esc(why) + '</div><div class="rm rmore">Details' + (m.trailer ? " & trailer" : "") + " ›</div></div></div>";
  }
  $("againBtn").addEventListener("click", function () { api("/api/round"); });

  var toastT = null;
  function toast(t) { if (!t) return; $("toast").textContent = t; $("toast").classList.remove("hidden"); clearTimeout(toastT); toastT = setTimeout(function () { $("toast").classList.add("hidden"); }, 2600); }

  // ---------------------------------------------------------------- tonight's code
  Array.prototype.forEach.call(document.querySelectorAll(".unpair"), function (a) { a.addEventListener("click", function (e) { e.preventDefault(); N.forget(); }); });
  $("endedBtn").addEventListener("click", function () { over = false; view("vPair"); });
  $("pairForm").addEventListener("submit", function (e) { e.preventDefault(); if (!N.pair($("code").value)) $("pairErr").textContent = "The code is 12 letters/numbers, like K7QF-M2XA-9TBD"; });
  if (!N.paired) { view("vPair"); return; }
  view("vConnect");
  N.onStatus(function (up) { $("net").classList.toggle("hidden", up || !S || over); });
  poll();
})();
