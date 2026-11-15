import { config } from './config.js';
import { MinecraftBridge } from './minecraft.js';
import { DiscordBridge } from './discord.js';
import { handleCommand } from './commands.js';

const mc = new MinecraftBridge();
const discord = new DiscordBridge(mc);

// Guild chat -> Discord, and !commands (answers go out as private messages)
mc.on('guildChat', (chat) => {
  discord.sendChat(chat).catch((e) => console.error('[Discord] sendChat:', e.message));
  handleCommand(chat.name, chat.message, (reply) => mc.pm(chat.name, reply));
});

// Commands also work when sent to the bot privately
mc.on('pm', ({ name, message }) => {
  handleCommand(name, message, (reply) => mc.pm(name, reply));
});

// Guild members logging on / off
mc.on('online', (name) => discord.sendEvent('online', name).catch((e) => console.error('[Discord] sendEvent:', e.message)));
mc.on('offline', (name) => discord.sendEvent('offline', name).catch((e) => console.error('[Discord] sendEvent:', e.message)));

mc.on('join', (name) => {
  discord.sendEvent('join', name).catch((e) => console.error('[Discord] sendEvent:', e.message));
  const welcome = config.welcomeMessage.replace('{player}', name).replace('{discord}', config.discord.invite);
  setTimeout(() => mc.guildChat(welcome), 3000);
});
mc.on('leave', (name) => discord.sendEvent('leave', name).catch((e) => console.error(e.message)));
mc.on('kick', ({ name, by }) => discord.sendEvent('kick', name, by).catch((e) => console.error(e.message)));

process.on('unhandledRejection', (e) => console.error('[Unhandled]', e));

await discord.start();
mc.start();