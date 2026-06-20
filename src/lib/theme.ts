/** Prose-font application, extracted from the old Settings view. */
const PROSE_FONTS: { id: string; stack: string }[] = [
  { id: "newsreader", stack: '"Newsreader", serif' },
  { id: "source", stack: '"Source Serif 4", serif' },
  { id: "fraunces", stack: '"Fraunces", serif' },
  { id: "inter", stack: '"Inter", system-ui, sans-serif' },
];

export function applyProseFont(id: string) {
  const f = PROSE_FONTS.find((x) => x.id === id) ?? PROSE_FONTS[0];
  document.documentElement.style.setProperty("--font-prose", f.stack);
  localStorage.setItem("weft-prose-font", f.id);
}
