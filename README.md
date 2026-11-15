# Guild Bridge (Hypixel <-> Discord)

Based on the idea of [MiscGuild/bridge](https://github.com/MiscGuild/bridge), rewritten in plain JavaScript
(no build step) with in-game Bedwars commands, a welcome message and chat-as-image relaying.

## Features
- Guild chat -> Discord as an **image** (head, rank-coloured name, message). Falls back to text if rendering fails (or set `USE_IMAGES=false`).
- Discord -> guild chat (from the bridge channel).
- Join / leave / kick notices posted to a Discord channel.
- Welcomes new members in guild chat with a message + Discord invite.
- In-game commands, **answers are always sent as private messages**:

| Command | What it does |
|---|---|
| `!help` | list of commands |
| `!sd [name]` | Urchin tags for a player |
| `!bw [name]` | Bedwars stats (stars, WLR, FKDR, BBLR, wins, finals, winstreak) |
| `!daily` / `!weekly` / `!monthly` | Bedwars stats gained in that period (Urchin sessions; optional `[name]`) |
| `!gexp` | your own weekly GEXP, today's GEXP and daily average |

Names default to the person who ran the command. Commands also work if someone PMs the bot.

## Discord verification
Members prove they own a Minecraft account before getting access:
1. Put `VERIFY_CHANNEL_ID` (and optionally `VERIFIED_ROLE_ID`, `VERIFY_GUILD_NAME`, `VERIFY_IMAGE_URL`) in `.env`.
2. Give the bot **Manage Nicknames** (and **Manage Roles** if you use a verified role), and put its role *above* the verified role and the members it should rename.
3. A server admin (Manage Server) types `!setupverify` - the bot posts the Verify / Unverify panel and deletes the command.
4. The member clicks **Verify**, enters their IGN; the bot checks the Discord name linked on Hypixel (Social Media) against their Discord account, then sets their nickname to the Minecraft name (and gives the role).
Verified accounts are stored in `data/verified.json`; one Minecraft account can only be tied to one Discord account.
Tip: hide your other channels from `@everyone` and show them only to the verified role. The server owner's nickname can't be changed by any bot.

## Setup
1. Install Node.js 20+.
2. `npm install`
3. Create a Discord bot at https://discord.com/developers/applications, enable **Message Content Intent**
   (Bot tab), invite it with `bot` scope and permissions: View Channel, Send Messages, Attach Files, Embed Links.
4. `cp .env.example .env` and fill it in (see the comments inside).
5. `npm start`. On first start the console shows a Microsoft login code - open the link and enter it.
   The session is cached in `./auth-cache`.
6. Promote the bot account in the guild if you want it to see officer chat, and set
   `My Profile > Social Settings > Private Message Privacy` so members can PM it if you want that.
7. Keep it alive with `npm run pm2:start` (needs `npm i -g pm2`).

Optional: put a Minecraft font at `assets/Minecraft.ttf` to get the in-game look in the images.

## Verify the Urchin endpoints (important)
The Urchin docs site renders with JavaScript, so the endpoint paths and response fields couldn't be read when
this was written. `.env` has `URCHIN_BASE_URL`, `URCHIN_AUTH_HEADER`, `URCHIN_TAGS_PATH` and
`URCHIN_SESSION_PATH` as **best guesses**. Open https://api.urchin.gg, find the tag and session (stats)
endpoints, and copy the real base URL, auth header and paths into `.env`
(`{player}` and `{duration}` are placeholders). Then set `DEBUG_API=true`, run `!sd` and `!daily` once and
compare the logged JSON with `src/api/urchin.js` - that file is the only place response parsing lives.
Get your key with `/dashboard` in the Urchin Discord.

`!bw` and `!gexp` use the official Hypixel API (`HYPIXEL_API_KEY`), since lifetime stats and guild
experience are not session data.

## Notes
- Logging in with Mineflayer is a bot login on Hypixel; use a dedicated account and keep chat rates low.
  Nothing here is endorsed by Hypixel and you are responsible for any punishment.
- Hypixel dev keys expire; request a permanent key at https://developer.hypixel.net.
- Hypixel limits chat to 256 characters and blocks identical consecutive messages; the bot throttles
  (`CHAT_DELAY_MS`), splits long Discord messages and de-duplicates automatically.
