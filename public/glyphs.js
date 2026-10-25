// Direction B · glyphs and stickers (rev 12, approved 2026-10-04). Loads after system.js (el, label, hatchFill, INK, PAPER).
// Catalogue and the rules for a new glyph: b_glyphs.html (in the skill: glyphs.html).
// A glyph is an actor or an object inside a figure, drawn like the people: paper silhouette, pencil wash of its role
// shifted +3/+2, pen 2 px on top. Box 28 × 32 (people 28 × 34), origin at the bottom centre, all points on a 2 px grid.
//   sil    closed silhouette(s): paper fill, wash and hatching
//   ink    pen lines 2 px        detail  thinner pen lines 1.5 px (what is written / drawn on the thing)
//   rings  [cx, cy, r] small paper-filled circles 1.5 px        dots  [cx, cy, r] ink dots
const GLYPH_PENCIL = "#66625c";
const BODY = "M-14 0v-6a14 14 0 0 1 28 0v6z";
const SHEET = "M-11 -28H4L11 -21V0H-11Z";
const GLYPHS = {
  // people (same shapes as person() in system.js; the round head hides the shoulder line behind it)
  person:   { h: 34, sil: [BODY, "M0 -27a7 7 0 1 0 0.01 0"], ink: ["M-6.8 -18.2A14 14 0 0 0 -14 -6V0H14V-6A14 14 0 0 0 6.8 -18.2", "M0 -27a7 7 0 1 0 0.01 0"] },
  agent:    { h: 34, sil: [BODY, "M-7 -34h14v14h-14z"], ink: [BODY, "M-7 -34h14v14h-14z"] },
  // data
  document: { sil: [SHEET], ink: [SHEET, "M4 -28V-21H11"], detail: ["M-6 -15H6M-6 -10H6M-6 -5H2"] },
  message:  { sil: ["M-13 -28H13V-8H-3L-9 0V-8H-13Z"], ink: ["M-13 -28H13V-8H-3L-9 0V-8H-13Z"], detail: ["M-8 -21H8M-8 -15H4"] },
  table:    { sil: ["M-13 -24H13V0H-13Z"], ink: ["M-13 -24H13V0H-13Z", "M-13 -17H13"], detail: ["M-13 -8.5H13M-3 -24V0"] },
  database: { sil: ["M-12 -24a12 4 0 0 1 24 0V-4a12 4 0 0 1 -24 0Z"], ink: ["M-12 -24a12 4 0 0 1 24 0V-4a12 4 0 0 1 -24 0Z", "M-12 -24a12 4 0 0 0 24 0"], detail: ["M-12 -14a12 4 0 0 0 24 0"] },
  image:    { sil: ["M-13 -22H13V0H-13Z"], ink: ["M-13 -22H13V0H-13Z"], detail: ["M-12 -5L-5 -12L1 -6L5 -10L12 -3"], rings: [[6, -16, 2.5]] },
  product:  { sil: ["M-14 -26H14V-19H12V0H-12V-19H-14Z"], ink: ["M-14 -26H14V-19H12V0H-12V-19H-14Z", "M-12 -19H12"], detail: ["M-4 -19V-12H4V-19"] },
  category: { sil: ["M-14 -10L-6 -20H14V0H-6Z"], ink: ["M-14 -10L-6 -20H14V0H-6Z"], detail: ["M2 -10H9"], rings: [[-4, -10, 2]] },
  report:   { sil: [SHEET], ink: [SHEET, "M4 -28V-21H11"], detail: ["M-6 -4V-9M-1 -4V-15M4 -4V-11"] },
  // system
  model:    { sil: ["M-12 -24H12V0H-12Z"], ink: ["M-12 -24H12V0H-12Z"], detail: ["M-5.5 -17L5.5 -12L-5.5 -7"], rings: [[-5.5, -17, 2.5], [-5.5, -7, 2.5], [5.5, -12, 2.5]] },
  tool:     { sil: ["M-9 -20H9V-8L4 -3H-4L-9 -8Z"], ink: ["M-9 -20H9V-8L4 -3H-4L-9 -8Z", "M-4 -20V-28M4 -20V-28", "M0 -3V0"] },
  server:   { sil: ["M-11 -28H11V0H-11Z"], ink: ["M-11 -28H11V0H-11Z"], detail: ["M-11 -18.7H11M-11 -9.3H11"], dots: [[6, -23.3, 1.3], [6, -14, 1.3], [6, -4.7, 1.3]] },
  cloud:    { sil: ["M-8 0A6 6 0 0 1 -8 -12A8 8 0 0 1 8 -12A6 6 0 0 1 8 0Z"], ink: ["M-8 0A6 6 0 0 1 -8 -12A8 8 0 0 1 8 -12A6 6 0 0 1 8 0Z"] },
  queue:    { sil: ["M-13 -14h7v14h-7z", "M-3.5 -14h7v14h-7z", "M6 -14h7v14h-7z"], ink: ["M-13 -14h7v14h-7z", "M-3.5 -14h7v14h-7z", "M6 -14h7v14h-7z"] },
  // contact and money (no role: ink only)
  envelope: { sil: ["M-13 -18H13V0H-13Z"], ink: ["M-13 -18H13V0H-13Z"], detail: ["M-13 -18L0 -8L13 -18"] },
  web:      { sil: ["M-13 -22H13V0H-13Z"], ink: ["M-13 -22H13V0H-13Z", "M-13 -16H13"], dots: [[-9.5, -19, 1.1], [-6, -19, 1.1]] },
  cost:     { sil: ["M-13 -16H13V0H-13Z"], ink: ["M-13 -16H13V0H-13Z"], rings: [[0, -8, 3.5]] },
  // tokens: the small things that travel along a line in motion
  slip:     { sil: ["M-4 -10H2L4 -8V0H-4Z"], ink: ["M-4 -10H2L4 -8V0H-4Z"] },
  dot:      { sil: ["M-3.5 -3.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0"], ink: ["M-3.5 -3.5a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0 -7 0"] },
  packet:   { sil: ["M-4 -8H4V0H-4Z"], ink: ["M-4 -8H4V0H-4Z"] },
};

