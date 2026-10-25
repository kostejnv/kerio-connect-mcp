// Landing page: the "how it works" figure in both languages and the EN/CS switch.
// Uses the identity helpers from system.js and glyphs.js (label, markLabel, component, flow, glyph, ...).

const FIGURE_TEXT = {
  en: {
    zones: [["user", "each with their own account"], ["AI assistant", "ChatGPT or Claude"], ["this server", location.host], ["company", "Kerio mail server"]],
    people: "employees", server: ["Kerio connector", "checks who may see what"], mailboxes: "mailboxes",
    pairs: [["question", "answer"], ["what to look for", "matching e-mails"], ["mail request", "e-mails, attachments"]],
    notes: ["holds an encrypted key", "does not keep the password", "signed-in users only", "mail stays in the company"],
    mark: "read only",
    signIn: "sign-in, once every 90 days",
    steps: [["1 · add the connection", "in ChatGPT or Claude"], ["2 · mail login and password", "on the sign-in page"],
            ["3 · the server checks them", "with Kerio; a wrong password gets nowhere"], ["4 · the assistant gets a key", "encrypted, valid for that person only"]],
  },
  cs: {
    zones: [["uživatel", "každý svým účtem"], ["AI asistent", "ChatGPT nebo Claude"], ["tento server", location.host], ["firma", "poštovní server Kerio"]],
    people: "zaměstnanci", server: ["Kerio konektor", "hlídá, kdo co smí"], mailboxes: "schránky",
    pairs: [["otázka", "odpověď"], ["co hledám", "nalezené e-maily"], ["dotaz do pošty", "e-maily a přílohy"]],
    notes: ["drží šifrovaný klíč", "heslo si nepamatuje", "pustí jen přihlášeného", "pošta zůstává ve firmě"],
    mark: "jen čtení",
    signIn: "přihlášení, jednou za 90 dní",
    steps: [["1 · přidat připojení", "v ChatGPT nebo Claude"], ["2 · jméno a heslo do pošty", "na přihlašovací stránce"],
            ["3 · server je ověří u Keria", "se špatným heslem to neprojde"], ["4 · asistent dostane klíč", "šifrovaný, platí jen pro toho člověka"]],
  },
};

function drawFigure(fig, t) {
  const PENCIL = "#66625c";
  const note = (x, y, text, attrs = {}) => label(fig, x, y, text, { fill: PENCIL, "font-weight": 500, "font-size": 11.5, ...attrs });
  label(fig, 16, 28, "fig. 1", { fill: PENCIL, "font-family": "Azeret Mono", "font-weight": 500, "font-size": 10.5 });

  [60, 280, 520, 900].forEach((x, i) => { label(fig, x, 92, t.zones[i][0], { "font-size": 13 }); note(x, 110, t.zones[i][1]); });

  const ROW = 236, OUT = 212, BACK = 228;
  glyphCrowd(fig, "person", 100, ROW, { wash: "#8a5cf0", label: t.people });
  glyph(fig, "agent", 330, ROW, { wash: "#e24a7b", label: "ChatGPT · Claude" });
  component(fig, 520, 188, 190, 64, "#177a3e", t.server[0], t.server[1]);
  glyph(fig, "server", 940, ROW, { wash: "#1f6fd0", label: "Kerio" });
  glyph(fig, "database", 1080, ROW, { wash: "#1f6fd0", label: t.mailboxes });

  const pair = (x1, x2, words) => {
    flow(fig, [[x1, OUT], [x2, OUT]]);
    flow(fig, [[x2, BACK], [x1, BACK]]);
    if (words) {
      label(fig, (x1 + x2) / 2, OUT - 10, words[0], { "text-anchor": "middle", "font-size": 12 });
      note((x1 + x2) / 2, BACK + 20, words[1], { "text-anchor": "middle" });
    }
  };
  pair(140, 292, t.pairs[0]);
  pair(366, 512, t.pairs[1]);
  pair(718, 916, t.pairs[2]);
  pair(964, 1056, null);

  note(330, 286, t.notes[0], { "text-anchor": "middle" });
  note(520, 286, t.notes[1]);
  note(940, 286, t.notes[2], { "text-anchor": "middle" });
  note(1080, 286, t.notes[3], { "text-anchor": "middle" });

  // the one highlight: read-only access, the same idea as the marked phrase in the text
  markLabel(label(fig, 817, 180, t.mark, { "text-anchor": "middle", "font-size": 13 }));

  label(fig, 60, 356, t.signIn, { "font-size": 13 });
  [60, 310, 560, 820].forEach((x, i) => { label(fig, x, 392, t.steps[i][0], { "font-size": 12 }); note(x, 410, t.steps[i][1]); });
  [[230, 386], [494, 386], [764, 386]].forEach(([x, y]) => flow(fig, [[x, y], [x + 40, y]], true));
}

const drawn = new Set();
function showLanguage(lang) {
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-lang]").forEach((section) => { section.hidden = section.dataset.lang !== lang; });
  document.querySelectorAll(".switch button").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.set === lang)));
  if (!drawn.has(lang)) {
    drawFigure(document.getElementById("fig-" + lang), FIGURE_TEXT[lang]);
    drawn.add(lang);
  }
  markAll();
  try { localStorage.setItem("lang", lang); } catch { /* private mode: remember nothing */ }
}

// ?lang=cs in the address (for sharing) wins, then the visitor's last choice, then the browser language.
let initial = new URLSearchParams(location.search).get("lang");
if (initial !== "en" && initial !== "cs") {
  initial = (navigator.language || "").toLowerCase().startsWith("cs") ? "cs" : "en";
  try { initial = localStorage.getItem("lang") || initial; } catch { /* storage blocked: browser language */ }
}
document.querySelectorAll(".switch button").forEach((button) => button.addEventListener("click", () => showLanguage(button.dataset.set)));
(document.fonts ? document.fonts.ready : Promise.resolve()).then(() => showLanguage(initial));
