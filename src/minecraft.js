import { EventEmitter } from 'node:events';
import mineflayer from 'mineflayer';
import { config } from './config.js';
import { sleep, cleanMc } from './util.js';

// Hypixel chat formats. All patterns are anchored so players cannot fake them with chat text.
const GUILD_CHAT = /^Guild > (?:(\[[^\]]+\]) )?(\w{1,16})(?: \[([^\]]{1,20})\])?: (.+)$/;
const ONLINE = /^Guild > (?:\[[^\]]+\] )?(\w{1,16}) joined\.$/;
const OFFLINE = /^Guild > (?:\[[^\]]+\] )?(\w{1,16}) left\.$/;
const JOIN = /^(?:\[[^\]]+\] )?(\w{1,16}) joined the guild!$/;
const LEAVE = /^(?:\[[^\]]+\] )?(\w{1,16}) left the guild!$/;
const KICK = /^(?:\[[^\]]+\] )?(\w{1,16}) was kicked from the guild by (?:\[[^\]]+\] )?(\w{1,16})!$/;
const PRIVATE_MSG = /^From (?:\[[^\]]+\] )?(\w{1,16}): (.+)$/;

/**
 * Events: ready(username), disconnect(), guildChat({name, rank, guildRank, message}),
 *         online(name), offline(name),
 *         join(name), leave(name), kick({name, by}), pm({name, message})
 */
export class MinecraftBridge extends EventEmitter {
  bot = null;
  #queue = [];
  #draining = false;
  #lastSent = '';
  #attempt = 0;

  start() {
    this.#connect();
  }

  /** Send a message to guild chat. */
  guildChat(text) {
    this.#enqueue(`/gc ${cleanMc(text)}`);
  }

  /** Send a private message to a player. */
  pm(name, text) {
    this.#enqueue(`/msg ${name} ${cleanMc(text)}`);
  }

  #connect() {
    console.log('[MC] Connecting to', config.mc.host);
    const bot = mineflayer.createBot({
      host: config.mc.host,
      port: 25565,
      username: config.mc.email,
      auth: 'microsoft',
      version: config.mc.version,
      profilesFolder: './auth-cache',
      viewDistance: 'tiny',
      hideErrors: true,
      checkTimeoutInterval: 30_000,
    });
    this.bot = bot;

    let ready = false;
    bot.on('spawn', async () => {
      if (ready) return;
      ready = true;
      this.#attempt = 0;
      console.log(`[MC] Logged in as ${bot.username}`);
      this.emit('ready', bot.username);
      await sleep(3000);
      if (this.bot === bot) bot.chat('/limbo'); // keeps the bot out of lobby traffic
    });

    bot.on('messagestr', (msg, position) => {
      if (position === 'game_info') return; // action bar
      this.#handleLine(msg.trim());
    });

    bot.on('kicked', (reason) =>
      console.warn('[MC] Kicked:', typeof reason === 'string' ? reason : JSON.stringify(reason)),
    );
    bot.on('error', (err) => console.error('[MC] Error:', err.message));
    bot.on('end', (reason) => {
      if (this.bot === bot) this.bot = null;
      this.emit('disconnect');
      const delay = Math.min(60_000, 5_000 * 2 ** this.#attempt++);
      console.warn(`[MC] Disconnected (${reason}). Reconnecting in ${delay / 1000}s`);
      setTimeout(() => this.#connect(), delay);
    });
  }

  #isSelf(name) {
    return this.bot?.username?.toLowerCase() === name.toLowerCase();
  }

  #handleLine(line) {
    let m;
    if ((m = GUILD_CHAT.exec(line))) {
      const [, rank, name, guildRank, message] = m;
      if (this.#isSelf(name)) return; // our own relayed/welcome messages
      this.emit('guildChat', {
        name,
        rank: rank ? rank.slice(1, -1) : null,
        guildRank: guildRank ?? null,
        message,
      });
    } else if ((m = ONLINE.exec(line))) {
      if (!this.#isSelf(m[1])) this.emit('online', m[1]);
    } else if ((m = OFFLINE.exec(line))) {
      if (!this.#isSelf(m[1])) this.emit('offline', m[1]);
    } else if ((m = JOIN.exec(line))) {
      this.emit('join', m[1]);
    } else if ((m = LEAVE.exec(line))) {
      this.emit('leave', m[1]);
    } else if ((m = KICK.exec(line))) {
      this.emit('kick', { name: m[1], by: m[2] });
    } else if ((m = PRIVATE_MSG.exec(line))) {
      this.emit('pm', { name: m[1], message: m[2] });
    }
  }

  #enqueue(text) {
    this.#queue.push(text.slice(0, 250));
    this.#drain();
  }

  async #drain() {
    if (this.#draining) return;
    this.#draining = true;
    while (this.#queue.length) {
      let text = this.#queue.shift();
      if (!this.bot) {
        console.warn('[MC] Dropped message (not connected):', text);
        continue;
      }
      // Hypixel refuses identical consecutive messages
      if (text === this.#lastSent) text = text.slice(0, 245) + ' ' + Math.random().toString(36).slice(2, 5);
      this.#lastSent = text;
      this.bot.chat(text);
      await sleep(config.mc.chatDelayMs);
    }
    this.#draining = false;
  }
}