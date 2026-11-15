/** An error whose message is safe to show to players in game. */
export class UserError extends Error {}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const num = (n) => Number(n ?? 0).toLocaleString('en-US');
export const ratio = (a, b) => (b === 0 ? Number(a).toFixed(2) : (a / b).toFixed(2));
export const validName = (n) => /^\w{1,16}$/.test(n);

/** Strip anything Minecraft chat would reject or that could be abused. */
export const cleanMc = (s) =>
  String(s)
    .replace(/[\u0000-\u001f\u007f\u00a7]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export function chunk(text, size) {
  const out = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

export const truncate = (s, n) => (s.length > n ? s.slice(0, n - 3) + '...' : s);
