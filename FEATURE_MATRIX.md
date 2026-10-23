# Feature matrix — Ujwal Telugu FF All-in-One Bot v2.1.0

This is an original bot project that combines common capabilities in one application. It does not copy proprietary source code and is not a complete one-for-one clone of every bot shown in the screenshot.

| Existing bot / feature family | What this project provides | Status and limitations |
|---|---|---|
| Arcane / MEE6 | Message XP, levels, level leaderboard | Basic feature included; not a full premium-leveling clone |
| Carl-bot / Dyno / Sapphire / R.O.T.I. | Warnings, timeouts, kicks, bans, purge, slowmode, channel lock/unlock, anti-spam/invite/mention filters, audit logs | Common moderation baseline; each bot's automod rules and dashboards are not replicated |
| Invite Tracker | Invite attribution, joins/leaves, invite leaderboard | Included, but depends on Manage Server permission and invite usage being fetchable; vanity/unavailable invites may be unattributed |
| ServerStats | Read-only member, boost, and channel counter voice channels | Included using `.serverstats setup`; renames are debounced due Discord limits |
| Ticket Tool | Private support tickets with close button and configured support role/category | Basic ticket workflow; no transcript export or dashboard clone yet |
| YouTube notifications | New-upload alerts by channel ID | Included via YouTube RSS; polling delays are possible |
| Instagram notifications | Alerts from a configured HTTPS RSS/Atom feed | Requires a provider; an Instagram profile URL alone is not a feed |
| Kick notifications | Alerts from a configured HTTPS RSS/Atom feed | Requires a provider that publishes new-stream/going-live events; not a guaranteed direct Kick API integration |
| Kick moderation notifications | Member kick actions and moderator/reason logs | Included when audit log access is available; this is separate from Kick.com creator alerts |
| Music bot | YouTube URL/search, queue, controls, looping, persistent 24/7-style settings | Uses Lavalink and the configured YouTube source plugin; uptime and source availability are not guaranteed |
| Mimu / OwO | Balance, daily/work/beg rewards, bank transfer, pay, coinflip, slots, money leaderboard, small fun games | Basic custom economy/games only; collection, hunting, pet, inventory, and advanced economy systems are not included |
| Truth or Dare | `.truthordare truth|dare` | Simple built-in prompts |
| TTS Bot | `.tts <text>` sends a Discord TTS-enabled text message | Does not synthesize and stream speech into a voice channel |
| DISBOARD / Discadia | No automated server bumping or directory submission | Intentionally not represented as included; use the platforms' own workflows and terms |
| NQN | No full external-emoji proxy/webhook recreation | Not included in this version |
| Generic server utilities | Welcome, autorole, suggestions, polls, verification button, role management, user/server info, `.stats` | Included, subject to permissions and role hierarchy |

## Deployment relationship

This bot is a separate Discord application you control. It does not modify, take over, or require access to another person's bot or hosting account (including the Garuda-hosted bot from the screenshot). It can run alongside your current bots while you test features. Disable overlapping automations only after testing to avoid duplicate logs, role assignments, moderation actions, and welcome messages.

## Validation level

JavaScript syntax checks and JSON/YAML parsing pass. Dependency installation timed out in the build environment, so the project has not had a full runtime import, Docker build, slash-command registration, live Discord test, voice test, or provider-feed test here. Test in a private server before relying on automatic moderation.
