// Direction B · shared SVG helpers (rev 12).
// One marker geometry for every highlight — text (HTML) and figures (SVG) call the same markerPath().
const NS = "http://www.w3.org/2000/svg";
const MARKER = "#f9db59", INK = "#1c1b19", PAPER = "#fbfaf7";
const MARK_OPACITY = 0.7;

function el(parent, tag, attrs) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent.appendChild(n);
  return n;
}
function label(svg, x, y, text, attrs = {}) {
  const t = el(svg, "text", { x, y, "font-family": "Commissioner", "font-weight": 600, "font-size": 13, fill: INK, ...attrs });
  t.textContent = text;
  return t;
}

// ---------- marker geometry ----------
// A chisel band from a to c, top to bottom, ends slanted by s, tilted around its centre. Returns an SVG subpath.
function chisel(a, c, top, bottom, s, tiltDeg) {
  const cx = (a + c) / 2, cy = (top + bottom) / 2, t = tiltDeg * Math.PI / 180;
  const pts = [[a + s, top], [c + s, top], [c - s, bottom], [a - s, bottom]].map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(t) - dy * Math.sin(t), cy + dx * Math.sin(t) + dy * Math.cos(t)];
  });
  return "M" + pts.map(p => p[0].toFixed(1) + " " + p[1].toFixed(1)).join("L") + "Z";
}
// Every highlight type, in units of f (font size of the highlighted text), relative to the text's left x, width w and baseline.
//   single — a word or a short label: one stroke, runs 0.22 f past both ends
//   double — a phrase: two strokes in ONE colour (one path, the overlap is not darker); upper starts earlier, lower ends later
//   under  — the active item: a low stroke through the baseline
function markerPath(type, { x, w, base, f }) {
  const s = 0.16 * f;
  if (type === "double") {
    return chisel(x - 0.26 * f, x + w + 0.02 * f, base - 0.84 * f, base - 0.3 * f, s, -0.6)
         + chisel(x + 0.06 * f, x + w + 0.26 * f, base - 0.48 * f, base + 0.14 * f, s, 0.5);
  }
  if (type === "under") return chisel(x - 0.16 * f, x + w + 0.18 * f, base - 0.12 * f, base + 0.2 * f, 0.1 * f, -0.7);
  return chisel(x - 0.22 * f, x + w + 0.22 * f, base - 0.78 * f, base + 0.16 * f, s, -0.8);
}

// HTML: <span class="mk" data-mk="single|double|under">text</span>
function markHTML(span) {
  span.querySelectorAll(":scope > svg.mk-svg").forEach(n => n.remove());
  const type = span.dataset.mk || "single";
  const f = parseFloat(getComputedStyle(span).fontSize);
  const r = span.getBoundingClientRect();
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  span.appendChild(probe);
  const base = probe.getBoundingClientRect().top - r.top;
  probe.remove();
  const pad = f;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "mk-svg");
  svg.style.cssText = "position:absolute;z-index:-1;pointer-events:none;overflow:visible;left:" + (-pad) + "px;top:" + (-pad) + "px;width:" + (r.width + 2 * pad) + "px;height:" + (r.height + 2 * pad) + "px";
  span.appendChild(svg);
  el(svg, "path", { d: markerPath(type, { x: pad, w: r.width, base: base + pad, f }), fill: MARKER, "fill-opacity": MARK_OPACITY });
}
// SVG: highlight an existing <text>; cover = paper under the marker so the data beneath is hidden (annotations)
function markLabel(textEl, type = "single", cover = false) {
  const draw = () => {
    (textEl._mk || []).forEach(n => n.remove());
    const b = textEl.getBBox();
    const f = parseFloat(getComputedStyle(textEl).fontSize);
    const base = parseFloat(textEl.getAttribute("y"));
    const d = markerPath(type, { x: b.x, w: b.width, base, f });
    const parent = textEl.parentNode, made = [];
    if (cover) { const u = document.createElementNS(NS, "path"); u.setAttribute("d", d); u.setAttribute("fill", PAPER); parent.insertBefore(u, textEl); made.push(u); }
    const m = document.createElementNS(NS, "path");
    m.setAttribute("d", d); m.setAttribute("fill", MARKER); m.setAttribute("fill-opacity", MARK_OPACITY); m.setAttribute("style", "mix-blend-mode:multiply");
    parent.insertBefore(m, textEl); made.push(m);
    textEl._mk = made;
  };
  draw();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
}
function markAll() { document.querySelectorAll(".mk[data-mk]").forEach(markHTML); }
if (document.fonts && document.fonts.ready) document.fonts.ready.then(markAll); else window.addEventListener("load", markAll);

