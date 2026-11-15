import { config } from './config.js';
import { UserError, validName, num, ratio, truncate } from './util.js';
import { getUuid } from './api/mojang.js';
import * as hypixel from './api/hypixel.js';
import * as urchin from './api/urchin.js';

const cooldowns = new Map();

async function target(sender, arg) {
  const name = arg ?? sender;
  if (!validName(name)) throw new UserError(`"${truncate(name, 16)}" is not a valid username.`);
  const profile = await getUuid(name);
  if (!profile) throw new UserError(`Player "${name}" was not found.`);
  return profile;
}

/** !daily / !weekly / !monthly share one implementation. */
const period = (label, duration) => async ({ sender, args }) => {
  const p = await target(sender, args[0]);
  const session = await urchin.getSession(p.name, duration);
  if (!session) return `No Urchin session data available for ${p.name} right now.`;
  const summary = urchin.formatDelta(session.delta);
  if (!summary) return `${p.name} has no Bedwars games in the ${label} period yet.`;
  return `${p.name} ${label}: ${summary}`;
};

const commands = {
  help: async () => 'Commands: !bw [name] | !sd [name] | !daily | !weekly | !monthly | !gexp | !help',

  bw: async ({ sender, args }) => {
    const p = await target(sender, args[0]);
    const s = await hypixel.getBedwars(p.uuid);
    if (!s) return `${p.name} has never joined Hypixel.`;

    const fkdr = ratio(s.finalKills, s.finalDeaths);
    const index = (s.stars * Number(fkdr) ** 2).toFixed(2);

    return (
      `@${p.name}'s Bedwars stats: Level: ${s.stars}` +
      ` | Wins: ${num(s.wins)}` +
      ` | WLR: ${ratio(s.wins, s.losses)}` +
      ` | Final Kills: ${num(s.finalKills)}` +
      ` | FKDR: ${fkdr}` +
      ` | Beds Broken: ${num(s.bedsBroken)}` +
      ` | BBLR: ${ratio(s.bedsBroken, s.bedsLost)}` +
      ` | Index: ${index}`
    );
  },

  sd: async ({ sender, args }) => {
    const p = await target(sender, args[0]);
    const [s, tags] = await Promise.all([hypixel.getBedwars(p.uuid), urchin.getTags(p.name)]);
    if (!s) return `${p.name} has never joined Hypixel.`;

    const fkdr = ratio(s.finalKills, s.finalDeaths);
    const index = (s.stars * Number(fkdr) ** 2).toFixed(2);
    const list = tags.length
      ? tags.map((t) => (t.reason ? `${t.type} (${t.reason})` : t.type)).join(', ')
      : 'None';

    return `@${p.name}'s Stats: NWL: ${s.networkLevel ?? '?'} | Stars: ${s.stars} | FKDR: ${fkdr} | Index: ${index} | Tags: ${list}`;
  },

  daily: period('daily', '24h'),
  weekly: period('weekly', '7d'),
  monthly: period('monthly', '30d'),

  gexp: async ({ sender }) => {
    const p = await target(sender);
    const g = await hypixel.getGexp(p.uuid);
    if (!g) return `${p.name} is not in a guild.`;
    return `${p.name} GEXP | Weekly: ${num(g.weekly)} | Today: ${num(g.today)} | Daily avg: ${num(g.perDay)}`;
  },
};

/**
 * Run a command. `reply` is called with the answer text (the caller sends it as a private message).
 * Returns true if the text was a known command.
 */
export async function handleCommand(sender, text, reply) {
  if (!text.startsWith('!')) return false;
  const [raw, ...args] = text.slice(1).trim().split(/\s+/);
  const fn = commands[raw?.toLowerCase()];
  if (!fn) return false;

  const last = cooldowns.get(sender.toLowerCase()) ?? 0;
  if (Date.now() - last < config.commandCooldownMs) return true; // silently ignore spam
  cooldowns.set(sender.toLowerCase(), Date.now());

  try {
    reply(truncate(await fn({ sender, args }), 240));
  } catch (err) {
    if (err instanceof UserError) reply(err.message);
    else {
      console.error(`[CMD] !${raw} failed:`, err);
      reply('Something went wrong, try again later.');
    }
  }
  return true;
}