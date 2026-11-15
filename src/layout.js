/**
 * Pure text layout for the Minecraft-style chat images (no canvas needed, so it is easy to test).
 *
 * segments: [{ text, color }]  - coloured runs, drawn left to right
 * measure:  (text) => width in px
 * Returns { pieces: [{ text, color, x, line }], lines } where `line` is a 0-based row.
 *
 * Words are kept together (a "word" is everything up to the next whitespace, even across colour
 * changes, so "Name [Guild]: " never gets split from its colon), wrapped greedily, and a single word
 * wider than a whole line is broken by character.
 */
export function layout(segments, measure, maxX, startX) {
  const words = [];
  let cur = [];
  for (const seg of segments) {
    for (const piece of seg.text.match(/\S+\s*|\s+/g) ?? []) {
      cur.push({ text: piece, color: seg.color });
      if (/\s$/.test(piece)) {
        words.push(cur);
        cur = [];
      }
    }
  }
  if (cur.length) words.push(cur);

  const pieces = [];
  let line = 0;
  let x = startX;

  const push = (text, color) => {
    const last = pieces[pieces.length - 1];
    // merge neighbouring runs of the same colour on the same row (keeps kerning, fewer draw calls)
    if (last && last.line === line && last.color === color && Math.abs(last.x + last.width - x) < 0.01) {
      last.text += text;
      last.width += measure(text);
    } else {
      pieces.push({ text, color, x, line, width: measure(text) });
    }
    x += measure(text);
  };

  for (const word of words) {
    const total = word.reduce((s, p) => s + measure(p.text), 0);
    const last = word[word.length - 1];
    const trailing = measure(last.text) - measure(last.text.trimEnd());
    const visible = total - trailing; // a trailing space may hang past the edge

    if (x > startX && x + visible > maxX) {
      line++;
      x = startX;
    }

    if (visible <= maxX - startX) {
      for (const p of word) push(p.text, p.color);
    } else {
      // one huge word: break it character by character
      for (const p of word) {
        for (const ch of p.text) {
          const cw = measure(ch);
          if (x > startX && x + cw > maxX) {
            line++;
            x = startX;
          }
          push(ch, p.color);
        }
      }
    }
  }

  return { pieces: pieces.map(({ text, color, x, line }) => ({ text, color, x, line })), lines: line + 1 };
}