// figures only: one continuous loop, a bit more than a full turn, drifting outward so the end runs over its own start (darker there)
function loopMark(svg, cx, cy, rx, ry, w = 10) {
  const a0 = -1.1, turn = 2 * Math.PI, over = 0.75, drift = 4;
  const pt = t => { const k = (t - a0) / turn * drift; return [cx + (rx + k) * Math.cos(t), cy + (ry + k) * Math.sin(t)]; };
  const seg = (from, to, n = 48) => "M" + Array.from({ length: n + 1 }, (_, i) => pt(from + (to - from) * i / n).map(v => v.toFixed(1)).join(" ")).join("L");
  const attrs = { fill: "none", stroke: MARKER, "stroke-opacity": MARK_OPACITY, "stroke-width": w, "stroke-linecap": "butt", style: "mix-blend-mode:multiply" };
  el(svg, "path", { d: seg(a0, a0 + turn), ...attrs });
  el(svg, "path", { d: seg(a0 + turn, a0 + turn + over, 16), ...attrs });
}
// figures only: ink arrow with a sharp-edged marker band under the line and the head
function arrowMark(svg, d, headD) {
  const band = { fill: "none", stroke: MARKER, "stroke-opacity": MARK_OPACITY, "stroke-width": 14, "stroke-linecap": "butt", "stroke-linejoin": "miter", "stroke-miterlimit": 6, style: "mix-blend-mode:multiply" };
  el(svg, "path", { d, ...band });
  el(svg, "path", { d: headD, ...band });
  el(svg, "path", { d, fill: "none", stroke: INK, "stroke-width": 2, "stroke-linecap": "round" });
  el(svg, "path", { d: headD, fill: "none", stroke: INK, "stroke-width": 2, "stroke-linecap": "round", "stroke-linejoin": "round" });
}
// annotation inside a plot: a single-stroke label that covers what is under it, leader 1 px ending in a dot
function annotate(svg, x, y, text, tx, ty) {
  const g = el(svg, "g", {});
  const t = label(g, x, y, text);
  el(g, "circle", { cx: tx, cy: ty, r: 2.2, fill: INK });
  const lead = el(g, "path", { d: "", fill: "none", stroke: INK, "stroke-width": 1 });
  markLabel(t, "single", true);
  const fit = () => {
    const b = t.getBBox(), a = b.x - 6, c = b.x + b.width + 6, cy = b.y + b.height / 2;
    const sx = tx > c ? c + 2 : tx < a ? a - 2 : Math.max(b.x + 8, Math.min(tx, b.x + b.width - 8));
    const sy = tx > c || tx < a ? cy : (ty > b.y ? b.y + b.height + 5 : b.y - 5);
    lead.setAttribute("d", "M" + sx + " " + sy + "L" + tx + " " + ty);
  };
  fit();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);
  return g;
}

