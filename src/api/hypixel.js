import { config } from '../config.js';
import { UserError } from '../util.js';
import { getUuid } from './mojang.js';

async function hx(path) {
  if (!config.hypixelKey) throw new UserError('Hypixel API key is not configured.');
  const res = await fetch(`https://api.hypixel.net/v2${path}`, {
    headers: { 'API-Key': config.hypixelKey },
    signal: AbortSignal.timeout(8000),
  });
  if (res.status === 429) throw new UserError('Hypixel API is rate limited, try again in a moment.');
  if (res.status === 403) throw new UserError('Hypixel API key is invalid.');
  if (!res.ok) throw new UserError(`Hypixel API error (${res.status}).`);
  return res.json();
}

/** Hypixel network level from total network EXP. */
const networkLevel = (exp = 0) =>
  Math.floor(1 + (-8750 + Math.sqrt(8750 ** 2 + 5000 * exp)) / 2500);

/** Overall Bedwars stats (lifetime). Returns null if the player never joined Hypixel. */
export async function getBedwars(uuid) {
  const j = await hx(`/player?uuid=${uuid}`);
  if (!j.player) return null;
  const bw = j.player.stats?.Bedwars ?? {};
  return {
    networkLevel: networkLevel(j.player.networkExp),
    stars: j.player.achievements?.bedwars_level ?? 0,
    wins: bw.wins_bedwars ?? 0,
    losses: bw.losses_bedwars ?? 0,
    finalKills: bw.final_kills_bedwars ?? 0,
    finalDeaths: bw.final_deaths_bedwars ?? 0,
    bedsBroken: bw.beds_broken_bedwars ?? 0,
    bedsLost: bw.beds_lost_bedwars ?? 0,
    winstreak: bw.winstreak ?? null, // null if the player has the API setting off
  };
}

/** Discord account linked on Hypixel (Social Media). exists=false if the player never joined Hypixel. */
export async function getLinkedDiscord(uuid) {
  const j = await hx(`/player?uuid=${uuid}`);
  if (!j.player) return { exists: false, discord: null };
  return { exists: true, discord: j.player.socialMedia?.links?.DISCORD ?? null };
}

/** GEXP for one player (last 7 days, from the guild's expHistory). Null if not in a guild. */
export async function getGexp(uuid) {
  const j = await hx(`/guild?player=${uuid}`);
  if (!j.guild) return null;
  const member = j.guild.members?.find((m) => m.uuid === uuid);
  if (!member) return null;
  const days = Object.entries(member.expHistory ?? {}).sort((a, b) => b[0].localeCompare(a[0]));
  const weekly = days.reduce((sum, [, v]) => sum + v, 0);
  return {
    guildName: j.guild.name,
    weekly,
    today: days[0]?.[1] ?? 0,
    perDay: days.length ? Math.round(weekly / days.length) : 0,
  };
}

const COLOR_HEX = {
  BLACK: '#000000', DARK_BLUE: '#0000AA', DARK_GREEN: '#00AA00', DARK_AQUA: '#00AAAA',
  DARK_RED: '#AA0000', DARK_PURPLE: '#AA00AA', GOLD: '#FFAA00', GRAY: '#AAAAAA',
  DARK_GRAY: '#555555', BLUE: '#5555FF', GREEN: '#55FF55', AQUA: '#55FFFF',
  RED: '#FF5555', LIGHT_PURPLE: '#FF55FF', YELLOW: '#FFFF55', WHITE: '#FFFFFF',
};
const hex = (c, fallback) => COLOR_HEX[String(c || '').toUpperCase()] || fallback;

function resolveRank(p) {
  if (p.rank === 'ADMIN') return { rank: 'ADMIN' };
  if (p.rank === 'MODERATOR') return { rank: 'MOD' };
  if (p.rank === 'HELPER') return { rank: 'HELPER' };
  if (p.rank === 'YOUTUBER') return { rank: 'YOUTUBE' };

  const plusColor = hex(p.rankPlusColor, '#FF5555'); // default plus is red

  if (p.monthlyPackageRank === 'SUPERSTAR') {
    return { rank: 'MVP++', plusColor, baseColor: hex(p.monthlyRankColor, '#FFAA00') };
  }
  switch (p.newPackageRank || p.packageRank) {
    case 'MVP_PLUS': return { rank: 'MVP+', plusColor };
    case 'MVP': return { rank: 'MVP' };
    case 'VIP_PLUS': return { rank: 'VIP+', plusColor: '#FFAA00' };
    case 'VIP': return { rank: 'VIP' };
    default: return { rank: null };
  }
}

const profileCache = new Map();
const PROFILE_TTL = 60 * 60 * 1000;

/** Rank, plus color and guild rank for the chat image. Returns null if the player doesn't exist. */
export async function getChatProfile(name) {
  const key = name.toLowerCase();
  const hit = profileCache.get(key);
  if (hit && Date.now() - hit.t < PROFILE_TTL) return hit.v;

  const id = await getUuid(name);
  if (!id) return null;

  const [pl, gl] = await Promise.all([
    hx(`/player?uuid=${id.uuid}`),
    hx(`/guild?player=${id.uuid}`).catch(() => null),
  ]);

  const member = gl?.guild?.members?.find((m) => m.uuid === id.uuid);
  const v = { name: id.name, ...resolveRank(pl.player ?? {}), guildRank: member?.rank ?? null };
  profileCache.set(key, { v, t: Date.now() });
  return v;
}
