/* Shared helpers for TV + phone: escaping and generated title cards. */
(function (w) {
  var PAL = {
    action:   ["#b5442e", "#5a1a1e"], cop:     ["#2f4f7a", "#141d33"], comedy: ["#e09a3c", "#8a3d1e"],
    romance:  ["#d0587a", "#5b1f3e"], horror:  ["#3b2b3f", "#0d090f"], animation: ["#3fa7a0", "#2b4a7a"],
    scifi:    ["#4a5fb5", "#1a1640"], thriller: ["#55606b", "#1b1f24"], drama:  ["#8a5a44", "#2e1c1a"],
    family:   ["#6aa86a", "#2c5040"], mystery: ["#6b4fa0", "#1c1530"]
  };
  var ORDER = ["horror", "animation", "romance", "cop", "comedy", "scifi", "action", "mystery", "thriller", "family", "drama"];
  var GLYPH = {
    action: '<path d="M50 5 61 38 96 38 68 59 79 93 50 72 21 93 32 59 4 38 39 38Z"/>',
    cop: '<path d="M50 4 88 18v28c0 24-16 42-38 50C28 88 12 70 12 46V18Z"/>',
    comedy: '<circle cx="50" cy="50" r="44"/><circle cx="35" cy="40" r="6" fill="#000"/><circle cx="65" cy="40" r="6" fill="#000"/><path d="M28 58q22 26 44 0" stroke="#000" stroke-width="7" fill="none"/>',
    romance: '<path d="M50 90 12 52C-4 34 10 8 32 12c9 2 15 8 18 14 3-6 9-12 18-14 22-4 36 22 20 40Z"/>',
    horror: '<path d="M50 6c22 0 38 16 38 38v50l-12-10-13 10-13-10-13 10-13-10-12 10V44C12 22 28 6 50 6Z"/>',
    animation: '<path d="M50 4l12 30 32 2-25 20 9 32-28-18-28 18 9-32L6 36l32-2Z"/>',
    scifi: '<circle cx="50" cy="50" r="22"/><ellipse cx="50" cy="50" rx="48" ry="14" fill="none" stroke="#fff" stroke-width="6"/>',
    thriller: '<circle cx="50" cy="50" r="42" fill="none" stroke="#fff" stroke-width="8"/><path d="M50 22v30l20 12" stroke="#fff" stroke-width="8" fill="none"/>',
    mystery: '<circle cx="42" cy="42" r="28" fill="none" stroke="#fff" stroke-width="9"/><path d="M62 62l26 26" stroke="#fff" stroke-width="12" stroke-linecap="round"/>',
    drama: '<path d="M10 20h80v40c0 20-18 34-40 34S10 80 10 60Z"/>',
    family: '<circle cx="30" cy="30" r="14"/><circle cx="70" cy="30" r="14"/><path d="M8 92c0-26 12-40 22-40s22 14 22 40Zm40 0c0-26 12-40 22-40s22 14 22 40Z"/>'
  };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function mood(m) {
    var ms = m.moods || [];
    for (var i = 0; i < ORDER.length; i++) if (ms.indexOf(ORDER[i]) >= 0) return ORDER[i];
    var g = (m.genres || []).join(" ").toLowerCase();
    if (/horror/.test(g)) return "horror"; if (/anim/.test(g)) return "animation"; if (/romance/.test(g)) return "romance";
    if (/crime/.test(g)) return "cop"; if (/comedy/.test(g)) return "comedy"; if (/science/.test(g)) return "scifi";
    if (/action|adventure/.test(g)) return "action"; if (/mystery/.test(g)) return "mystery"; if (/thriller/.test(g)) return "thriller"; if (/family/.test(g)) return "family";
    return "drama";
  }
  function runtime(min) { if (!min) return ""; var h = Math.floor(min / 60), m = min % 60; return (h ? h + "h " : "") + (m ? m + "m" : ""); }
  function meta(m) { return [m.year || "", runtime(m.runtime), m.rating || ""].filter(Boolean).join(" · "); }
  /** Title card HTML. size = font-size in px for the title. */
  function card(m, titlePx, cls, extra) {
    var k = mood(m), p = PAL[k], len = (m.title || "").length;
    var t = titlePx * (len > 32 ? 0.62 : len > 22 ? 0.76 : len > 14 ? 0.9 : 1);
    var poster = m.poster ? '<img class="poster" src="' + esc(m.poster) + '" alt="" onerror="this.parentNode.classList.remove(\'has-poster\');this.remove()">' : "";
    return '<div class="tcard ' + (cls || "") + (m.poster ? " has-poster" : "") + '" style="--g:linear-gradient(155deg,' + p[0] + ' 0%,' + p[1] + ' 100%)">' + poster +
      '<svg class="glyph" viewBox="0 0 100 100" fill="#fff">' + GLYPH[k] + '</svg>' +
      '<div class="kicker">' + esc((m.genres || []).slice(0, 2).join(" · ")) + '</div>' +
      '<div class="t" style="font-size:' + Math.round(t) + 'px">' + esc(m.title) + '</div>' +
      '<div class="meta">' + esc(meta(m)) + '</div>' + (extra || "") + '</div>';
  }
  w.CouchCards = { esc: esc, card: card, meta: meta, runtime: runtime, mood: mood };
})(window);
