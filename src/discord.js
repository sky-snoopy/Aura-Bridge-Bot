import { Client, GatewayIntentBits, Events, AttachmentBuilder, EmbedBuilder } from 'discord.js';
import { config } from './config.js';
import { renderChatImage, renderEventImage } from './image.js';
import { cleanMc, chunk } from './util.js';
import { getChatProfile } from './api/hypixel.js';
import { VerifyModule } from './verify.js';

export class DiscordBridge {
  constructor(mc) {
    this.mc = mc;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async start() {
    this.client.once(Events.ClientReady, (c) => console.log(`[Discord] Logged in as ${c.user.tag}`));
    this.client.on(Events.MessageCreate, (msg) => this.#onMessage(msg));
    new VerifyModule(this.client).register();
    await this.client.login(config.discord.token);
  }

  async #channel(id) {
    return this.client.channels.fetch(id).catch(() => null);
  }

  /** Minecraft guild message -> Discord (as an image, falling back to text). */
  async sendChat(chat) {
    const channel = await this.#channel(config.discord.bridgeChannelId);
    if (!channel) return;
    try {
      if (!config.discord.useImages) throw new Error('images disabled');
      const info = await getChatProfile(chat.name).catch((e) => {
        console.error('[Discord] Profile lookup failed:', e.message);
        return null;
      });
      const png = await renderChatImage({
        ...chat,
        name: info?.name ?? chat.name,
        rank: info ? info.rank : chat.rank,
        plusColor: info?.plusColor ?? chat.plusColor,
        baseColor: info?.baseColor,
        guildRank: chat.guildRank ?? info?.guildRank,
      });
      await channel.send({
        files: [new AttachmentBuilder(png, { name: 'message.png', description: `${chat.name}: ${chat.message}` })],
      });
    } catch (err) {
      if (config.discord.useImages) console.error('[Discord] Image render failed, using text:', err.message);
      await channel.send({ content: `**${chat.name}:** ${chat.message}`, allowedMentions: { parse: [] } });
    }
  }

  /** Join / leave / kick notices. */
  async sendEvent(kind, name, by) {
    const channel = await this.#channel(config.discord.eventsChannelId);
    if (!channel) return;
    if (config.discord.useImages) {
      try {
        const info = await getChatProfile(name).catch(() => null);
        const png = await renderEventImage({
          kind,
          name: info?.name ?? name,
          rank: info?.rank,
          plusColor: info?.plusColor,
          baseColor: info?.baseColor,
          by,
        });
        await channel.send({
          files: [new AttachmentBuilder(png, { name: 'event.png', description: `${name} ${kind}` })],
        });
        return;
      } catch (err) {
        console.error('[Discord] Event image failed, using embed:', err.message);
      }
    }

    const styles = {
      online: { color: 0x57f287, text: `${name} joined.` },
      offline: { color: 0xed4245, text: `${name} left.` },
      join: { color: 0x57f287, text: `${name} joined the guild` },
      leave: { color: 0xed4245, text: `${name} left the guild` },
      kick: { color: 0xfee75c, text: `${name} was kicked by ${by}` },
    };
    const s = styles[kind];
    const embed = new EmbedBuilder()
      .setColor(s.color)
      .setAuthor({ name: s.text, iconURL: `https://minotar.net/helm/${encodeURIComponent(name)}/64.png` });
    await channel.send({ embeds: [embed] });
  }

  /** Discord message -> Hypixel guild chat. */
  #onMessage(msg) {
    if (msg.author.bot || msg.channelId !== config.discord.bridgeChannelId) return;

    let name = cleanMc(msg.member?.displayName ?? msg.author.username).replace(/[^\x20-\x7e]/g, '');
    if (config.discord.firstWordOfName) name = name.split(' ')[0];
    if (!name) name = 'Discord';
    let text = cleanMc(msg.cleanContent);
    if (msg.attachments.size) text = `${text} [attachment]`.trim();
    if (!text) return;

    // Hypixel caps messages at 256 chars including the "/gc " prefix; send up to 3 parts
    const parts = chunk(`${name}${config.discord.separator} ${text}`, 200).slice(0, 3);
    for (const p of parts) this.mc.guildChat(p);
  }
}