// glyph(svg, "document", x, y, { wash, planned, hatch, label, sub, mark, upTo }) → g with g._label, g._sub, g._mark
//   wash    role colour            planned  drawn in pencil, no wash
//   hatch   0..1: being processed  mark     state mark at the top right corner ("done", "error", "warning", "time", "question")
function glyph(svg, name, x, y, opts = {}) {
  const { wash = null, planned = false, hatch = null, label: text = null, sub = null, mark = null, upTo = 4 } = opts;
  const def = GLYPHS[name];
  const g = el(svg, "g", { transform: "translate(" + x + " " + y + ")" });
  const pen = planned ? GLYPH_PENCIL : INK, weight = planned ? 1.6 : 2;
  def.sil.forEach(d => el(g, "path", { d, fill: PAPER }));
  if (wash && !planned && upTo >= 2) {
    if (hatch === null) {
      const w = el(g, "g", { fill: wash, opacity: .3, style: "mix-blend-mode:multiply", transform: "translate(3 2)" });
      def.sil.forEach(d => el(w, "path", { d }));
    } else hatchFill(g, def.sil, wash, hatch);
  }
  if (upTo >= 3) def.ink.forEach(d => el(g, "path", { d, fill: "none", stroke: pen, "stroke-width": weight, "stroke-linejoin": "round", "stroke-linecap": "round" }));
  if (upTo >= 4) {
    (def.detail || []).forEach(d => el(g, "path", { d, fill: "none", stroke: pen, "stroke-width": 1.5, "stroke-linejoin": "round", "stroke-linecap": "round" }));
    (def.rings || []).forEach(([cx, cy, r]) => el(g, "circle", { cx, cy, r, fill: PAPER, stroke: pen, "stroke-width": 1.5 }));
    (def.dots || []).forEach(([cx, cy, r]) => el(g, "circle", { cx, cy, r, fill: pen }));
  }
  if (mark) g._mark = stateMark(g, mark, 14, -(def.h || 32) + 4);
  if (text) g._label = label(g, 0, 18, text, { "text-anchor": "middle", "font-size": 12 });
  if (sub) g._sub = label(g, 0, 33, sub, { "text-anchor": "middle", "font-size": 11.5, "font-weight": 500, fill: GLYPH_PENCIL });
  return g;
}

// a small group: two behind, one in front; the front one covers them (as crowd() in system.js)
function glyphCrowd(svg, name, x, y, opts = {}) {
  const g = el(svg, "g", {});
  glyph(g, name, x - 13, y - 7, { ...opts, label: null, sub: null, mark: null });
  glyph(g, name, x + 13, y - 7, { ...opts, label: null, sub: null, mark: null });
  const front = glyph(g, name, x, y, opts);
  g._label = front._label;
  return g;
}