// ---------- figure building blocks (web and slides) ----------
// "being worked on": the wash is not finished yet — pencil hatching in the role colour, clipped to where the wash will be.
// sil = closed path(s); progress 0..1 = how much is hatched, left to right; box = [x0, y0, x1, y1] around it; offset = the wash offset
let hatchSeq = 0;
function hatchFill(parent, sil, colour, progress = 1, box = [-18, -38, 22, 6], offset = [3, 2]) {
  const id = "hatch" + (hatchSeq++);
  const clip = el(el(parent, "defs", {}), "clipPath", { id });
  sil.forEach(d => el(clip, "path", { d, transform: "translate(" + offset.join(" ") + ")" }));
  const lines = el(parent, "g", { "clip-path": "url(#" + id + ")", stroke: colour, "stroke-opacity": .55, "stroke-width": 2, "stroke-linecap": "round", style: "mix-blend-mode:multiply" });
  const [x0, y0, x1, y1] = box, h = y1 - y0, starts = [];
  for (let c = x0 - h; c <= x1; c += 5) starts.push(c);
  starts.slice(0, Math.round(starts.length * progress)).forEach(c => el(lines, "path", { d: "M" + c + " " + y1 + "L" + (c + h) + " " + y0 }));
  return lines;
}
// component: ink box + the same box as a pencil wash shifted +4/+3; colour = its type (blue data, magenta model, green product, violet people)
// state: "done" even wash (default) · "working" hatched wash · "planned" dashed outline, no wash
function component(svg, x, y, w, h, colour, title, sub, state = "done") {
  if (state === "working") hatchFill(svg, ["M" + x + " " + y + "h" + w + "v" + h + "h" + (-w) + "z"], colour, 1, [x - 4, y - 4, x + w + 8, y + h + 8], [4, 3]);
  else if (state !== "planned") el(svg, "rect", { x: x + 4, y: y + 3, width: w, height: h, fill: colour, "fill-opacity": 0.24, style: "mix-blend-mode:multiply" });
  el(svg, "rect", { x, y, width: w, height: h, fill: "none", stroke: INK, "stroke-width": 2, ...(state === "planned" ? { "stroke-dasharray": "6 4" } : {}) });
  const t = label(svg, x + 12, y + (sub ? h / 2 - 2 : h / 2 + 4.5), title, { "font-size": 13 });
  if (sub) label(svg, x + 12, y + h / 2 + 15, sub, { "font-size": 11.5, "font-weight": 500, fill: "#66625c" });
  return t;
}
// flow: 2 px ink line with an open 8 × 6 arrowhead at the last point; points = [[x, y], …]; dashed = a dependency
function flow(svg, points, dashed = false) {
  const d = "M" + points.map(p => p.join(" ")).join("L");
  el(svg, "path", { d, fill: "none", stroke: INK, "stroke-width": 2, ...(dashed ? { "stroke-dasharray": "6 4" } : {}) });
  const [x1, y1] = points[points.length - 2], [x2, y2] = points[points.length - 1];
  const a = Math.atan2(y2 - y1, x2 - x1), back = (s) => [x2 - 8 * Math.cos(a) + s * 6 * Math.sin(a), y2 - 8 * Math.sin(a) - s * 6 * Math.cos(a)];
  el(svg, "path", { d: "M" + back(1).join(" ") + "L" + x2 + " " + y2 + "L" + back(-1).join(" "), fill: "none", stroke: INK, "stroke-width": 2, "stroke-linejoin": "round" });
}
// data line: ink 2 px over a 9 px pencil wash shifted +2/+3; end = [x, y] adds a paper-filled end dot
function dataLine(svg, d, colour, end) {
  el(svg, "path", { d, fill: "none", stroke: colour, "stroke-opacity": 0.32, "stroke-width": 9, "stroke-linecap": "round", transform: "translate(2 3)", style: "mix-blend-mode:multiply" });
  el(svg, "path", { d, fill: "none", stroke: INK, "stroke-width": 2, "stroke-linecap": "round" });
  if (end) {
    el(svg, "circle", { cx: end[0] + 1, cy: end[1] + 1, r: 6, fill: colour, "fill-opacity": 0.32, style: "mix-blend-mode:multiply" });
    el(svg, "circle", { cx: end[0], cy: end[1], r: 5, fill: PAPER, stroke: INK, "stroke-width": 2 });
  }
}
// bar: ink outline + a wash of the same size shifted +4/+3
function bar(svg, x, base, w, h, colour) {
  el(svg, "rect", { x: x + 4, y: base - h + 3, width: w, height: h, fill: colour, "fill-opacity": 0.3, style: "mix-blend-mode:multiply" });
  el(svg, "rect", { x, y: base - h, width: w, height: h, fill: "none", stroke: INK, "stroke-width": 2 });
}

