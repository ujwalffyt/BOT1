# Ujwal Telugu FF All-in-One Bot

A configurable all-in-one Discord bot project for moderation, anti-raid filters, audit logs, YouTube/Instagram/Kick-feed alerts, Lavalink music, persistent 24/7-style playback, support tickets, verification buttons, chat levels, polls, invite tracking, server-stat channels, lightweight economy/games, TTS messages, role management, and `.stats` diagnostics.

> **Important:** This is a deployable starter project, not a claim of flawless or live-tested service. It has been syntax-checked in this environment, but has not been connected to your Discord application, your guild, or a running Lavalink server. You must complete the setup below and test it in a private/test channel first.

## Features

- **Diagnostics:** `.stats`, `/stats`, `.ping`, `/ping`; CPU sample, process RAM/heap, uptime, Discord latency, guild count, music sessions, YouTube/Instagram/Kick feed counts, runtime versions and Lavalink status.
- **Music:** `.play <YouTube URL or search terms>`, `.join`, `.pause`, `.resume`, `.skip`, `.stop`, `.queue`, `.np`, `.volume 0-100`, `.loop off|track|queue`, `.leave`.
- **24/7-style repeat:** `.247 set <YouTube video or playlist URL>`, `.247 status`, `.247 off`, with saved voice/source settings and reconnect/restart restore attempts. This is best-effort, not an uptime guarantee.
- **Moderation:** `/mod warn`, `/mod warnings`, `/mod clear-warnings`, `/mod timeout`, `/mod kick`, `/mod ban`, `/mod purge`; prefix helpers `.warn`, `.timeout`, `.kick`, `.ban`, `.purge`, `.lock`, `.unlock`, `.slowmode`; `/role add` and `/role remove` with permission and role-hierarchy checks.
- **Security/AutoMod baseline:** join-wave detection, automatic raid-mode enable, recent-join link filter while raid mode is active, rapid/repeated-message filtering, Discord invite filter and mass-mention filter. These are baseline safeguards, not a substitute for Discord AutoMod or human moderation.
- **Moderation and audit notifications:** joins/leaves, kick-vs-leave identification through the audit log, bans/unbans, timeouts, nickname and role changes, message edits/deletes, and channel/role create/delete/update events. Configure `/config logs channel:#bot-logs`. The bot needs **View Audit Log** to identify who performed moderation actions; without it, the action can still be logged but the executor/reason may be unknown.
- **Community:** welcome messages, autorole, suggestions with voting reactions, `/poll`, message XP, `/level`, `/leaderboard`, `/serverinfo`, `/userinfo`, and `.avatar`. Invite attribution and per-inviter join/leave estimates use Discord invite usage snapshots when the bot can fetch server invites.
- **Private support tickets:** `/ticket-panel channel:#support` posts a button; the bot creates a private channel and supports a close button. Configure `/config ticket-role` and optionally `/config ticket-category`. The configured support role and administrator roles need to be managed carefully.
- **Simple button verification:** `/config verified-role` then `/verify-panel channel:#verify`. This gives a role to anyone who clicks the button. It is **not a CAPTCHA or anti-bot verification system**, so do not rely on it alone to stop raids.
- **YouTube uploads:** configure one or more channel feeds with `/config youtube-add`; the bot polls YouTube's RSS feed periodically and announces new uploads.
- **Instagram feed alerts:** configure with `/config instagram-add`. This requires an **HTTPS RSS/Atom feed URL from a compatible feed provider**. An Instagram profile URL alone is not an RSS feed, and Instagram does not provide a universal public RSS endpoint. Provider availability, delays, and Instagram access restrictions can affect delivery. The first poll seeds the current post and avoids a backlog flood.
- **Persistence:** bot settings, warnings, XP, social-feed cursors and 24/7 music settings are stored in `data/guilds.json`.

This is an original combined feature set, not literally every proprietary feature from every Discord bot. Read `FEATURE_MATRIX.md` for an honest included/not-included table. Some services require their own API access or third-party feed provider; no bot can guarantee perfect uptime or bypass platform restrictions.

