import 'dotenv/config';

// Accepts the MiscGuild/bridge variable names as aliases, so an existing .env keeps working.
const ALIASES = {
  MC_EMAIL: ['MINECRAFT_EMAIL'],
  BRIDGE_CHANNEL_ID: ['MEMBER_CHANNEL_ID'],
  DISCORD_INVITE: ['DISCORD_INVITE_LINK'],
  MC_CHAT_SEPARATOR: ['MINECRAFT_CHAT_SEPARATOR'],
  FIRST_WORD_OF_NAME: ['USE_FIRST_WORD_OF_AUTHOR_NAME'],
};
const read = (key) => [key, ...(ALIASES[key] ?? [])].map((k) => process.env[k]).find(Boolean);

function req(key) {
  const v = read(key);
  if (!v) {
    console.error(`Missing ${key} in .env - copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return v;
}
const opt = (key, fallback = '') => read(key) || fallback;

export const config = {
  mc: {
    email: req('MC_EMAIL'),
    host: opt('MC_HOST', 'mc.hypixel.net'),
    version: '1.8.9',
    chatDelayMs: Number(opt('CHAT_DELAY_MS', '900')),
  },
  discord: {
    token: req('DISCORD_TOKEN'),
    bridgeChannelId: req('BRIDGE_CHANNEL_ID'),
    eventsChannelId: opt('EVENTS_CHANNEL_ID') || req('BRIDGE_CHANNEL_ID'),
    useImages: opt('USE_IMAGES', 'true') !== 'false',
    imageScale: Number(opt('IMAGE_SIZE_MULTIPLIER', '1')) || 1, // scales the chat images (1 = default)
    invite: req('DISCORD_INVITE'),
    separator: opt('MC_CHAT_SEPARATOR', ':'),
    firstWordOfName: opt('FIRST_WORD_OF_NAME') === 'true',
  },
  verify: {
    channelId: opt('VERIFY_CHANNEL_ID'), // where !setupverify posts the panel (defaults to the channel you run it in)
    roleId: opt('VERIFIED_ROLE_ID'), // optional role given on success
    guildName: opt('VERIFY_GUILD_NAME', 'our server'),
    imageUrl: opt('VERIFY_IMAGE_URL'), // optional banner image on the panel
  },
  welcomeMessage: opt('WELCOME_MESSAGE', 'Welcome to the guild, {player}! Join our Discord: {discord}'),
  hypixelKey: opt('HYPIXEL_API_KEY'),
  urchin: {
    key: opt('URCHIN_API_KEY'),
    baseUrl: opt('URCHIN_BASE_URL', 'https://coral.urchin.gg').replace(/\/$/, ''),
    authHeader: opt('URCHIN_AUTH_HEADER', 'x-api-key'),
    tagsPath: opt('URCHIN_TAGS_PATH', '/api/tags/{player}'),
    sessionPath: opt('URCHIN_SESSION_PATH', '/api/session/{player}?duration={duration}'),
    debug: opt('DEBUG_API') === 'true',
  },
  commandCooldownMs: Number(opt('COMMAND_COOLDOWN_MS', '3000')),
};