// state marks: small pen marks with a paper halo, so they read on top of a glyph's corner
function stateMark(svg, name, x, y) {
  const g = el(svg, "g", { transform: "translate(" + x + " " + y + ")" });
  const pen = (d, w = 2) => {
    el(g, "path", { d, fill: "none", stroke: PAPER, "stroke-width": w + 3.5, "stroke-linecap": "round", "stroke-linejoin": "round" });
    return () => el(g, "path", { d, fill: "none", stroke: INK, "stroke-width": w, "stroke-linecap": "round", "stroke-linejoin": "round" });
  };
  if (name === "done") pen("M-4.5 -6L-1.5 -3L5 -10")();
  if (name === "error") pen("M-4 -10L4 -2M4 -10L-4 -2")();
  if (name === "warning") {
    const tri = "M0 -12L6.5 -1H-6.5Z";
    el(g, "path", { d: tri, fill: PAPER, stroke: PAPER, "stroke-width": 5.5, "stroke-linejoin": "round" });
    el(g, "path", { d: tri, fill: PAPER, stroke: INK, "stroke-width": 2, "stroke-linejoin": "round" });
    el(g, "path", { d: "M0 -8.2V-5", fill: "none", stroke: INK, "stroke-width": 1.5, "stroke-linecap": "round" });
    el(g, "circle", { cx: 0, cy: -2.9, r: .9, fill: INK });
  }
  if (name === "time") {
    el(g, "circle", { cx: 0, cy: -6.5, r: 5.5, fill: PAPER, stroke: PAPER, "stroke-width": 5.5 });
    el(g, "circle", { cx: 0, cy: -6.5, r: 5.5, fill: PAPER, stroke: INK, "stroke-width": 2 });
    el(g, "path", { d: "M0 -6.5V-10M0 -6.5H2.8", fill: "none", stroke: INK, "stroke-width": 1.5, "stroke-linecap": "round" });
  }
  if (name === "question") {
    const t = label(g, 0, -1.5, "?", { "text-anchor": "middle", "font-size": 15, "font-weight": 700, stroke: PAPER, "stroke-width": 4, "paint-order": "stroke", "stroke-linejoin": "round" });
    t.setAttribute("paint-order", "stroke");
  }
  return g;
}

