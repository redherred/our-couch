/* Movie Night - phone side of the relay. Tonight's code comes from the QR link (#c=XXXX-XXXX-XXXX) or is typed, and is
 * kept in localStorage only as {code, pid, at} for this night: it is dropped after 12 hours, or as soon as the TV says
 * the night has ended. The code never leaves the phone except as the derived (hashed) room name.
 * MNFetch(url, opts) mimics fetch() so the page code stays simple. */
(function (w) {
  "use strict";
  var R = w.MNRelay, LS = w.localStorage, KEY = "mn.night", TTL = 12 * 3600 * 1000;
  function load() { try { var o = JSON.parse(LS.getItem(KEY) || "null"); if (o && R.normCode(o.code) && Date.now() - (+o.at || 0) < TTL) return o; } catch (e) {} LS.removeItem(KEY); return null; }
  function store(o) { try { LS.setItem(KEY, JSON.stringify(o)); } catch (e) {} }
  var night = load();
  var m = /[#&]c=([0-9A-Za-z-]+)/.exec(location.hash || "");
  if (m && R.normCode(m[1])) {
    var nc = R.normCode(m[1]);
    if (!night || night.code !== nc) { night = { code: nc, pid: "", at: Date.now() }; store(night); }
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}   // keep the code out of the address bar
  }
  var code = night ? night.code : null, d = code ? R.derive(code) : null;
  var cid = R.randomId(10), T = d ? R.topics(d.room) : null, conns = [], pending = {}, seq = 0, listeners = [];
  function anyUp() { for (var i = 0; i < conns.length; i++) if (conns[i].ok) return true; return false; }
  function notify() { var up = anyUp(); listeners.forEach(function (f) { f(up); }); if (up) flushQueue(); }
  var queue = [];
  function flushQueue() { var q = queue; queue = []; q.forEach(function (fn) { fn(); }); }
  function send(msg) {
    var s = R.seal(msg, d.key), sent = false;
    conns.forEach(function (c) { if (c.ok && c.m.publish(T.server, s)) sent = true; });
    return sent;
  }
  function start() {
    if (!d) return;
    conns = R.BROKERS.map(function (b) {
      var c = { b: b, ok: false };
      c.m = new R.Mqtt({ url: b.phone, user: b.user, pass: b.pass, keepalive: 30,
        onState: function (on) { c.ok = on; notify(); },
        onMessage: function (t, s) {
          var r = R.open(s, d.key); if (!r || !pending[r.i]) return;
          var p = pending[r.i]; delete pending[r.i]; clearTimeout(p.t); clearTimeout(p.rt); p.res(r.j);
        } });
      c.m.subscribe(T.client(cid));
      return c;
    });
  }
  function stop() { conns.forEach(function (c) { try { c.m.close(); } catch (e) {} }); conns = []; }
  function request(method, path, body, timeout) {
    return new Promise(function (res, rej) {
      if (!d) return rej(new Error("no code"));
      var id = (++seq).toString(36) + R.randomId(5), msg = { i: id, c: cid, m: method, p: path, b: body || {} };
      var p = pending[id] = { res: res };
      p.t = setTimeout(function () { delete pending[id]; rej(new Error("timeout")); }, timeout);
      function go() { if (!pending[id]) return; if (!send(msg)) queue.push(go); }
      go();
      if (path.indexOf("/api/state") !== 0) p.rt = setTimeout(function () { if (pending[id]) { msg.r = 1; send(msg); } }, 6000);   // one retry
    });
  }
  w.MNFetch = function (url, opts) {
    opts = opts || {};
    var body = {}; try { body = opts.body ? JSON.parse(opts.body) : {}; } catch (e) {}
    return request(opts.method || "GET", url, body, url.indexOf("/api/state") === 0 ? 30000 : 25000).then(function (j) {
      if (j && j.ended) MN_NET.ended();
      return { ok: true, status: 200, json: function () { return Promise.resolve(j); } };
    });
  };
  var MN_NET = w.MNNet = {
    paired: !!d, code: code ? R.prettyCode(code) : "",
    pid: function () { return night ? night.pid || "" : ""; },
    setPid: function (p) { if (!night) return; night.pid = p || ""; store(night); },
    pair: function (c) { var n = R.normCode(c); if (!n) return false; store({ code: n, pid: "", at: Date.now() }); location.reload(); return true; },
    forget: function () { LS.removeItem(KEY); location.reload(); },
    /** the TV said this code's night is over: forget it for good, stop talking to the relay */
    ended: function () { LS.removeItem(KEY); night = null; stop(); MN_NET.paired = false; },
    onStatus: function (f) { listeners.push(f); f(anyUp()); },
    status: function () { return conns.map(function (c) { return { id: c.b.id, ok: c.ok }; }); }
  };
  start();
})(window);
