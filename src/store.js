import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.cwd(), 'data');
const dataFile = path.join(dataDir, 'guilds.json');
fs.mkdirSync(dataDir, { recursive: true });

let state = { guilds: {} };
try {
  if (fs.existsSync(dataFile)) {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    if (parsed && typeof parsed === 'object' && parsed.guilds) state = parsed;
  }
} catch (error) {
  console.error('Could not read data/guilds.json. Starting with empty settings:', error.message);
}

function defaults() {
  return {
    welcomeChannelId: null,
    modLogChannelId: null,
    suggestionsChannelId: null,
    autoRoleId: null,
    raidAlerts: true,
    raidMode: false,
    antiInvites: true,
    antiSpam: true,
    antiMentionSpam: true,
    youtubeFeeds: [],
    instagramFeeds: [],
    kickFeeds: [],
    warnings: {},
    xp: {},
    economy: {},
    inviteStats: {},
    invitedByMember: {},
    serverStatsChannels: { categoryId: null, membersChannelId: null, boostsChannelId: null, channelsChannelId: null },
    ticketSupportRoleId: null,
    ticketCategoryId: null,
    verifiedRoleId: null,
  };
}

export function getGuildConfig(guildId) {
  if (!state.guilds[guildId]) state.guilds[guildId] = defaults();
  const base = defaults();
  state.guilds[guildId] = {
    ...base,
    ...state.guilds[guildId],
    serverStatsChannels: { ...base.serverStatsChannels, ...(state.guilds[guildId].serverStatsChannels || {}) },
  };
  if (!Array.isArray(state.guilds[guildId].youtubeFeeds)) state.guilds[guildId].youtubeFeeds = [];
  if (!Array.isArray(state.guilds[guildId].instagramFeeds)) state.guilds[guildId].instagramFeeds = [];
  if (!Array.isArray(state.guilds[guildId].kickFeeds)) state.guilds[guildId].kickFeeds = [];
  for (const key of ['economy', 'inviteStats', 'invitedByMember']) {
    if (!state.guilds[guildId][key] || typeof state.guilds[guildId][key] !== 'object') state.guilds[guildId][key] = {};
  }
  if (!state.guilds[guildId].warnings || typeof state.guilds[guildId].warnings !== 'object') state.guilds[guildId].warnings = {};
  if (!state.guilds[guildId].xp || typeof state.guilds[guildId].xp !== 'object') state.guilds[guildId].xp = {};
  return state.guilds[guildId];
}

export function saveStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  const tempFile = `${dataFile}.tmp`;
  fs.writeFileSync(tempFile, JSON.stringify(state, null, 2), 'utf8');
  fs.renameSync(tempFile, dataFile);
}

export function listGuildConfigs() {
  return Object.entries(state.guilds).map(([guildId, config]) => {
    const base = defaults();
    return [guildId, {
      ...base,
      ...config,
      instagramFeeds: Array.isArray(config.instagramFeeds) ? config.instagramFeeds : [],
      kickFeeds: Array.isArray(config.kickFeeds) ? config.kickFeeds : [],
      economy: config.economy && typeof config.economy === 'object' ? config.economy : {},
      inviteStats: config.inviteStats && typeof config.inviteStats === 'object' ? config.inviteStats : {},
      invitedByMember: config.invitedByMember && typeof config.invitedByMember === 'object' ? config.invitedByMember : {},
      serverStatsChannels: { ...base.serverStatsChannels, ...(config.serverStatsChannels || {}) },
      youtubeFeeds: Array.isArray(config.youtubeFeeds) ? config.youtubeFeeds : [],
      warnings: config.warnings && typeof config.warnings === 'object' ? config.warnings : {},
      xp: config.xp && typeof config.xp === 'object' ? config.xp : {},
    }];
  });
}
