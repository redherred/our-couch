/* Phone side of the relay. Pairing code comes from the QR link (#c=XXXX-XXXX-XXXX) or a typed code,
 * is kept in localStorage, and never leaves the phone except as the derived (hashed) room name.
 * CouchFetch(url, opts) mimics fetch() for the old HTTP API so the page code stays the same. */
(function (w) {
  "use strict";
  var R = w.CouchRelay, LS = w.localStorage;
  var m = /[#&]c=([0-9A-Za-z-]+)/.exec(location.hash || "");
  if (m && R.normCode(m[1])) {
    var nc = R.normCode(m[1]);
    if (LS.getItem("couch.code") !== nc) { LS.removeItem("couch.pid"); LS.setItem("couch.code", nc); }
    try { history.replaceState(null, "", location.pathname + location.search); } catch (e) {}   // keep the code out of the address bar
  }
  var code = R.normCode(LS.getItem("couch.code")), d = code ? R.derive(code) : null;
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
  function request(method, path, body, timeout) {
    return new Promise(function (res, rej) {
      if (!d) return rej(new Error("not paired"));
      var id = (++seq).toString(36) + R.randomId(5), msg = { i: id, c: cid, m: method, p: path, b: body || {} };
      var p = pending[id] = { res: res };
      p.t = setTimeout(function () { delete pending[id]; rej(new Error("timeout")); }, timeout);
      function go() { if (!pending[id]) return; if (!send(msg)) queue.push(go); }
      go();
      if (path.indexOf("/api/state") !== 0) p.rt = setTimeout(function () { if (pending[id]) { msg.r = 1; send(msg); } }, 6000);   // one retry
    });
  }
  w.CouchFetch = function (url, opts) {
    opts = opts || {};
    var body = {}; try { body = opts.body ? JSON.parse(opts.body) : {}; } catch (e) {}
    var isState = url.indexOf("/api/state") === 0;
    return request(opts.method || "GET", url, body, isState ? 34000 : /recipes\/link/.test(url) ? 45000 : 25000).then(function (j) {
      return { ok: true, status: 200, json: function () { return Promise.resolve(j); } };
    });
  };
  w.CouchNet = {
    paired: !!d, code: code ? R.prettyCode(code) : "",
    pair: function (c) { var n = R.normCode(c); if (!n) return false; LS.setItem("couch.code", n); LS.removeItem("couch.pid"); location.reload(); return true; },
    unpair: function () { LS.removeItem("couch.code"); LS.removeItem("couch.pid"); location.reload(); },
    onStatus: function (f) { listeners.push(f); f(anyUp()); },
    status: function () { return conns.map(function (c) { return { id: c.b.id, ok: c.ok }; }); }
  };
  start();
})(window);
