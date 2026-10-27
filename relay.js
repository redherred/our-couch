/* Our Couch relay: TV <-> phones through a free public MQTT broker (MQTT 3.1.1 over WebSocket).
 * The Samsung TV app can't open a listening socket, so both sides connect OUT to a broker instead.
 * Everything sent is end-to-end encrypted (NaCl secretbox, tweetnacl) with a key derived from the
 * pairing code shown on the TV; the code travels only in the QR link's #fragment (never sent to any server).
 * ES5 only (runs on Tizen 4.0 / Chromium 56 and phone browsers). Needs window.nacl. */
(function (w) {
  "use strict";
  var nacl = w.nacl;
  // tv = URL the TV uses (plain ws allowed: payloads are encrypted anyway, and old TVs may lack newer TLS roots)
  // phone = URL phones use (https pages must use wss)
  var BROKERS = [
    { id: "shiftr", name: "shiftr.io public", tv: "wss://public.cloud.shiftr.io/", phone: "wss://public.cloud.shiftr.io/", user: "public", pass: "public" },
    { id: "hivemq", name: "HiveMQ public", tv: "ws://broker.hivemq.com:8000/mqtt", phone: "wss://broker.hivemq.com:8884/mqtt" },
    { id: "emqx", name: "EMQX public", tv: "ws://broker.emqx.io:8083/mqtt", phone: "wss://broker.emqx.io:8084/mqtt" }
  ];
  var PREFIX = "oc1/";

  // ------------------------------------------------------------------ bytes / base64 / utf8
  function utf8(s) { var b = unescape(encodeURIComponent(s)), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  function unutf8(a) { var s = ""; for (var i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return decodeURIComponent(escape(s)); }
  function b64(a) { var s = ""; for (var i = 0; i < a.length; i += 8192) s += String.fromCharCode.apply(null, a.subarray(i, i + 8192)); return btoa(s); }
  function unb64(s) { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
  var B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";     // Crockford: no I L O U
  function b32(a, n) { var out = "", bits = 0, val = 0; for (var i = 0; i < a.length && out.length < n; i++) { val = (val << 8) | a[i]; bits += 8; while (bits >= 5 && out.length < n) { out += B32.charAt((val >>> (bits - 5)) & 31); bits -= 5; } } return out; }
  function randomId(n) { return b32(nacl.randomBytes(n), Math.floor(n * 8 / 5)); }

  // ------------------------------------------------------------------ pairing code -> room + key
  function normCode(c) {
    c = String(c || "").toUpperCase().replace(/[IL]/g, "1").replace(/O/g, "0").replace(/U/g, "V").replace(/[^0-9A-Z]/g, "");
    return c.length === 12 ? c : null;
  }
  function newCode() { return b32(nacl.randomBytes(8), 12); }                 // 60 bits
  function prettyCode(c) { c = normCode(c) || ""; return c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8); }
  function derive(code) {
    var n = normCode(code); if (!n) return null;
    var h = nacl.hash(utf8("our-couch/v1/" + n));                              // SHA-512
    return { code: n, room: b32(h.subarray(0, 10), 16), key: h.subarray(32, 64) };
  }
  function seal(obj, key) {
    var nonce = nacl.randomBytes(24), box = nacl.secretbox(utf8(JSON.stringify(obj)), nonce, key), out = new Uint8Array(24 + box.length);
    out.set(nonce); out.set(box, 24); return b64(out);
  }
  function open(str, key) {
    try { var a = unb64(str); var m = nacl.secretbox.open(a.subarray(24), a.subarray(0, 24), key); return m ? JSON.parse(unutf8(m)) : null; } catch (e) { return null; }
  }

  // ------------------------------------------------------------------ minimal MQTT 3.1.1 client over WebSocket (QoS 0)
  function str(s) { var u = utf8(s), a = new Uint8Array(u.length + 2); a[0] = u.length >> 8; a[1] = u.length & 255; a.set(u, 2); return a; }
  function cat(parts) { var n = 0, i; for (i = 0; i < parts.length; i++) n += parts[i].length; var a = new Uint8Array(n), o = 0; for (i = 0; i < parts.length; i++) { a.set(parts[i], o); o += parts[i].length; } return a; }
  function packet(type, body) {
    var len = body.length, hdr = [type];
    do { var d = len % 128; len = Math.floor(len / 128); if (len > 0) d |= 128; hdr.push(d); } while (len > 0);
    return cat([new Uint8Array(hdr), body]);
  }

  /** opts: {url, user, pass, onMessage(topic, string), onState(connected), keepalive} */
  function Mqtt(opts) {
    this.o = opts; this.ws = null; this.connected = false; this.subs = []; this.pid = 1; this.buf = new Uint8Array(0);
    this.closed = false; this.backoff = 1000; this.ping = null; this.lastIn = 0; this.connect();
  }
  Mqtt.prototype.connect = function () {
    var self = this, o = this.o;
    if (this.closed) return;
    var ws;
    try { ws = new WebSocket(o.url, ["mqtt"]); } catch (e) { this._retry(); return; }
    this.ws = ws; ws.binaryType = "arraybuffer";
    var t = setTimeout(function () { if (!self.connected) { try { ws.close(); } catch (e) {} } }, o.timeout || 9000);
    ws.onopen = function () {
      var flags = 0x02, pay = [str("oc" + randomId(10))];
      if (o.user) { flags |= 0x80; pay.push(str(o.user)); }
      if (o.pass) { flags |= 0x40; pay.push(str(o.pass)); }
      var ka = o.keepalive || 30;
      self._send(packet(0x10, cat([str("MQTT"), new Uint8Array([4, flags, ka >> 8, ka & 255])].concat(pay))));
    };
    ws.onmessage = function (e) { self.lastIn = Date.now(); self._data(new Uint8Array(e.data)); };
    ws.onclose = ws.onerror = function () {
      clearTimeout(t);
      if (self.ws !== ws) return;
      self.ws = null; clearInterval(self.ping);
      var was = self.connected; self.connected = false; self.buf = new Uint8Array(0);
      if (was && o.onState) o.onState(false);
      self._retry();
    };
  };
  Mqtt.prototype._retry = function () {
    var self = this; if (this.closed) return;
    setTimeout(function () { self.connect(); }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 30000);
  };
  Mqtt.prototype._send = function (a) { if (this.ws && this.ws.readyState === 1) { this.ws.send(a); return true; } return false; };
  Mqtt.prototype._data = function (chunk) {
    var b = this.buf.length ? cat([this.buf, chunk]) : chunk;
    for (;;) {
      if (b.length < 2) break;
      var mult = 1, len = 0, i = 1, d;
      do { if (i >= b.length) { d = -1; break; } d = b[i++]; len += (d & 127) * mult; mult *= 128; } while (d & 128);
      if (d === -1 || b.length < i + len) break;
      this._packet(b[0], b.subarray(i, i + len));
      b = b.subarray(i + len);
    }
    this.buf = new Uint8Array(b);      // copy the remainder
  };
  Mqtt.prototype._packet = function (h, p) {
    var type = h >> 4, self = this;
    if (type === 2) {                                   // CONNACK
      if (p[1] !== 0) { try { this.ws.close(); } catch (e) {} return; }
      this.connected = true; this.backoff = 1000;
      for (var i = 0; i < this.subs.length; i++) this._sub(this.subs[i]);
      clearInterval(this.ping);
      var ka = (this.o.keepalive || 30) * 1000;
      this.ping = setInterval(function () {
        if (Date.now() - self.lastIn > ka * 2.5) { try { self.ws.close(); } catch (e) {} return; }   // dead link
        self._send(new Uint8Array([0xC0, 0]));
      }, ka * 0.8);
      if (this.o.onState) this.o.onState(true);
    } else if (type === 3) {                            // PUBLISH
      var qos = (h >> 1) & 3, tl = (p[0] << 8) | p[1], topic = unutf8(p.subarray(2, 2 + tl)), off = 2 + tl;
      if (qos > 0) { var id1 = p[off], id2 = p[off + 1]; off += 2; if (qos === 1) this._send(new Uint8Array([0x40, 2, id1, id2])); }
      if (this.o.onMessage) { var s; try { s = unutf8(p.subarray(off)); } catch (e) { s = null; } if (s !== null) this.o.onMessage(topic, s); }
    }
  };
  Mqtt.prototype._sub = function (topic) {
    var id = this.pid = (this.pid % 65000) + 1;
    this._send(packet(0x82, cat([new Uint8Array([id >> 8, id & 255]), str(topic), new Uint8Array([0])])));
  };
  Mqtt.prototype.subscribe = function (topic) { if (this.subs.indexOf(topic) < 0) this.subs.push(topic); if (this.connected) this._sub(topic); };
  Mqtt.prototype.publish = function (topic, s) {
    if (!this.connected) return false;
    return this._send(packet(0x30, cat([str(topic), utf8(s)])));
  };
  Mqtt.prototype.close = function () { this.closed = true; clearInterval(this.ping); if (this.ws) { try { this._send(new Uint8Array([0xE0, 0])); this.ws.close(); } catch (e) {} } this.ws = null; this.connected = false; };

  w.CouchRelay = {
    BROKERS: BROKERS, PREFIX: PREFIX, Mqtt: Mqtt,
    newCode: newCode, normCode: normCode, prettyCode: prettyCode, derive: derive, seal: seal, open: open, randomId: randomId,
    topics: function (room) { return { server: PREFIX + room + "/s", client: function (cid) { return PREFIX + room + "/c/" + cid; } }; }
  };
})(window);
