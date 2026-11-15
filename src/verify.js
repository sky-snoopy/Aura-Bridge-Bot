import {
  ActionRowBuilder, AttachmentBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, Events, MessageFlags,
  ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { UserError, validName } from './util.js';
import { getUuid } from './api/mojang.js';
import { getLinkedDiscord } from './api/hypixel.js';

const FILE = path.resolve('data/verified.json');
const ID = { start: 'verify:start', remove: 'verify:remove', modal: 'verify:modal', ign: 'verify:ign' };
// Put your GIF here (named exactly verify.gif) and the panel will use it
const GIF_PATH = fileURLToPath(new URL('./assets/verify.gif', import.meta.url));
const COOLDOWN_MS = 10_000;

// ---- tiny JSON store: { [discordId]: { uuid, name, at } } ----
const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } };
const save = (db) => { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(db, null, 2)); };

/** Panel image: VERIFY_IMAGE_URL may be a web link or a local file path; falls back to src/assets/verify.gif. */
function panelImage() {
  const v = config.verify.imageUrl.trim();
  if (/^https?:\/\//i.test(v)) return { url: v };
  const file = v ? path.resolve(v) : GIF_PATH;
  if (fs.existsSync(file)) return { file, name: `verify${path.extname(file).toLowerCase() || '.gif'}` };
  if (v) console.error(`[Verify] Image file not found: ${file}`);
  else if (fs.existsSync(GIF_PATH)) return { file: GIF_PATH, name: 'verify.gif' };
  return null;
}

/** Does the Discord name stored on Hypixel belong to this Discord user? (handles new usernames and legacy name#1234) */
export function discordMatches(linked, user) {
  if (!linked) return false;
  const l = String(linked).trim().replace(/^@/, '').toLowerCase();
  return l === user.username.toLowerCase() || l === user.tag.toLowerCase();
}

export class VerifyModule {
  #last = new Map();

  constructor(client) {
    this.client = client;
  }

  register() {
    this.client.on(Events.InteractionCreate, (i) => this.#onInteraction(i).catch((e) => console.error('[Verify]', e)));
    this.client.on(Events.MessageCreate, (m) => this.#onMessage(m).catch((e) => console.error('[Verify]', e)));
  }

  /** `!setupverify` (needs Manage Server) posts the panel in the verify channel. */
  async #onMessage(msg) {
    if (msg.author.bot || !msg.guild || msg.content.trim().toLowerCase() !== '!setupverify') return;
    if (!msg.member?.permissions.has(PermissionFlagsBits.ManageGuild)) return;

    const channel = config.verify.channelId
      ? await this.client.channels.fetch(config.verify.channelId).catch(() => null)
      : msg.channel;
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription(
        `# Welcome to ${config.verify.guildName}!\n` +
        'To interact in this Discord server, you\'ll need to verify your identity through Hypixel.\n\n' +
        '## Follow these steps to verify:\n' +
        '**1.** Link your **Discord** account to your Hypixel Minecraft account (in game: `/profile` > Social Media > Discord).\n\n' +
        '**2.** Click the **Verify** button below.\n\n' +
        '**3.** Enter your **Minecraft username** in the popup and press Submit.\n\n' +
        '## Having issues?\n' +
        '- Make sure your accounts are linked properly.\n' +
        '- If you\'re having trouble, or if you don\'t have a Minecraft account, contact a staff member via ping or DM.\n\u200b',
      );

    const files = [];
    const img = panelImage();
    if (img?.url) {
      embed.setImage(img.url);
    } else if (img?.file) {
      files.push(new AttachmentBuilder(img.file, { name: img.name }));
      embed.setImage(`attachment://${img.name}`);
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(ID.start).setLabel('Verify').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(ID.remove).setLabel('Unverify').setStyle(ButtonStyle.Danger),
    );
    await channel.send({ embeds: [embed], components: [row], files });
    await msg.delete().catch(() => {});
  }

  async #onInteraction(i) {
    if (i.isButton() && i.customId === ID.start) {
      const modal = new ModalBuilder().setCustomId(ID.modal).setTitle('Verification Form').addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId(ID.ign)
            .setLabel('Please enter your IGN:')
            .setStyle(TextInputStyle.Short)
            .setMinLength(1)
            .setMaxLength(16)
            .setRequired(true),
        ),
      );
      return i.showModal(modal);
    }
    if (i.isButton() && i.customId === ID.remove) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      return i.editReply(await this.#unverify(i));
    }
    if (i.isModalSubmit() && i.customId === ID.modal) {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      const ign = i.fields.getTextInputValue(ID.ign).trim();
      try {
        return await i.editReply(await this.#verify(i, ign));
      } catch (err) {
        if (!(err instanceof UserError)) console.error('[Verify]', err);
        return i.editReply(`❌ ${err instanceof UserError ? err.message : 'Something went wrong, try again later.'}`);
      }
    }
  }

  async #verify(i, ign) {
    const wait = (this.#last.get(i.user.id) ?? 0) + COOLDOWN_MS - Date.now();
    if (wait > 0) throw new UserError(`Please wait ${Math.ceil(wait / 1000)}s before trying again.`);
    this.#last.set(i.user.id, Date.now());

    if (!validName(ign)) throw new UserError('That is not a valid Minecraft username.');
    const profile = await getUuid(ign);
    if (!profile) throw new UserError(`No Minecraft account named **${ign}** exists.`);

    const db = load();
    const owner = Object.entries(db).find(([, v]) => v.uuid === profile.uuid)?.[0];
    if (owner && owner !== i.user.id) {
      throw new UserError(`**${profile.name}** is already verified by another Discord account. Contact staff if this is yours.`);
    }

    const { exists, discord } = await getLinkedDiscord(profile.uuid);
    if (!exists) throw new UserError(`**${profile.name}** has never joined Hypixel.`);
    if (!discord) {
      throw new UserError(
        `**${profile.name}** has no Discord linked on Hypixel. Link it in game (\`/profile\` > Social Media > Discord), wait a few minutes, then try again.`,
      );
    }
    if (!discordMatches(discord, i.user)) {
      throw new UserError(
        `The Discord linked to **${profile.name}** on Hypixel (\`${discord}\`) doesn't match your account (\`${i.user.username}\`).`,
      );
    }

    // Success: record, give role, rename
    db[i.user.id] = { uuid: profile.uuid, name: profile.name, at: new Date().toISOString() };
    save(db);

    const notes = [];
    const member = i.member ?? (await i.guild.members.fetch(i.user.id));
    if (config.verify.roleId) {
      await member.roles.add(config.verify.roleId, 'Hypixel verification')
        .catch((e) => { console.error('[Verify] role:', e.message); notes.push('I couldn\'t give you the verified role (check my permissions / role order).'); });
    }
    await member.setNickname(profile.name, 'Hypixel verification')
      .catch((e) => { console.error('[Verify] nickname:', e.message); notes.push('I couldn\'t change your nickname (server owners and members above my role can\'t be renamed).'); });

    return `✅ Verified as **${profile.name}**!${notes.length ? '\n⚠️ ' + notes.join('\n⚠️ ') : ''}`;
  }

  async #unverify(i) {
    const db = load();
    if (!db[i.user.id]) return 'You are not verified.';
    delete db[i.user.id];
    save(db);

    const member = i.member ?? (await i.guild.members.fetch(i.user.id));
    if (config.verify.roleId) await member.roles.remove(config.verify.roleId, 'Unverified').catch(() => {});
    await member.setNickname(null, 'Unverified').catch(() => {});
    return '✅ You have been unverified.';
  }
}