// ---------- stickers: somebody else's mark is never redrawn; it is stuck on the sheet ----------
// The official mark, unchanged and in one colour, on a white label a shade whiter than the paper,
// tilted a little, with the grey hairline of the name marker. No shadow.
const FOREIGN_MARKS = {
  // GitHub Invertocat · GitHub_Invertocat_Black.svg from brand.github.com/GitHub_Logos.zip (2026-10-04)
  github: { box: [98, 96], paths: [["M41.4395 69.3848C28.8066 67.8535 19.9062 58.7617 19.9062 46.9902C19.9062 42.2051 21.6289 37.0371 24.5 33.5918C23.2559 30.4336 23.4473 23.7344 24.8828 20.959C28.7109 20.4805 33.8789 22.4902 36.9414 25.2656C40.5781 24.1172 44.4062 23.543 49.0957 23.543C53.7852 23.543 57.6133 24.1172 61.0586 25.1699C64.0254 22.4902 69.2891 20.4805 73.1172 20.959C74.457 23.543 74.6484 30.2422 73.4043 33.4961C76.4668 37.1328 78.0937 42.0137 78.0937 46.9902C78.0937 58.7617 69.1934 67.6621 56.3691 69.2891C59.623 71.3945 61.8242 75.9883 61.8242 81.252L61.8242 91.2051C61.8242 94.0762 64.2168 95.7031 67.0879 94.5547C84.4102 87.9512 98 70.6289 98 49.1914C98 22.1074 75.9883 6.69539e-07 48.9043 4.309e-07C21.8203 1.92261e-07 -1.9479e-07 22.1074 -4.3343e-07 49.1914C-6.20631e-07 70.4375 13.4941 88.0469 31.6777 94.6504C34.2617 95.6074 36.75 93.8848 36.75 91.3008L36.75 83.6445C35.4102 84.2188 33.6875 84.6016 32.1562 84.6016C25.8398 84.6016 22.1074 81.1563 19.4277 74.7441C18.375 72.1602 17.2266 70.6289 15.0254 70.3418C13.877 70.2461 13.4941 69.7676 13.4941 69.1934C13.4941 68.0449 15.4082 67.1836 17.3223 67.1836C20.0977 67.1836 22.4902 68.9063 24.9785 72.4473C26.8926 75.2227 28.9023 76.4668 31.2949 76.4668C33.6875 76.4668 35.2187 75.6055 37.4199 73.4043C39.0469 71.7773 40.291 70.3418 41.4395 69.3848Z", "mark"]] },
  // LinkedIn [in] · vector from Wikimedia Commons (LinkedIn_icon.svg). Its download needs the owner's consent to LinkedIn's terms:
  // replace these paths with the black [in] from brand.linkedin.com/downloads once he has downloaded it.
  linkedin: { box: [72, 72], paths: [
    ["M8,72 L64,72 C68.418278,72 72,68.418278 72,64 L72,8 C72,3.581722 68.418278,0 64,0 L8,0 C3.581722,0 0,3.581722 0,8 L0,64 C0,68.418278 3.581722,72 8,72 Z", "mark"],
    ["M62,62 L51.315625,62 L51.315625,43.8021149 C51.315625,38.8127542 49.4197917,36.0245323 45.4707031,36.0245323 C41.1746094,36.0245323 38.9300781,38.9261103 38.9300781,43.8021149 L38.9300781,62 L28.6333333,62 L28.6333333,27.3333333 L38.9300781,27.3333333 L38.9300781,32.0029283 C38.9300781,32.0029283 42.0260417,26.2742151 49.3825521,26.2742151 C56.7356771,26.2742151 62,30.7644705 62,40.051212 L62,62 Z M16.349349,22.7940133 C12.8420573,22.7940133 10,19.9296567 10,16.3970067 C10,12.8643566 12.8420573,10 16.349349,10 C19.8566406,10 22.6970052,12.8643566 22.6970052,16.3970067 C22.6970052,19.9296567 19.8566406,22.7940133 16.349349,22.7940133 Z M11.0325521,62 L21.769401,62 L21.769401,27.3333333 L11.0325521,27.3333333 L11.0325521,62 Z", "white"],
  ] },
};
// sticker(svg, "github", cx, cy, { size, angle, colour }): colour = the mark's own colour instead of black (option B)
function sticker(svg, kind, cx, cy, opts = {}) {
  const { size = 40, angle = -3, colour = null, label: bare = false } = opts;
  const m = FOREIGN_MARKS[kind], inner = size * 0.64, k = inner / Math.max(...m.box);
  const g = el(svg, "g", { transform: "translate(" + cx + " " + cy + ") rotate(" + angle + ")" });
  if (!bare) el(g, "rect", { x: -size / 2, y: -size / 2, width: size, height: size, fill: "#ffffff", stroke: "#66625c", "stroke-opacity": .75, "stroke-width": .6 });
  const mark = el(g, "g", { transform: "translate(" + (-m.box[0] * k / 2) + " " + (-m.box[1] * k / 2) + ") scale(" + k + ")" });
  m.paths.forEach(([d, role]) => el(mark, "path", { d, fill: role === "white" ? "#ffffff" : (colour || "#000000") }));
  return g;
}

// HTML shorthand: <svg data-glyph="envelope"></svg> and <svg data-sticker="github" data-angle="2"></svg>
// draw themselves at the size the CSS gives them (56 px on slides, 40 px in documents and on the web, never under 34 px).
function drawInlineGlyphs() {
  document.querySelectorAll("svg[data-glyph]").forEach(svg => {
    svg.replaceChildren();
    const def = GLYPHS[svg.dataset.glyph], top = -(def.h || 32);
    glyph(svg, svg.dataset.glyph, 0, 0, { wash: svg.dataset.wash || null });
    const b = svg.getBBox(), cy = b.height ? b.y + b.height / 2 : top / 2;
    svg.setAttribute("viewBox", "-20 " + (cy - 20) + " 40 40");
  });
  document.querySelectorAll("svg[data-sticker]").forEach(svg => {
    svg.setAttribute("viewBox", "-22 -22 44 44");
    svg.replaceChildren();
    sticker(svg, svg.dataset.sticker, 0, 0, { size: 40, angle: Number(svg.dataset.angle || -3) });
  });
}
drawInlineGlyphs();