## Requirements

- Docker Desktop with Docker Compose (recommended), with enough CPU/RAM to run both the bot and Lavalink.
- A Discord application/bot that you control.
- A Discord server where you have permission to add a bot and configure its roles/channels.
- Always-on hosting for 24/7 playback. A computer that sleeps, a free host that pauses services, or a disconnected network will interrupt playback.

The container uses Node.js 24.17+ to match the current discord.js documentation baseline. Lavalink runs as a separate service inside Docker Compose.

## 1. Create the Discord bot

1. Open the [Discord Developer Portal](https://discord.com/developers/applications) and create an application.
2. Open **Bot**, add a bot user if needed, set the visible bot username/avatar you want, and copy its token. Treat the token like a password. Put it only into your local `.env`; never post it in chat, screenshots, GitHub, or this project’s README.
3. In **Bot → Privileged Gateway Intents**, enable **Server Members Intent** and **Message Content Intent**. The former is needed for join/welcome/autorole events; the latter is needed for `.stats`-style prefix commands and content filters. Keep the token private.
4. In **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`. Give only the permissions the bot needs. At minimum the planned features need View Channels, Send Messages, Embed Links, Read Message History, View Audit Log, Manage Server (for invite tracking), Manage Messages, Moderate Members, Kick Members, Ban Members, Manage Channels, Manage Roles (for autorole/verification), Connect, Speak, Send Text-to-Speech Messages (optional), and Add Reactions (for polls/suggestions). Do not grant Administrator unless you intentionally accept that risk. Invite the bot with the generated URL.
5. Move the bot’s server role above roles it must assign or moderate. Discord role hierarchy can still prevent actions even when the bot has the permission bit.

## 2. Configure environment variables

From this folder, copy the sample environment file and edit it locally.

**Windows PowerShell:**

```powershell
Copy-Item .env.example .env
notepad .env
```

**macOS/Linux:**

```bash
cp .env.example .env
nano .env
```

Fill these values:

- `DISCORD_TOKEN`: the bot token from the Developer Portal.
- `CLIENT_ID`: the application ID (from **General Information**).
- `DEV_GUILD_ID`: optional test server ID. During setup, filling this registers slash commands quickly to that server; leave it blank for global registration.
- `LAVALINK_PASSWORD`: replace the example with a long random password. Keep the same value in `.env`; Compose passes it to Lavalink and the bot.
- `SOCIAL_POLL_INTERVAL_MINUTES`: polling cadence for YouTube and configured Instagram/Kick RSS/Atom feeds (minimum two minutes).

Leave `LAVALINK_HOST=lavalink` when running via Docker Compose. Do not commit `.env` to source control. `.gitignore` already excludes it.

## 3. Start the bot

Run from the project folder where `docker-compose.yml` is located. Docker Desktop must be running.

```bash
docker compose run --build --rm bot npm run deploy
docker compose up --build -d
```

View logs:

```bash
docker compose logs -f bot
docker compose logs -f lavalink
```

Restart just the bot after a configuration/code change:

```bash
docker compose restart bot
```

Stop both services:

```bash
docker compose down
```

The first Lavalink startup may take a little longer while it downloads the configured YouTube source plugin. Confirm in the Lavalink logs that the plugin loads and the node is connected before diagnosing music commands.

## 4. Initial setup inside your server

1. Create a private staff log channel such as `#bot-logs`, then run `/config logs channel:#bot-logs`.
2. Set a welcome channel with `/config welcome channel:#welcome`.
3. Optionally set `/config suggestions channel:#suggestions` and `/config autorole role:@Member`.
4. Review the switches with `/config show`. Configure `/config raid-alerts`, `/config anti-invites`, `/config anti-spam`, `/config anti-mentions` as needed.
5. If needed, run `/config ticket-role role:@Support` and `/config ticket-category category:Tickets`; run `/config verified-role role:@Verified` before posting `/verify-panel channel:#verify`.
6. Test in a private channel first: `.help`, `.stats`, `/stats`, `/config show`, `/poll`, `/level`, `/leaderboard`, and a ticket-panel click.

The built-in raid detector is a baseline safety layer, not a full security guarantee or CAPTCHA/verification system. Keep Discord’s own AutoMod and verification settings enabled as appropriate. Carefully monitor any automatic timeout in your own server before relying on it.

## 5. Music commands

Join the voice channel where you want the bot, then use:

```text
.play https://www.youtube.com/watch?v=VIDEO_ID
.play lo-fi music
.queue
.np
.volume 60
.loop off
```

For a repeating source:

```text
.247 set https://www.youtube.com/watch?v=VIDEO_ID
.247 status
.247 off
```

To loop a playlist, pass a YouTube playlist URL. The bot keeps the selected voice channel/source in its local guild settings and tries to restore it after reconnect/restart. `24/7` does not mean a guarantee: the host must be always on, the voice channel must still exist, Lavalink/Discord must reconnect, and the source must remain playable. YouTube may rate-limit requests or make some videos unavailable. Use audio/content you are permitted to play and follow the relevant platform/server rules.

## 6. YouTube upload notifications

1. Get the creator’s **channel ID** (starts with `UC`, often shown in a YouTube channel URL or channel details). A video URL is not a channel ID.
2. Run `/config youtube-add channel_id:UC... channel:#youtube-feed` and optionally choose a `mention_role`.
3. Use `/config youtube-list` to view feeds and `/config youtube-remove channel_id:UC...` to unsubscribe.

The first RSS poll records the latest existing video without sending a backlog of announcements. New uploads are then checked periodically. RSS delays and outages are outside the bot’s control.

## 7. Instagram notifications

1. Choose a feed provider that supports the public Instagram account and supplies an HTTPS RSS/Atom URL. Check that provider's terms, limits, and reliability.
2. Run `/config instagram-add username:ACCOUNT feed_url:https://... channel:#instagram-feed` and optionally choose `mention_role`.
3. Use `/config instagram-list` to inspect subscriptions and `/config instagram-remove username:ACCOUNT` to remove one.

Do not paste private access tokens into Discord. This version polls a feed URL; it does not scrape Instagram's website or claim direct access to every private/public account. The first poll records the newest entry so adding a feed does not immediately announce older posts.

## 8. Tickets, verification, and community commands

- `/ticket-panel channel:#support` posts the create-ticket button. Optionally set `/config ticket-role role:@Support` and `/config ticket-category category:Tickets` first. Check role/channel permissions by opening and closing a test ticket.
- `/config verified-role role:@Verified` followed by `/verify-panel channel:#verify` posts the self-service verification button. Anyone who can see that panel can click it; it is not a CAPTCHA.
- `/poll question:... option1:... option2:...` supports up to four options using numbered reactions.
- `.level [@user]` or `/level` shows XP; `.leaderboard` or `/leaderboard` shows the top ten users. XP is awarded no more than once per minute for a non-command message of at least five characters.
- `/role add` and `/role remove` manage roles, with caller/bot hierarchy checks.

## 9. Invite tracking, server stats, economy, and games

- `.invites [@member]` shows tracked joins, tracked departures, and estimated active invitations. `.invites reset @member` is staff-only. Enable **Manage Server** for the bot if you want it to fetch invite usage. Vanity URLs, expired/unavailable invites, and invite changes it cannot observe may not be attributed correctly.
- `.serverstats setup` creates a category with read-only Members, Boosts, and Channels counters. `.serverstats refresh` requests a refresh, `.serverstats status` shows whether counters are configured, and `.serverstats remove` deletes only the tracked category/counters. Needs Manage Channels and can hit Discord channel-name edit limits if used too frequently; automatic updates are debounced.
- Economy is local to each server and persisted in `data/guilds.json`: `.balance`, `.daily`, `.work`, `.beg`, `.deposit <amount|all>`, `.withdraw <amount|all>`, `.pay @member <amount>`, `.coinflip <bet> heads|tails`, `.slots <bet>`, and `.topmoney`. It is a simple fun economy, not an exact clone of other bots.
- Games: `.truthordare truth|dare`, `.8ball <question>`, and `.rps rock|paper|scissors`. `.tts <text>` sends a TTS-enabled text message if allowed in the channel; it does not read a voice channel aloud.

## 10. Kick creator notifications

Use `/config kick-add username:CREATOR feed_url:https://... channel:#kick-alerts` and optionally choose a mention role. The feed endpoint must be an HTTPS RSS/Atom URL supplied by a compatible provider and should publish entries for going-live events. `/config kick-list` shows feeds and `/config kick-remove username:CREATOR` removes one. This polling method is provider-dependent and cannot guarantee an instant live alert. The first poll seeds the newest entry to avoid posting a historical backlog.

## 11. `.stats`

`.stats` and `/stats` report Discord ping, whether Lavalink is connected, CPU used by the Node bot process as a percentage of one CPU core, process RSS memory, Node heap, OS-reported memory, uptime, guild count, active music sessions, and runtime versions. The first CPU value is a sample since startup; later values are sampled since the previous stats request. CPU can exceed 100% for a process using more than one core. Container/OS memory reports vary by host.

## Troubleshooting

- **Bot is offline:** check `.env`, then `docker compose logs -f bot`. Never share your token while asking for help.
- **Slash commands do not appear:** run `npm run deploy` through the Compose command above and check `CLIENT_ID`; global command propagation may take time. A `DEV_GUILD_ID` speeds testing.
- **`.stats` works but music fails:** check `docker compose logs -f lavalink`, the shared `LAVALINK_PASSWORD`, and voice-channel Connect/Speak permissions. The YouTube plugin must load.
- **`.stats`/prefix commands do not respond:** confirm Message Content Intent is enabled in the Developer Portal and that the prefix in `.env` is `.`.
- **Welcome/autorole not firing:** confirm Server Members Intent is enabled, correct channels/roles are configured, and the bot role is high enough to assign the target role.
- **Kick/ban executor is unknown:** grant View Audit Log to the bot; Discord audit-log access is required to identify who performed the action.
- **Instagram/Kick alerts are not arriving:** confirm the feed URL is a working HTTPS RSS/Atom endpoint, then check `docker compose logs -f bot`; a profile URL on its own is not a feed. Kick notifications depend on what the selected provider publishes.
- **Tickets cannot open or staff cannot see them:** grant Manage Channels to the bot, confirm its role is high enough, and check the configured support role/category permissions.
- **Invite attribution is missing:** ensure Manage Server is granted, then confirm the invite existed in cache before the join. Vanity invites and API failures can prevent attribution.
- **Server-stat channels do not update:** check Manage Channels, ensure the bot-created channel IDs remain configured, and allow the debounce delay.
- **24/7 stops:** check host sleep/restarts, Docker logs, Discord voice connection, YouTube source availability, and the saved channel/source with `.247 status`.

## Validation performed for this package

- JavaScript source syntax checked with `npm run check` using the installed Node runtime.
- Dependency installation timed out in this environment; full runtime import/command-schema validation could not be completed here.
- No live test against your Discord application, your server, Instagram/Kick feed providers, invite attribution, or a running YouTube/Lavalink stream has been performed. Complete first deployment and test in a private server before relying on automation.

## 12. Deploy on Railway (separate Bot + Lavalink services)

Railway is a good beginner-friendly option for this project because it supports persistent background services, GitHub deployments, environment variables, logs, and persistent volumes. **Railway does not run this `docker-compose.yml` directly**; create two Railway services from the same repository instead. Official guide: https://docs.railway.com/guides/docker-compose

### A. Put the project on GitHub

1. Download and extract the ZIP.
2. Create a private repository on GitHub, e.g. `ujwal-telugu-ff-bot`.
3. Upload the *contents* of this folder (including `src/`, `Dockerfile`, `Dockerfile.lavalink`, `lavalink.application.yml`, `package.json`, and README). Do **not** upload `.env`, bot tokens, or `data/guilds.json`.
4. Confirm `.gitignore` is present before committing. Keep the repository private while developing.

### B. Create the Railway project and Lavalink service

1. Sign in at https://railway.com/ and create a new project.
2. Add a service from your GitHub repository.
3. In that service's Settings → Build, set the Dockerfile path to `Dockerfile.lavalink`.
4. In Variables, add `LAVALINK_PASSWORD` with a long, random secret. Do not use the example password.
5. Do not generate a public domain for Lavalink. The bot should connect over Railway private networking.
6. Deploy the service and check its logs for a successful startup and the YouTube source plugin loading. If the plugin fails, music will not work even if the Discord bot comes online.

### C. Create the Discord bot service

1. Add a second service from the same GitHub repository.
2. Set its Dockerfile path to `Dockerfile` (the normal bot Dockerfile).
3. Add these variables under the bot service's Variables tab:

   - `DISCORD_TOKEN` — your bot token.
   - `CLIENT_ID` — your Discord application ID.
   - `LAVALINK_HOST` — the Lavalink service's private hostname, normally `lavalink.railway.internal` if the Railway service is named `lavalink`. If you used a different service name, use its private hostname.
   - `LAVALINK_PORT` — `2333`.
   - `LAVALINK_PASSWORD` — exactly the same secret value used by the Lavalink service.
   - `LAVALINK_SECURE` — `false` for the internal non-TLS connection.
   - `PREFIX` — `.`.
   - `SOCIAL_POLL_INTERVAL_MINUTES` — `3` (or a higher interval if your feed provider has stricter limits).

   Keep `DEV_GUILD_ID` optional; set it to your test server ID during initial testing, then remove it when you want global commands. Do not paste tokens into chat, source code, screenshots, or commit history.

4. In the bot service's Settings → Volumes, create a volume mounted at `/app/data`. The bot stores settings, warnings, XP, feed cursors and other server data in this directory; without a persistent volume, data can be lost during redeploys.
5. Deploy the bot service and inspect its deployment logs. It should log in to Discord and connect to the Lavalink node. Do not add multiple replicas of the bot; duplicate instances can double-handle events and compete for voice connections.

### D. Register slash commands

Before first use, register the slash commands once. The simplest path is to run this from your computer after installing Node.js 24.17+ and npm dependencies:

```bash
npm install
```

Create a local `.env` from `.env.example`, fill in `DISCORD_TOKEN` and `CLIENT_ID`, and optionally set `DEV_GUILD_ID` to your test server ID. Then run:

```bash
npm run deploy
```

Keep `.env` local and never upload it. Once commands are registered, the hosted bot service can handle them. If you edit slash-command definitions later, run `npm run deploy` again.

### E. First deployment checklist

- Test in a private server first; invite the bot with only the permissions needed by enabled features.
- Enable Server Members Intent and Message Content Intent in Discord Developer Portal if using prefix commands and member events.
- Grant View Audit Log for moderation executor notifications, and set the bot role above roles it must manage.
- Test `.stats`, `/stats`, `.help`, a test log event, and a music command in a test voice channel.
- Configure `/config logs channel:#bot-logs`, YouTube feeds and any compatible Instagram/Kick RSS feeds.
- Check Railway Usage after a few days and configure usage limits/alerts. Always-on bot + Lavalink services can incur charges; pricing depends on actual resource use and the current plan.

### Railway architecture note

Railway's Compose guide explains that each Compose service becomes a separate Railway service. This project uses the two Dockerfiles above for that split. The Lavalink service is internal-only; the Discord bot service does not need a public HTTP domain for Gateway connections. Persistent storage belongs on the bot service at `/app/data`.