// ---------- the K in the name (approved 2026-09-27: variant B "schody" with a grey hairline outline at every size) ----------
// Two marker passes under the K: the upper starts and ends earlier, the lower later; the letter sticks out of both.
// Light paper: marker multiplies with the paper. Dark variant (.name.dark): marker is opaque, the K stays ink on it and the passes cover all of it.
const NAME_MARKER = "#f6d34a", NAME_HAIR = "#66625c", NAME_HAIR_DARK = "#8a857c";
const NAME_PASSES_BIG = [{ x1: -0.18, x2: 0.02, t: 0.12, b: 0.6, tilt: -2.5 }, { x1: -0.02, x2: 0.18, t: 0.4, b: 0.9, tilt: 1.5 }];
const NAME_PASSES_SMALL = [{ x1: -0.18, x2: 0.04, t: 0.08, b: 0.62, tilt: -2.5 }, { x1: -0.02, x2: 0.2, t: 0.38, b: 0.96, tilt: 1.5 }];
// Dark variant: the ink K would vanish on the ink background where it sticks out, so the passes cover the whole letter.
const NAME_PASSES_DARK_BIG = [{ x1: -0.18, x2: 0.04, t: -0.06, b: 0.56, tilt: -2.5 }, { x1: -0.02, x2: 0.2, t: 0.44, b: 1.06, tilt: 1.5 }];
const NAME_PASSES_DARK_SMALL = [{ x1: -0.18, x2: 0.06, t: -0.08, b: 0.58, tilt: -2.5 }, { x1: -0.02, x2: 0.22, t: 0.42, b: 1.08, tilt: 1.5 }];
function nameCorners(a, c, top, bottom, tiltDeg) {
  const h = bottom - top, s = 0.2 * h, cx = (a + c) / 2, cy = (top + bottom) / 2, t = tiltDeg * Math.PI / 180;
  return [[a + s, top], [c + s, top], [c - s, bottom], [a - s, bottom]].map(([x, y]) => {
    const dx = x - cx, dy = y - cy;
    return [cx + dx * Math.cos(t) - dy * Math.sin(t), cy + dx * Math.sin(t) + dy * Math.cos(t)];
  });
}
let nameMarkId = 0;
function nameMark(kEl) {
  kEl.querySelectorAll(":scope > svg.nm-svg").forEach(n => n.remove());
  const f = parseFloat(getComputedStyle(kEl).fontSize);
  const dark = !!kEl.closest(".name.dark");
  const r = kEl.getBoundingClientRect();
  const probe = document.createElement("span");
  probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
  kEl.appendChild(probe);
  const base = probe.getBoundingClientRect().top - r.top;
  probe.remove();
  const pad = f, cap = 0.7 * f, capTop = base - cap, w = r.width, id = "nm" + (nameMarkId++);
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("class", "nm-svg");
  svg.style.cssText = "position:absolute;z-index:-1;pointer-events:none;overflow:visible;left:" + (-pad) + "px;top:" + (-pad) + "px;width:" + (w + 2 * pad) + "px;height:" + (r.height + 2 * pad) + "px";
  kEl.appendChild(svg);
  const body = dark ? [1, .95, .9] : (f >= 40 ? [.8, .7, .62] : [.86, .78, .7]);
  const grad = el(el(svg, "defs", {}), "linearGradient", { id: id, x1: 0, x2: 1, y1: 0, y2: 0 });
  [[0, 0], [.3, 1], [1, 2]].forEach(([o, i]) => el(grad, "stop", { offset: o, "stop-color": NAME_MARKER, "stop-opacity": body[i] }));
  const layer = el(svg, "g", dark ? {} : { style: "mix-blend-mode:multiply" });
  const passes = dark ? (f >= 40 ? NAME_PASSES_DARK_BIG : NAME_PASSES_DARK_SMALL) : (f >= 40 ? NAME_PASSES_BIG : NAME_PASSES_SMALL);
  const shapes = passes.map(p => nameCorners(pad + p.x1 * f, pad + w + p.x2 * f, pad + capTop + p.t * cap, pad + capTop + p.b * cap, p.tilt));
  const P = p => p[0].toFixed(1) + " " + p[1].toFixed(1);
  shapes.forEach(c => el(layer, "path", { d: "M" + c.map(P).join("L") + "Z", fill: "url(#" + id + ")" }));
  shapes.forEach(c => el(svg, "path", { d: "M" + c.map(P).join("L") + "Z", fill: "none", stroke: dark ? NAME_HAIR_DARK : NAME_HAIR, "stroke-opacity": .75, "stroke-width": 0.6, "stroke-linejoin": "miter" }));
}
function nameMarkAll() { document.querySelectorAll(".nm").forEach(nameMark); }
if (document.fonts && document.fonts.ready) document.fonts.ready.then(nameMarkAll); else window.addEventListener("load", nameMarkAll);

