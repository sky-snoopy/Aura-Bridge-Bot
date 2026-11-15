import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas, GlobalFonts } from '@napi-rs/canvas';
import { config } from './config.js';
import { layout } from './layout.js';

const assets = path.join(path.dirname(fileURLToPath(import.meta.url)), 'assets');

/** Register the first font file that exists under `family` (file names are case-sensitive on Linux). */
function registerFont(files, family) {
  for (const file of files) {
    const p = path.join(assets, file);
    if (fs.existsSync(p)) {
      GlobalFonts.registerFromPath(p, family);
      return true;
    }
  }
  return false;
}

if (!registerFont(['minecraft.ttf', 'Minecraft.ttf', 'MinecraftRegular-Bmg3.ttf'], 'Minecraft')) {
  console.warn('[Image] No Minecraft font found in src/assets - text will use a fallback font.');
}
// Fallback for characters the Minecraft font does not have (accents, symbols, CJK...). Optional.
if (!registerFont(['unifont.ttf', 'Unifont.ttf'], 'MinecraftUnicode')) {
  console.warn('[Image] src/assets/unifont.ttf not found - non-English characters may show as boxes.');
}

// Same geometry as the known-good renderer: 40px font, 1000px wide, 35px first baseline, 40px line height.
const S = config.discord.imageScale;
const WIDTH = Math.round(1000 * S);
const PAD = 5 * S;
const FONT_SIZE = Math.round(40 * S);
const FIRST_BASELINE = 35 * S;
const LINE_HEIGHT = 40 * S;
const BOTTOM_PAD = 10 * S;
const SHADOW = 4 * S;
const FONT = `${FONT_SIZE}px Minecraft, MinecraftUnicode, monospace`;

const RANK_COLORS = {
  'MVP++': '#FFAA00', 'MVP+': '#55FFFF', MVP: '#55FFFF', 'VIP+': '#55FF55', VIP: '#55FF55',
  ADMIN: '#FF5555', YOUTUBE: '#FF5555', MOD: '#00AA00', HELPER: '#5555FF', 'PIG+++': '#FF55FF',
  DEFAULT: '#FF5555', ORANGE: '#FFAA00', GREEN: '#55FF55', YELLOW: '#FFFF55', AQUA: '#55FFFF',
  WHITE: '#FFFFFF', BLUE: '#5555FF', DARK_GREEN: '#00AA00', DARK_RED: '#AA0000',
  DARK_AQUA: '#00AAAA', DARK_PURPLE: '#AA00AA', GRAY: '#AAAAAA', BLACK: '#000000', DARK_BLUE: '#0000AA',
};
const rankColor = (rank) => (rank && RANK_COLORS[rank.toUpperCase()]) || '#AAAAAA';

/** "[MVP+] " as coloured segments (the + gets its own colour). */
function rankSegments(rank, baseCol, plusCol) {
  const out = [{ text: '[', color: baseCol }];
  for (const ch of rank) out.push({ text: ch, color: ch === '+' ? plusCol : baseCol });
  out.push({ text: '] ', color: baseCol });
  return out;
}

/** Draw coloured segments as wrapped Minecraft text with the drop shadow. Returns a PNG buffer. */
function render(segments) {
  const probe = createCanvas(1, 1).getContext('2d');
  probe.font = FONT;
  const measure = (t) => probe.measureText(t).width;

  const { pieces, lines } = layout(segments, measure, WIDTH - PAD - SHADOW, PAD);
  const height = Math.ceil(FIRST_BASELINE + LINE_HEIGHT * (lines - 1) + BOTTOM_PAD);

  const canvas = createCanvas(WIDTH, height);
  const ctx = canvas.getContext('2d');
  ctx.font = FONT;
  ctx.textBaseline = 'alphabetic';

  for (const p of pieces) {
    const y = FIRST_BASELINE + LINE_HEIGHT * p.line;
    ctx.fillStyle = '#131313';
    ctx.fillText(p.text, p.x + SHADOW, y + SHADOW);
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, p.x, y);
  }
  return canvas.toBuffer('image/png');
}

/** Guild chat line: [RANK] Name [GuildRank]: message */
export async function renderChatImage({ name, rank, guildRank, message, plusColor, guildColor, baseColor }) {
  const baseCol = baseColor || rankColor(rank);
  const segments = [];
  if (rank) segments.push(...rankSegments(rank, baseCol, plusColor || '#FF5555'));
  segments.push({ text: name, color: rank ? baseCol : '#AAAAAA' });
  if (guildRank) segments.push({ text: ` [${guildRank}]`, color: guildColor || '#00AAAA' });
  segments.push({ text: ': ', color: '#FFFFFF' });
  segments.push({ text: message, color: '#FFFFFF' });
  return render(segments);
}

/** Join / leave / kick notice drawn in the same Minecraft style as chat messages. */
export async function renderEventImage({ kind, name, rank, plusColor, baseColor, by }) {
  const baseCol = baseColor || rankColor(rank);
  const segments = [];
  if (rank) segments.push(...rankSegments(rank, baseCol, plusColor || '#FF5555'));
  segments.push({ text: name, color: rank ? baseCol : '#AAAAAA' });

  const [text, color] = {
    online: [' joined.', '#FFFF55'],
    offline: [' left.', '#FFFF55'],
    join: [' joined the guild.', '#55FF55'],
    leave: [' left the guild.', '#FF5555'],
    kick: [` was kicked by ${by}.`, '#FFFF55'],
  }[kind] ?? [` ${kind}.`, '#FFFFFF'];
  segments.push({ text, color });
  return render(segments);
}