// ---------- people ----------
// a pen-drawn bust (round head = person, square head = agent/system); paper fill so a front figure hides the ones behind;
// wash offset 3/2 px carries the role colour; planned = drawn in pencil (grey), not yet inked
function person(svg, x, y, opts = {}) {
  const { wash = null, agent = false, planned = false, label: text = null, count = null, size = 1 } = opts;
  const g = el(svg, "g", { transform: "translate(" + x + " " + y + ") scale(" + size + ")" });
  const stroke = planned ? { fill: "none", stroke: "#66625c", "stroke-width": 1.6 / size, "stroke-linejoin": "round" }
                         : { fill: "none", stroke: INK, "stroke-width": 2 / size, "stroke-linejoin": "round" };
  const headD = agent ? "M-7 -34h14v14h-14z" : "M0 -27a7 7 0 1 0 0.01 0";
  const bodyD = "M-14 0v-6a14 14 0 0 1 28 0v6z";
  el(g, "path", { d: bodyD, fill: PAPER }); el(g, "path", { d: headD, fill: PAPER });
  if (wash && !planned) {
    const w = el(g, "g", { fill: wash, opacity: .3, style: "mix-blend-mode:multiply", transform: "translate(3 2)" });
    el(w, "path", { d: bodyD }); el(w, "path", { d: headD });
  }
  // the round head hides the shoulder line behind it
  el(g, "path", { d: agent ? bodyD : "M-6.8 -18.2A14 14 0 0 0 -14 -6V0H14V-6A14 14 0 0 0 6.8 -18.2", ...stroke });
  el(g, "path", { d: headD, ...stroke });
  if (count) { const c = el(g, "text", { x: 18, y: -22, "font-family": "Commissioner", "font-weight": 600, "font-size": 12 / size, fill: INK }); c.textContent = "×" + count; }
  if (text) { const t = el(g, "text", { x: 0, y: 18, "text-anchor": "middle", "font-family": "Commissioner", "font-weight": 600, "font-size": 12 / size, fill: INK }); t.textContent = text; g._label = t; }
  return g;
}
// a small crowd: two busts behind, one in front; the front one covers them; the count sits right of the whole group
function crowd(svg, x, y, opts = {}) {
  const g = el(svg, "g", {});
  const size = opts.size || 1;
  person(g, x - 13, y - 7, { ...opts, label: null, count: null });
  person(g, x + 13, y - 7, { ...opts, label: null, count: null });
  const front = person(g, x, y, { ...opts, count: null });
  if (opts.count) {
    const c = el(g, "text", { x: x + 13 + 14 * size + 5, y: y - 7 - 22 * size, "font-family": "Commissioner", "font-weight": 600, "font-size": 12, fill: INK });
    c.textContent = "×" + opts.count;
  }
  g._label = front._label;
  return g;
}
