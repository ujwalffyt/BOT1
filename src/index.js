import 'dotenv/config';
import os from 'node:os';
import process from 'node:process';
import Parser from 'rss-parser';
import {
  Client,
  GatewayIntentBits,
  Partials,
  Events,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  AuditLogEvent,
  PermissionFlagsBits,
  ChannelType,
  version as discordJsVersion
} from 'discord.js';
import { commands } from './commands.js';
import { getGuildConfig, saveStore, listGuildConfigs } from './store.js';

const PREFIX = process.env.PREFIX || '.';
const APP_NAME = process.env.BOT_DISPLAY_NAME || 'Ujwal Telugu FF Bot';
const GREEN = 0x2ecc71;
const BLUE = 0x3498db;
const ORANGE = 0xf39c12;
const RED = 0xe74c3c;
const parser = new Parser({ timeout: 15000, headers: { 'User-Agent': 'UjwalCommunityGuardian/1.0 (YouTube RSS notifier)' } });

if (!process.env.DISCORD_TOKEN || !process.env.CLIENT_ID) {
  console.error('Missing DISCORD_TOKEN or CLIENT_ID. Copy .env.example to .env and fill in the values.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildInvites,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember]
});

const joinTimestamps = new Map();
const inviteSnapshots = new Map();
const serverStatsTimers = new Map();
const serverStatsUpdating = new Set();
const messageWindows = new Map();
const duplicateMessages = new Map();
const cooldowns = new Map();
const xpCooldowns = new Map();
const recentModerationActions = new Map();
let lastCpuUsage = process.cpuUsage();
let lastCpuAt = process.hrtime.bigint();
let rssPollInFlight = false;
let instagramPollInFlight = false;
let kickPollInFlight = false;

const embed = (title, description, color = BLUE) => new EmbedBuilder()
  .setColor(color)
  .setTitle(title)
  .setDescription(description)
  .setTimestamp();

function truncate(value, max = 1000) {
  const text = String(value ?? '');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function formatDuration(ms) {
  let seconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const days = Math.floor(seconds / 86400); seconds %= 86400;
  const hours = Math.floor(seconds / 3600); seconds %= 3600;
  const minutes = Math.floor(seconds / 60); seconds %= 60;
  return `${days ? `${days}d ` : ''}${hours ? `${hours}h ` : ''}${minutes ? `${minutes}m ` : ''}${seconds}s`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value.toFixed(index >= 2 ? 2 : 1)} ${units[index]}`;
}

function getCpuPercent() {
  const now = process.hrtime.bigint();
  const cpu = process.cpuUsage();
  const elapsedMicros = Number(now - lastCpuAt) / 1000;
  const usedMicros = (cpu.user - lastCpuUsage.user) + (cpu.system - lastCpuUsage.system);
  lastCpuUsage = cpu;
  lastCpuAt = now;
  if (elapsedMicros <= 0) return 0;
  // Process CPU as a percentage of one CPU core. Values can exceed 100 on multi-core workloads.
  return Math.max(0, (usedMicros / elapsedMicros) * 100);
}

async function logToGuild(guild, title, description, color = BLUE) {
  if (!guild) return;
  const config = getGuildConfig(guild.id);
  const t = String(title || '').toLowerCase();
  let category = 'moderation';
  if (/join-wave|additional join wave|invite tracked/.test(t)) category = 'join';
  else if (/message (deleted|edited)/.test(t)) category = 'messages';
  else if (/voice/.test(t)) category = 'voice';
  else if (/role /.test(t) || /role (created|deleted|updated|added|removed)/.test(t) || /member roles changed/.test(t)) category = 'roles';
  else if (/channel |server /.test(t)) category = 'server';
  else if (/member (joined|left|kicked|banned|unbanned|updated|timeout)|nickname|member timed out/.test(t)) category = 'members';
  const channelId = config.logChannels?.[category] || config.modLogChannelId;
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId)
    || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  await channel.send({ embeds: [embed(title, description, color)] }).catch(() => {});
}

async function logToChannel(guild, channelId, message) {
  if (!guild || !channelId) return;
  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (channel?.isTextBased?.()) await channel.send(message).catch(() => {});
}

function isStaff(member) {
  if (!member) return false;
  return member.permissions.has(PermissionFlagsBits.Administrator)
    || member.permissions.has(PermissionFlagsBits.ManageGuild)
    || member.permissions.has(PermissionFlagsBits.ManageMessages);
}

function canModerate(member, permission) {
  return Boolean(member?.permissions?.has(permission) || member?.permissions?.has(PermissionFlagsBits.Administrator));
}

async function requirePermission(message, permission, name) {
  if (canModerate(message.member, permission)) return true;
  await message.reply(`You need **${name}** permission to use this command.`).catch(() => {});
  return false;
}

function validYouTubeChannelId(value) {
  return /^UC[a-zA-Z0-9_-]{20,30}$/.test(String(value || '').trim());
}

function validInstagramUsername(value) {
  return /^[a-zA-Z0-9._]{1,30}$/.test(String(value || '').replace(/^@/, '').trim());
}

function validKickUsername(value) {
  return /^[a-zA-Z0-9_]{1,30}$/.test(String(value || '').replace(/^@/, '').trim());
}

function safeFeedUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !host || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(host) || host.includes(':')) return false;
    return true;
  } catch {
    return false;
  }
}

function levelForXP(xp) {
  return Math.floor(Math.sqrt(Math.max(0, Number(xp) || 0) / 100));
}

function memberXP(config, userId) {
  const entry = config.xp?.[userId];
  return Math.max(0, Number(typeof entry === 'number' ? entry : entry?.xp) || 0);
}

function markModerationAction(guildId, userId) {
  recentModerationActions.set(`${guildId}:${userId}`, Date.now() + 20000);
}

function wasRecentlyHandledByBot(guildId, userId) {
  const key = `${guildId}:${userId}`;
  const expiry = recentModerationActions.get(key) || 0;
  if (expiry <= Date.now()) {
    recentModerationActions.delete(key);
    return false;
  }
  return true;
}

async function findRecentAuditEntry(guild, type, targetId, maxAgeMs = 20000) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    return logs.entries.find((entry) => entry.target?.id === targetId && Date.now() - entry.createdTimestamp <= maxAgeMs) || null;
  } catch (error) {
    // Audit-log notifications require the bot's View Audit Log permission.
    console.warn(`Audit log lookup failed in ${guild.id}:`, error?.message || error);
    return null;
  }
}

function economyWallet(config, userId) {
  if (!config.economy[userId] || typeof config.economy[userId] !== 'object') {
    config.economy[userId] = { cash: 100, bank: 0, dailyAt: 0, workAt: 0, begAt: 0 };
  }
  const wallet = config.economy[userId];
  for (const key of ['cash', 'bank', 'dailyAt', 'workAt', 'begAt']) {
    wallet[key] = Math.max(0, Number(wallet[key]) || 0);
  }
  return wallet;
}

function formatCoins(amount) {
  return `🪙 ${Math.max(0, Math.floor(Number(amount) || 0)).toLocaleString('en-US')} coins`;
}

async function warmInviteCache(guild) {
  try {
    const invites = await guild.invites.fetch();
    inviteSnapshots.set(guild.id, new Map(invites.map((invite) => [invite.code, Number(invite.uses || 0)])));
    return true;
  } catch (error) {
    console.warn(`Invite cache unavailable for ${guild.id}; ensure Manage Server permission:`, error?.message || error);
    return false;
  }
}

async function detectUsedInvite(guild) {
  try {
    const before = inviteSnapshots.get(guild.id) || new Map();
    const invites = await guild.invites.fetch();
    let selected = null;
    let largestDelta = 0;
    for (const invite of invites.values()) {
      const delta = Number(invite.uses || 0) - Number(before.get(invite.code) || 0);
      if (delta > largestDelta) { selected = invite; largestDelta = delta; }
    }
    inviteSnapshots.set(guild.id, new Map(invites.map((invite) => [invite.code, Number(invite.uses || 0)])));
    return selected;
  } catch (error) {
    console.warn(`Could not identify used invite in ${guild.id}:`, error?.message || error);
    return null;
  }
}

async function refreshServerStats(guild) {
  if (!guild || serverStatsUpdating.has(guild.id)) return;
  const config = getGuildConfig(guild.id);
  const stats = config.serverStatsChannels || {};
  const definitions = [
    [stats.membersChannelId, `👥 Members: ${guild.memberCount || 0}`],
    [stats.boostsChannelId, `💎 Boosts: ${guild.premiumSubscriptionCount || 0}`],
    [stats.channelsChannelId, `📚 Channels: ${guild.channels.cache.size}`]
  ];
  if (!definitions.some(([id]) => id)) return;
  serverStatsUpdating.add(guild.id);
  try {
    for (const [channelId, name] of definitions) {
      if (!channelId) continue;
      const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
      if (channel && channel.name !== name) await channel.setName(name, 'Refresh configured server-stat counter').catch((error) => console.warn('Server stats rename failed:', error?.message || error));
    }
  } finally {
    serverStatsUpdating.delete(guild.id);
  }
}

function scheduleServerStatsUpdate(guild, delayMs = 5 * 60 * 1000) {
  if (!guild) return;
  const current = serverStatsTimers.get(guild.id);
  if (current) clearTimeout(current);
  const timer = setTimeout(() => {
    serverStatsTimers.delete(guild.id);
    refreshServerStats(guild).catch((error) => console.error('Server stats update failed:', error));
  }, delayMs);
  timer.unref?.();
  serverStatsTimers.set(guild.id, timer);
}

async function awardMessageXP(message, config) {
  const key = `${message.guild.id}:${message.author.id}`;
  const now = Date.now();
  if (now - (xpCooldowns.get(key) || 0) < 60000) return;
  xpCooldowns.set(key, now);
  const oldXP = memberXP(config, message.author.id);
  const amount = 5 + Math.floor(Math.random() * 11);
  const newXP = oldXP + amount;
  config.xp[message.author.id] = { xp: newXP };
  saveStore();
  const oldLevel = levelForXP(oldXP);
  const newLevel = levelForXP(newXP);
  if (newLevel > oldLevel) {
    await message.channel.send({
      content: `🎉 ${message.author} reached **Level ${newLevel}**!`,
      allowedMentions: { users: [message.author.id] }
    }).catch(() => {});
  }
}

function botStatsEmbed() {
  const cpu = getCpuPercent();
  const mem = process.memoryUsage();
  const osTotal = os.totalmem();
  const osFree = os.freemem();
  return embed('🤖 Bot system stats', 'Live process and connection diagnostics.', GREEN)
    .addFields(
      { name: 'Status', value: '🟢 Online', inline: true },
      { name: 'Discord ping', value: `${Math.max(0, Math.round(client.ws.ping))} ms`, inline: true },
      { name: 'Process CPU', value: `${cpu.toFixed(1)}% of one core`, inline: true },
      { name: 'Process RAM (RSS)', value: formatBytes(mem.rss), inline: true },
      { name: 'Node heap', value: `${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`, inline: true },
      { name: 'OS-reported RAM', value: `${formatBytes(osTotal - osFree)} / ${formatBytes(osTotal)}`, inline: true },
      { name: 'Uptime', value: formatDuration(process.uptime() * 1000), inline: true },
      { name: 'Guilds', value: String(client.guilds.cache.size), inline: true },
      { name: 'YouTube feeds', value: String(listGuildConfigs().reduce((count, [, config]) => count + config.youtubeFeeds.length, 0)), inline: true },
      { name: 'Instagram feeds', value: String(listGuildConfigs().reduce((count, [, config]) => count + config.instagramFeeds.length, 0)), inline: true },
      { name: 'Kick feeds', value: String(listGuildConfigs().reduce((count, [, config]) => count + config.kickFeeds.length, 0)), inline: true },
      { name: 'Runtime', value: `Node.js ${process.version}\ndiscord.js ${discordJsVersion}`, inline: true },
      { name: 'Host platform', value: `${os.type()} ${os.release()} (${os.arch()})`, inline: true }
    )
    .setFooter({ text: 'CPU is process usage sampled since the last stats request (first sample since startup).' });
}

function memberTargetFromMessage(message, rawId) {
  const match = rawId?.match(/^<@!?(\d+)>$/) || rawId?.match(/^(\d{17,20})$/);
  if (!match) return null;
  return message.guild.members.fetch(match[1]).catch(() => null);
}

function parseDuration(input) {
  const match = String(input || '').match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const factor = { s: 1000, m: 60000, h: 3600000, d: 86400000 }[match[2].toLowerCase()];
  const result = amount * factor;
  if (!Number.isFinite(result) || result < 1000 || result > 28 * 86400000) return null;
  return result;
}

async function handlePrefixCommand(message) {
  const raw = message.content.slice(PREFIX.length).trim();
  if (!raw) return;
  const splitAt = raw.search(/\s/);
  const command = (splitAt === -1 ? raw : raw.slice(0, splitAt)).toLowerCase();
  const argsText = splitAt === -1 ? '' : raw.slice(splitAt).trim();
  const args = argsText ? argsText.split(/\s+/) : [];
  const guildConfig = getGuildConfig(message.guild.id);

  if (command === 'help' || command === 'commands') {
    const help = embed('🛡️ Ujwal Telugu FF Bot commands', 'Prefix commands are enabled as requested; slash commands are also available.', BLUE)
      .addFields(
        { name: 'Status and community', value: '`.stats` · `.ping` · `.help` · `.level [@user]` · `.leaderboard` · `.avatar [@user]` · `/poll`', inline: false },
        { name: 'Invite and server stats', value: '`.invites [@user]` · `.inviteleaderboard` · `.invites reset @user` (staff) · `.serverstats setup|refresh|status|remove` (Manage Channels)', inline: false },
        { name: 'Economy and games', value: '`.balance` · `.daily` · `.work` · `.beg` · `.deposit all` · `.withdraw all` · `.pay @user amount` · `.coinflip bet heads|tails` · `.slots bet` · `.topmoney` · `.truthordare truth|dare` · `.8ball question` · `.rps rock|paper|scissors` · `.tts text`', inline: false },
        { name: 'Moderation', value: '`.warn @user reason` · `.timeout @user 10m reason` · `.kick @user reason` · `.ban @user reason` · `.purge 10` · `.lock` · `.unlock` · `.slowmode seconds`', inline: false },
        { name: 'Anti-raid', value: '`.raidmode on|off|status` (requires Manage Server). Join waves trigger alerts and stricter content filtering.', inline: false },
        { name: 'Creator alerts', value: 'Configure with `/config youtube-add`, `/config instagram-add`, and `/config kick-add`. Instagram and Kick alerts require compatible HTTPS RSS/Atom feed URLs from a provider; profile links alone are not feeds.', inline: false },
        { name: 'Tickets and verification', value: 'Admins can post panels with `/ticket-panel` and `/verify-panel` after configuring `/config ticket-role`, `/config ticket-category`, or `/config verified-role`.', inline: false },
        { name: 'Setup', value: 'Use `/config` to set welcome/log/suggestion channels and protections. Use `/mod` for slash moderation actions.', inline: false }
      );
    return message.reply({ embeds: [help] }).catch(() => {});
  }

  if (command === 'ping') return message.reply(`🏓 Discord gateway ping: **${Math.round(client.ws.ping)} ms**`).catch(() => {});
  if (command === 'stats') return message.reply({ embeds: [botStatsEmbed()] }).catch(() => {});
  if (command === 'level') {
    const targetMatch = args[0]?.match(/^<@!?(\d+)>$/) || args[0]?.match(/^(\d{17,20})$/);
    const user = targetMatch ? await client.users.fetch(targetMatch[1]).catch(() => null) : message.author;
    if (!user) return message.reply('I could not find that user.').catch(() => {});
    const xp = memberXP(guildConfig, user.id);
    const level = levelForXP(xp);
    const currentLevelXP = level * level * 100;
    const nextLevelXP = (level + 1) * (level + 1) * 100;
    return message.reply({ embeds: [embed(`🏅 ${user.username}'s level`, `**Level:** ${level}\n**XP:** ${xp}\n**Progress:** ${xp - currentLevelXP} / ${nextLevelXP - currentLevelXP} XP to level ${level + 1}`, BLUE).setThumbnail(user.displayAvatarURL())] }).catch(() => {});
  }
  if (command === 'leaderboard' || command === 'levels') {
    const top = Object.entries(guildConfig.xp || {}).map(([userId, data]) => ({ userId, xp: memberXP(guildConfig, userId) }))
      .sort((a, b) => b.xp - a.xp).slice(0, 10);
    const lines = await Promise.all(top.map(async (entry, index) => {
      const user = await client.users.fetch(entry.userId).catch(() => null);
      return `**${index + 1}.** ${user ? user.username : `User ${entry.userId}`} — Level ${levelForXP(entry.xp)} (${entry.xp} XP)`;
    }));
    return message.reply({ embeds: [embed('🏆 Server activity leaderboard', lines.join('\n') || 'No XP recorded yet. Chat normally to earn XP (one award per minute).', BLUE)] }).catch(() => {});
  }
  if (command === 'balance' || command === 'bal') {
    const wallet = economyWallet(guildConfig, message.author.id);
    saveStore();
    return message.reply({ embeds: [embed(`🪙 ${message.author.username}'s wallet`, `**Pocket:** ${formatCoins(wallet.cash)}\n**Bank:** ${formatCoins(wallet.bank)}\n**Total:** ${formatCoins(wallet.cash + wallet.bank)}`, GREEN)] }).catch(() => {});
  }

  if (command === 'daily' || command === 'work' || command === 'beg') {
    const wallet = economyWallet(guildConfig, message.author.id);
    const now = Date.now();
    const settings = {
      daily: { key: 'dailyAt', cooldown: 24 * 60 * 60 * 1000, min: 120, max: 250, label: 'daily reward' },
      work: { key: 'workAt', cooldown: 30 * 60 * 1000, min: 35, max: 100, label: 'work shift' },
      beg: { key: 'begAt', cooldown: 60 * 1000, min: 0, max: 30, label: 'spare change' }
    }[command];
    const remaining = settings.cooldown - (now - wallet[settings.key]);
    if (remaining > 0) return message.reply(`⏳ You can claim ${settings.label} again in **${formatDuration(remaining)}**.`).catch(() => {});
    const amount = settings.min + Math.floor(Math.random() * (settings.max - settings.min + 1));
    wallet.cash += amount;
    wallet[settings.key] = now;
    saveStore();
    const lines = command === 'work' ? ['You helped at a shop', 'You finished a delivery', 'You edited a video', 'You helped a neighbor']
      : command === 'beg' ? ['Someone shared a few coins', 'A passerby gave you change', 'No one had spare coins this time']
      : ['Your daily reward is ready'];
    return message.reply(`${command === 'beg' && amount === 0 ? '🥲' : '💰'} ${lines[Math.floor(Math.random() * lines.length)]}. You received **${formatCoins(amount)}**.`).catch(() => {});
  }

  if (command === 'deposit' || command === 'withdraw') {
    const wallet = economyWallet(guildConfig, message.author.id);
    const source = command === 'deposit' ? 'cash' : 'bank';
    const destination = command === 'deposit' ? 'bank' : 'cash';
    const requested = String(args[0] || '').toLowerCase();
    const amount = requested === 'all' ? wallet[source] : Number(requested);
    if (!Number.isSafeInteger(amount) || amount < 1) return message.reply(`Usage: ".${command} <positive amount|all>"`).catch(() => {});
    if (amount > wallet[source]) return message.reply(`You only have **${formatCoins(wallet[source])}** in ${source}.`).catch(() => {});
    wallet[source] -= amount;
    wallet[destination] += amount;
    saveStore();
    return message.reply(`✅ Moved **${formatCoins(amount)}** from ${source} to ${destination}.`).catch(() => {});
  }

  if (command === 'pay') {
    const target = await memberTargetFromMessage(message, args[0]);
    const amount = Number(args[1]);
    if (!target) return message.reply('Usage: `.pay @member amount`').catch(() => {});
    if (target.id === message.author.id || target.user.bot) return message.reply('You can only pay another human member.').catch(() => {});
    if (!Number.isSafeInteger(amount) || amount < 1) return message.reply('Enter a positive whole-number amount.').catch(() => {});
    const senderWallet = economyWallet(guildConfig, message.author.id);
    const recipientWallet = economyWallet(guildConfig, target.id);
    if (amount > senderWallet.cash) return message.reply(`You only have **${formatCoins(senderWallet.cash)}** in your pocket.`).catch(() => {});
    senderWallet.cash -= amount;
    recipientWallet.cash += amount;
    saveStore();
    return message.reply(`💸 ${message.author} paid ${target} **${formatCoins(amount)}**.`).catch(() => {});
  }

  if (command === 'coinflip' || command === 'slots') {
    const amount = Number(args[0]);
    if (!Number.isSafeInteger(amount) || amount < 1) return message.reply(`Usage: ".${command} <bet>"`).catch(() => {});
    const wallet = economyWallet(guildConfig, message.author.id);
    if (amount > wallet.cash) return message.reply(`Your pocket balance is **${formatCoins(wallet.cash)}**.`).catch(() => {});
    if (command === 'coinflip') {
      const guess = String(args[1] || 'heads').toLowerCase();
      if (!['heads', 'tails'].includes(guess)) return message.reply('Choose `.coinflip <bet> heads` or `tails`.').catch(() => {});
      const result = Math.random() < 0.5 ? 'heads' : 'tails';
      if (guess === result) {
        wallet.cash += amount;
        saveStore();
        return message.reply(`🪙 It landed **${result}**. You won **${formatCoins(amount)}**!`).catch(() => {});
      }
      wallet.cash -= amount;
      saveStore();
      return message.reply(`🪙 It landed **${result}**. You lost **${formatCoins(amount)}**.`).catch(() => {});
    }
    const symbols = ['🍒', '🍋', '🍇', '⭐', '🔔', '💎'];
    const reels = Array.from({ length: 3 }, () => symbols[Math.floor(Math.random() * symbols.length)]);
    const matches = reels[0] === reels[1] && reels[1] === reels[2] ? 3 : new Set(reels).size < 3 ? 2 : 0;
    wallet.cash -= amount;
    const payout = matches === 3 ? amount * 5 : matches === 2 ? Math.floor(amount * 1.5) : 0;
    wallet.cash += payout;
    saveStore();
    return message.reply(`🎰 **[ ${reels.join(' | ')} ]**\n${payout ? `Payout: **${formatCoins(payout)}**` : `No match — you lost **${formatCoins(amount)}**.`}`).catch(() => {});
  }

  if (command === 'topmoney') {
    const top = Object.entries(guildConfig.economy || {}).map(([userId, data]) => ({ userId, total: Math.max(0, Number(data?.cash) || 0) + Math.max(0, Number(data?.bank) || 0) }))
      .sort((a, b) => b.total - a.total).slice(0, 10);
    const lines = await Promise.all(top.map(async (item, i) => {
      const user = await client.users.fetch(item.userId).catch(() => null);
      return `**${i + 1}.** ${user?.username || `User ${item.userId}`} — ${formatCoins(item.total)}`;
    }));
    return message.reply({ embeds: [embed('🏆 Richest members', lines.join('\n') || 'No wallets yet. Try `.daily` to get started.', GREEN)] }).catch(() => {});
  }

  if (command === 'inviteleaderboard' || command === 'invitetop') {
    const top = Object.entries(guildConfig.inviteStats || {}).map(([userId, data]) => ({
      userId,
      joins: Math.max(0, Number(data?.joins) || 0),
      leaves: Math.max(0, Number(data?.leaves) || 0)
    })).sort((a, b) => b.joins - a.joins).slice(0, 10);
    const lines = await Promise.all(top.map(async (entry, index) => {
      const user = await client.users.fetch(entry.userId).catch(() => null);
      return `**${index + 1}.** ${user?.username || `User ${entry.userId}`} — ${entry.joins} joins, ${entry.leaves} leaves`;
    }));
    return message.reply({ embeds: [embed('🏆 Invite leaderboard', lines.join('\n') || 'No tracked invitations yet. The bot needs Manage Server to compare invite usage.', BLUE)] }).catch(() => {});
  }

  if (command === 'invites') {
    if (String(args[0] || '').toLowerCase() === 'reset') {
      if (!(await requirePermission(message, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
      const target = await memberTargetFromMessage(message, args[1]);
      if (!target) return message.reply('Usage: `.invites reset @member`').catch(() => {});
      guildConfig.inviteStats[target.id] = { joins: 0, leaves: 0 };
      for (const [memberId, inviterId] of Object.entries(guildConfig.invitedByMember)) if (inviterId === target.id) delete guildConfig.invitedByMember[memberId];
      saveStore();
      return message.reply(`✅ Reset invite statistics for ${target}.`).catch(() => {});
    }
    const target = args[0] ? await memberTargetFromMessage(message, args[0]) : message.member;
    if (!target) return message.reply('Usage: `.invites [@member]` or `.invites reset @member`').catch(() => {});
    const stats = guildConfig.inviteStats[target.id] || { joins: 0, leaves: 0 };
    const active = Math.max(0, Number(stats.joins || 0) - Number(stats.leaves || 0));
    return message.reply({ embeds: [embed(`📨 Invite stats: ${target.user.username}`, `**Tracked joins:** ${stats.joins || 0}\n**Tracked leaves:** ${stats.leaves || 0}\n**Estimated active invites:** ${active}\n\nInvite attribution requires the bot's **Manage Server** permission and a fetchable invite.`, BLUE)] }).catch(() => {});
  }

  if (command === 'serverstats') {
    const sub = String(args[0] || 'status').toLowerCase();
    if (!(await requirePermission(message, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;
    const stats = guildConfig.serverStatsChannels || {};
    if (sub === 'status') {
      return message.reply(`📊 Server stats: ${stats.categoryId ? `configured under <#${stats.categoryId}>` : 'not configured'}. Use ".serverstats setup" to create counters.`).catch(() => {});
    }
    if (sub === 'setup') {
      if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.ManageChannels)) return message.reply('I need Manage Channels permission.').catch(() => {});
      try {
        const category = await message.guild.channels.create({ name: '📊 SERVER STATS', type: ChannelType.GuildCategory, reason: `Server stats setup by ${message.author.tag}` });
        const everyone = message.guild.roles.everyone.id;
        const shared = { type: ChannelType.GuildVoice, parent: category.id, permissionOverwrites: [{ id: everyone, deny: [PermissionFlagsBits.Connect, PermissionFlagsBits.Speak] }], reason: 'Read-only server-stat counter' };
        const members = await message.guild.channels.create({ ...shared, name: `👥 Members: ${message.guild.memberCount || 0}` });
        const boosts = await message.guild.channels.create({ ...shared, name: `💎 Boosts: ${message.guild.premiumSubscriptionCount || 0}` });
        const channels = await message.guild.channels.create({ ...shared, name: `📚 Channels: ${message.guild.channels.cache.size}` });
        guildConfig.serverStatsChannels = { categoryId: category.id, membersChannelId: members.id, boostsChannelId: boosts.id, channelsChannelId: channels.id };
        saveStore();
        return message.reply(`✅ Created server-stat counters under <#${category.id}>. Names refresh automatically every few minutes after server activity.`).catch(() => {});
      } catch (error) {
        console.error('Server stats setup failed:', error);
        return message.reply('I could not create the server-stat channels. Check Manage Channels permission and channel limits.').catch(() => {});
      }
    }
    if (sub === 'refresh') {
      await refreshServerStats(message.guild);
      return message.reply('✅ Requested a server-stat counter refresh.').catch(() => {});
    }
    if (sub === 'remove') {
      for (const id of [stats.membersChannelId, stats.boostsChannelId, stats.channelsChannelId, stats.categoryId].filter(Boolean)) {
        const channel = message.guild.channels.cache.get(id) || await message.guild.channels.fetch(id).catch(() => null);
        if (channel) await channel.delete('Removing bot-managed server-stat counters').catch(() => {});
      }
      guildConfig.serverStatsChannels = { categoryId: null, membersChannelId: null, boostsChannelId: null, channelsChannelId: null };
      saveStore();
      return message.reply('✅ Removed configured server-stat counters.').catch(() => {});
    }
    return message.reply('Usage: `.serverstats setup|refresh|status|remove`').catch(() => {});
  }

  if (command === 'truthordare') {
    const choice = String(args[0] || '').toLowerCase();
    const truths = ['What is one skill you want to learn this year?', 'What is your funniest gaming moment?', 'What is one small thing that always improves your day?', 'What is a harmless habit your friends tease you about?', 'Which game could you play for hours?'];
    const dares = ['Speak like a game commentator for your next three messages.', 'Send a friendly compliment to someone in the server.', 'Describe your favourite game using only three emojis.', 'Use a silly nickname for yourself for five minutes.', 'Share a harmless fun fact about yourself.'];
    if (!['truth', 'dare'].includes(choice)) return message.reply('Usage: `.truthordare truth` or `.truthordare dare`').catch(() => {});
    const bank = choice === 'truth' ? truths : dares;
    return message.reply(`🎲 **${choice.toUpperCase()}**\n${bank[Math.floor(Math.random() * bank.length)]}`).catch(() => {});
  }

  if (command === '8ball') {
    if (!argsText) return message.reply('Ask a question: `.8ball will our squad win?`').catch(() => {});
    const answers = ['Absolutely!', 'Looks promising.', 'Probably.', 'The signs are mixed.', 'Try again later.', 'I would not count on it.', 'It is possible.', 'Definitely not today.'];
    return message.reply(`🎱 ${answers[Math.floor(Math.random() * answers.length)]}`).catch(() => {});
  }

  if (command === 'rps') {
    const choice = String(args[0] || '').toLowerCase();
    if (!['rock', 'paper', 'scissors'].includes(choice)) return message.reply('Usage: `.rps rock|paper|scissors`').catch(() => {});
    const botChoice = ['rock', 'paper', 'scissors'][Math.floor(Math.random() * 3)];
    const outcome = choice === botChoice ? 'It is a draw.' : ({ rock: 'scissors', paper: 'rock', scissors: 'paper' }[choice] === botChoice ? 'You win!' : 'I win!');
    return message.reply(`🪨📄✂️ You chose **${choice}**; I chose **${botChoice}**. ${outcome}`).catch(() => {});
  }

  if (command === 'tts') {
    const textToSpeak = truncate(argsText, 450).replace(/@everyone|@here/g, '[mention]');
    if (!textToSpeak) return message.reply('Usage: `.tts <short message>`').catch(() => {});
    if (!message.guild.members.me?.permissions.has(PermissionFlagsBits.SendTTSMessages)) return message.reply('I need the **Send Text-to-Speech Messages** permission in this channel.').catch(() => {});
    await message.channel.send({ content: `${message.author.username} says: ${textToSpeak}`, tts: true, allowedMentions: { parse: [] } }).catch(() => {});
    return;
  }

  if (command === 'avatar') {
    const targetMatch = args[0]?.match(/^<@!?(\d+)>$/) || args[0]?.match(/^(\d{17,20})$/);
    const user = targetMatch ? await client.users.fetch(targetMatch[1]).catch(() => null) : message.author;
    if (!user) return message.reply('I could not find that user.').catch(() => {});
    return message.reply({ embeds: [embed(`Avatar: ${user.username}`, user.displayAvatarURL({ size: 1024 }), BLUE).setImage(user.displayAvatarURL({ size: 1024 }))] }).catch(() => {});
  }

  if (command === 'raidmode') {
    if (!(await requirePermission(message, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
    const mode = (args[0] || '').toLowerCase();
    if (!['on', 'off', 'status'].includes(mode)) return message.reply('Usage: `.raidmode on|off|status`').catch(() => {});
    if (mode === 'status') return message.reply(`Raid mode is currently **${guildConfig.raidMode ? 'ON' : 'OFF'}**.`).catch(() => {});
    guildConfig.raidMode = mode === 'on';
    saveStore();
    await logToGuild(message.guild, 'Raid mode updated', `${message.author.tag} set raid mode to **${mode.toUpperCase()}**.`, mode === 'on' ? ORANGE : GREEN);
    return message.reply(`🛡️ Raid mode **${mode.toUpperCase()}**.`).catch(() => {});
  }

  if (command === 'purge') {
    if (!(await requirePermission(message, PermissionFlagsBits.ManageMessages, 'Manage Messages'))) return;
    const amount = Number(args[0]);
    if (!Number.isInteger(amount) || amount < 1 || amount > 99) return message.reply('Usage: `.purge 1-99` (the command message also counts toward Discord’s bulk-delete limit).').catch(() => {});
    try {
      const deleted = await message.channel.bulkDelete(amount + 1, true);
      const reply = await message.channel.send(`🧹 Deleted ${Math.max(0, deleted.size - 1)} message(s).`);
      setTimeout(() => reply.delete().catch(() => {}), 5000);
      await logToGuild(message.guild, 'Messages purged', `${message.author.tag} purged up to ${amount} messages in <#${message.channel.id}>.`, ORANGE);
    } catch {
      await message.reply('I could not bulk-delete those messages. Discord does not allow bulk deletion of messages older than 14 days.').catch(() => {});
    }
    return;
  }

  if (command === 'lock' || command === 'unlock') {
    if (!(await requirePermission(message, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;
    const everyone = message.guild.roles.everyone;
    const deny = command === 'lock';
    await message.channel.permissionOverwrites.edit(everyone, { SendMessages: deny ? false : null }, { reason: `${command} by ${message.author.tag}` })
      .then(() => message.reply(deny ? '🔒 Channel locked for @everyone.' : '🔓 Channel unlocked for @everyone.'))
      .catch(() => message.reply('I could not change this channel’s permissions. Check Manage Channels permission.'));
    await logToGuild(message.guild, `Channel ${command}ed`, `${message.author.tag} ${command}ed <#${message.channel.id}>.`, ORANGE);
    return;
  }

  if (command === 'slowmode') {
    if (!(await requirePermission(message, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;
    const seconds = Number(args[0]);
    if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) return message.reply('Usage: `.slowmode 0-21600` seconds.').catch(() => {});
    await message.channel.setRateLimitPerUser(seconds, `Requested by ${message.author.tag}`)
      .then(() => message.reply(`🐢 Slowmode set to **${seconds}s**.`))
      .catch(() => message.reply('Could not set slowmode; check channel permissions.'));
    return;
  }

  if (['warn', 'timeout', 'kick', 'ban'].includes(command)) {
    const permission = {
      warn: PermissionFlagsBits.ModerateMembers,
      timeout: PermissionFlagsBits.ModerateMembers,
      kick: PermissionFlagsBits.KickMembers,
      ban: PermissionFlagsBits.BanMembers
    }[command];
    const name = { warn: 'Timeout Members (or Administrator)', timeout: 'Timeout Members', kick: 'Kick Members', ban: 'Ban Members' }[command];
    if (!(await requirePermission(message, permission, name))) return;
    const mentionToken = args.shift();
    const target = await memberTargetFromMessage(message, mentionToken);
    if (!target) return message.reply(`Usage: ".${command} @member reason"`).catch(() => {});
    if (target.id === message.author.id) return message.reply('You cannot run this action on yourself.').catch(() => {});
    if (target.id === client.user.id) return message.reply('I cannot moderate myself.').catch(() => {});
    if (target.roles.highest.position >= message.member.roles.highest.position && message.guild.ownerId !== message.author.id) {
      return message.reply('Your highest role must be above the target member’s highest role.').catch(() => {});
    }
    const reason = args.join(' ') || 'No reason provided';
    if (command === 'warn') {
      guildConfig.warnings[target.id] ||= [];
      guildConfig.warnings[target.id].push({ reason, moderatorId: message.author.id, at: new Date().toISOString() });
      saveStore();
      await logToGuild(message.guild, 'Member warned', `Member: ${target.user.tag}\nModerator: ${message.author.tag}\nReason: ${truncate(reason, 700)}`, ORANGE);
      return message.reply(`⚠️ Recorded a warning for **${target.user.tag}**.`).catch(() => {});
    }
    try {
      if (command === 'timeout') {
        // Format: .timeout @user 10m reason
        const durationToken = args.shift();
        const ms = parseDuration(durationToken);
        if (!ms) return message.reply('Usage: `.timeout @member 10m reason` — units: s, m, h or d (maximum 28 days).').catch(() => {});
        const finalReason = args.join(' ') || 'No reason provided';
        markModerationAction(message.guild.id, target.id);
        await target.timeout(ms, `${message.author.tag}: ${finalReason}`);
        await logToGuild(message.guild, 'Member timed out', `Member: ${target.user.tag}\nModerator: ${message.author.tag}\nDuration: ${durationToken}\nReason: ${truncate(finalReason, 700)}`, ORANGE);
        return message.reply(`⏱️ Timed out **${target.user.tag}** for ${durationToken}.`).catch(() => {});
      }
      if (command === 'kick') {
        markModerationAction(message.guild.id, target.id);
        await target.kick(`${message.author.tag}: ${reason}`);
        await logToGuild(message.guild, 'Member kicked', `Member: ${target.user.tag}\nModerator: ${message.author.tag}\nReason: ${truncate(reason, 700)}`, RED);
        return message.reply(`👢 Kicked **${target.user.tag}**.`).catch(() => {});
      }
      if (command === 'ban') {
        markModerationAction(message.guild.id, target.id);
        await target.ban({ reason: `${message.author.tag}: ${reason}`, deleteMessageSeconds: 0 });
        await logToGuild(message.guild, 'Member banned', `Member: ${target.user.tag}\nModerator: ${message.author.tag}\nReason: ${truncate(reason, 700)}`, RED);
        return message.reply(`🔨 Banned **${target.user.tag}**.`).catch(() => {});
      }
    } catch (error) {
      console.error(`${command} failed:`, error);
      return message.reply('That moderation action failed. Check role hierarchy and bot permissions.').catch(() => {});
    }
  }
}

client.on(Events.ClientReady, async (readyClient) => {
  console.log(`✅ ${readyClient.user.tag} is online (${client.guilds.cache.size} guilds).`);
  // Presence text stays simple to avoid decorative status spam.
  readyClient.user.setPresence({ activities: [{ name: `${PREFIX}help | Ujwal Telugu FF Bot` }], status: 'online' });
  setTimeout(() => {
    pollYouTubeFeeds().catch((error) => console.error('Initial YouTube poll error:', error));
    pollInstagramFeeds().catch((error) => console.error('Initial Instagram poll error:', error));
    pollKickFeeds().catch((error) => console.error('Initial Kick feed poll error:', error));
    for (const guild of readyClient.guilds.cache.values()) {
      warmInviteCache(guild).catch(() => {});
      refreshServerStats(guild).catch(() => {});
    }
  }, 5000).unref?.();
});

client.on(Events.InviteCreate, (invite) => {
  const snapshot = inviteSnapshots.get(invite.guild?.id);
  if (snapshot && invite.code) snapshot.set(invite.code, Number(invite.uses || 0));
});
client.on(Events.InviteDelete, (invite) => {
  const snapshot = inviteSnapshots.get(invite.guild?.id);
  if (snapshot && invite.code) snapshot.delete(invite.code);
});

async function handleButtonInteraction(interaction) {
  if (!interaction.inGuild()) {
    await interaction.reply({ content: 'This button only works inside a server.', ephemeral: true }).catch(() => {});
    return;
  }

  if (interaction.customId === 'ticket:create') {
    const config = getGuildConfig(interaction.guildId);
    const existing = interaction.guild.channels.cache.find((channel) => channel.type === ChannelType.GuildText && channel.topic === `ticket-owner:${interaction.user.id}`);
    if (existing) {
      await interaction.reply({ content: `You already have an open ticket: ${existing}`, ephemeral: true });
      return;
    }
    const botMember = interaction.guild.members.me;
    if (!botMember?.permissions.has(PermissionFlagsBits.ManageChannels)) {
      await interaction.reply({ content: 'I need Manage Channels permission to create a private ticket.', ephemeral: true });
      return;
    }
    const overwrites = [
      { id: interaction.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
      { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels] }
    ];
    if (config.ticketSupportRoleId && interaction.guild.roles.cache.has(config.ticketSupportRoleId)) {
      overwrites.push({ id: config.ticketSupportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }
    // Explicitly allow staff roles to see the ticket; Manage Channels alone does not override an everyone-deny overwrite.
    const staffRoles = [...interaction.guild.roles.cache.filter((role) =>
      role.id !== interaction.guild.roles.everyone.id &&
      (role.permissions.has(PermissionFlagsBits.Administrator) || role.permissions.has(PermissionFlagsBits.ManageChannels)) &&
      role.id !== config.ticketSupportRoleId
    ).values()].slice(0, 90); // Stay below Discord's per-channel overwrite limit.
    for (const role of staffRoles) {
      overwrites.push({ id: role.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }
    const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, 35) || 'member';
    const channelOptions = {
      name: `ticket-${safeName}`.slice(0, 90),
      type: ChannelType.GuildText,
      topic: `ticket-owner:${interaction.user.id}`,
      permissionOverwrites: overwrites,
      reason: `Support ticket opened by ${interaction.user.tag}`
    };
    if (config.ticketCategoryId && interaction.guild.channels.cache.get(config.ticketCategoryId)?.type === ChannelType.GuildCategory) {
      channelOptions.parent = config.ticketCategoryId;
    }
    const ticket = await interaction.guild.channels.create(channelOptions);
    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket:close').setLabel('Close ticket').setStyle(ButtonStyle.Danger).setEmoji('🔒')
    );
    await ticket.send({
      content: `${interaction.user} welcome to your private support ticket. Please describe what you need help with.`,
      embeds: [embed('🎫 Support ticket opened', 'A staff member will help you as soon as possible. Please keep messages relevant and do not share passwords or private tokens.', BLUE)],
      components: [closeRow],
      allowedMentions: { users: [interaction.user.id] }
    });
    await logToGuild(interaction.guild, 'Support ticket opened', `Member: ${interaction.user.tag}
Channel: ${ticket}`, GREEN);
    await interaction.reply({ content: `Your private ticket has been created: ${ticket}`, ephemeral: true });
    return;
  }

  if (interaction.customId === 'ticket:close') {
    const channel = interaction.channel;
    const match = String(channel?.topic || '').match(/^ticket-owner:(\d+)$/);
    if (!channel || channel.type !== ChannelType.GuildText || !match) {
      await interaction.reply({ content: 'This does not look like a ticket channel.', ephemeral: true });
      return;
    }
    const config = getGuildConfig(interaction.guildId);
    const clickingMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    const isOwner = match[1] === interaction.user.id;
    const isSupport = Boolean(config.ticketSupportRoleId && clickingMember?.roles.cache.has(config.ticketSupportRoleId));
    const canManage = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels) || interaction.memberPermissions?.has(PermissionFlagsBits.Administrator);
    if (!isOwner && !isSupport && !canManage) {
      await interaction.reply({ content: 'Only the ticket opener, configured support team, or server staff can close this ticket.', ephemeral: true });
      return;
    }
    await interaction.reply({ content: '🔒 Ticket closing in 5 seconds…' });
    await logToGuild(interaction.guild, 'Support ticket closed', `Channel: #${channel.name}
Closed by: ${interaction.user.tag}`, ORANGE);
    setTimeout(() => channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(() => {}), 5000).unref?.();
    return;
  }

  if (interaction.customId === 'verify:member') {
    const config = getGuildConfig(interaction.guildId);
    if (!config.verifiedRoleId) {
      await interaction.reply({ content: 'Verification is not configured yet. Ask a server administrator to run `/config verified-role`.', ephemeral: true });
      return;
    }
    const role = interaction.guild.roles.cache.get(config.verifiedRoleId) || await interaction.guild.roles.fetch(config.verifiedRoleId).catch(() => null);
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!role || !member) {
      await interaction.reply({ content: 'The verification role or member could not be found. Ask a server administrator to check the configuration.', ephemeral: true });
      return;
    }
    if (member.roles.cache.has(role.id)) {
      await interaction.reply({ content: '✅ You are already verified.', ephemeral: true });
      return;
    }
    if (!interaction.guild.members.me?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= interaction.guild.members.me.roles.highest.position || role.managed) {
      await interaction.reply({ content: 'I cannot assign the configured verification role. Check Manage Roles permission and move my bot role above it.', ephemeral: true });
      return;
    }
    await member.roles.add(role, 'Self-serve verification button');
    await logToGuild(interaction.guild, 'Member verified', `${interaction.user.tag} received the configured verified role.`, GREEN);
    await interaction.reply({ content: '✅ Verification complete. Welcome!', ephemeral: true });
    return;
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  const commandName = interaction.isChatInputCommand() ? interaction.commandName : 'component';
  try {
    if (interaction.isButton()) {
      await handleButtonInteraction(interaction);
      return;
    }
    if (!interaction.isChatInputCommand()) return;
    if (commandName === 'ping') {
      return interaction.reply({ content: `🏓 Pong — ${Math.round(client.ws.ping)} ms`, ephemeral: true });
    }
    if (commandName === 'stats') {
      return interaction.reply({ embeds: [botStatsEmbed()], ephemeral: true });
    }
    if (commandName === 'help') {
      return interaction.reply({ embeds: [embed('🛡️ Ujwal Telugu FF All-in-One', `Prefix: \`${PREFIX}\`\nSecurity: \`.raidmode on|off\`, \`.warn\`, \`.kick\`, \`.ban\`, \`.purge\`\nCommunity: \`.level\`, \`.leaderboard\`, \`.invites\`, \`.serverstats setup\`\nEconomy: \`.daily\`, \`.work\`, \`.balance\`, \`.pay\`, \`.coinflip\`, \`.slots\`\nFun: \`.truthordare\`, \`.8ball\`, \`.rps\`, \`.tts\`\nAlerts: configure YouTube, Instagram and Kick feeds with the config commands.\nSystem: \`.stats\``, BLUE)], ephemeral: true });
    }
    if (commandName === 'serverinfo') {
      const guild = interaction.guild;
      return interaction.reply({ embeds: [embed(`${guild.name}`, `Owner: <@${guild.ownerId}>\nMembers: ${guild.memberCount}\nCreated: <t:${Math.floor(guild.createdTimestamp / 1000)}:D>\nChannels: ${guild.channels.cache.size}`, BLUE)], ephemeral: true });
    }
    if (commandName === 'userinfo') {
      const user = interaction.options.getUser('user') || interaction.user;
      const member = await interaction.guild.members.fetch(user.id).catch(() => null);
      return interaction.reply({ embeds: [embed(`User info: ${user.tag}`, `ID: \`${user.id}\`\nAccount created: <t:${Math.floor(user.createdTimestamp / 1000)}:R>\nJoined server: ${member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` : 'Unknown'}`, BLUE).setThumbnail(user.displayAvatarURL())], ephemeral: true });
    }
    if (commandName === 'level') {
      const config = getGuildConfig(interaction.guildId);
      const user = interaction.options.getUser('user') || interaction.user;
      const xp = memberXP(config, user.id);
      const level = levelForXP(xp);
      const currentLevelXP = level * level * 100;
      const nextLevelXP = (level + 1) * (level + 1) * 100;
      return interaction.reply({ embeds: [embed(`🏅 ${user.username}'s level`, `**Level:** ${level}\n**XP:** ${xp}\n**Progress:** ${xp - currentLevelXP} / ${nextLevelXP - currentLevelXP} XP to level ${level + 1}`, BLUE).setThumbnail(user.displayAvatarURL())], ephemeral: true });
    }
    if (commandName === 'leaderboard') {
      const config = getGuildConfig(interaction.guildId);
      const top = Object.entries(config.xp || {}).map(([userId, data]) => ({ userId, xp: memberXP(config, userId) }))
        .sort((a, b) => b.xp - a.xp).slice(0, 10);
      const lines = await Promise.all(top.map(async (entry, index) => {
        const user = await client.users.fetch(entry.userId).catch(() => null);
        return `**${index + 1}.** ${user ? user.username : `User ${entry.userId}`} — Level ${levelForXP(entry.xp)} (${entry.xp} XP)`;
      }));
      return interaction.reply({ embeds: [embed('🏆 Server activity leaderboard', lines.join('\n') || 'No XP recorded yet. Chat normally to earn XP (one award per minute).', BLUE)], ephemeral: true });
    }
    if (commandName === 'poll') {
      const question = interaction.options.getString('question', true);
      const options = [1, 2, 3, 4].map((number) => interaction.options.getString(`option${number}`)).filter(Boolean);
      const numberEmojis = ['1️⃣', '2️⃣', '3️⃣', '4️⃣'];
      const description = options.map((option, index) => `${numberEmojis[index]} ${option}`).join('\n');
      const posted = await interaction.channel.send({ embeds: [embed(`📊 ${question}`, description, BLUE).setFooter({ text: `Poll by ${interaction.user.tag}` })], allowedMentions: { parse: [] } });
      for (let index = 0; index < options.length; index += 1) await posted.react(numberEmojis[index]).catch(() => {});
      return interaction.reply({ content: `Poll created in <#${interaction.channelId}>.`, ephemeral: true });
    }
    if (commandName === 'ticket-panel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'You need Manage Server permission to create a ticket panel.', ephemeral: true });
      }
      const channel = interaction.options.getChannel('channel', true);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket:create').setLabel('Open a ticket').setStyle(ButtonStyle.Primary).setEmoji('🎫')
      );
      await channel.send({ embeds: [embed('🎫 Need help?', 'Press the button below to open a private support ticket. Only you, the configured support team, and server staff can see it.', BLUE)], components: [row] });
      return interaction.reply({ content: `Ticket panel posted in ${channel}. Configure /config ticket-role and /config ticket-category if needed.`, ephemeral: true });
    }
    if (commandName === 'verify-panel') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'You need Manage Server permission to create a verification panel.', ephemeral: true });
      }
      const config = getGuildConfig(interaction.guildId);
      if (!config.verifiedRoleId) return interaction.reply({ content: 'First configure a role with `/config verified-role`.', ephemeral: true });
      const channel = interaction.options.getChannel('channel', true);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('verify:member').setLabel('Verify me').setStyle(ButtonStyle.Success).setEmoji('✅')
      );
      await channel.send({ embeds: [embed('✅ Member verification', 'Press the button below to receive the configured verified-member role.', GREEN)], components: [row] });
      return interaction.reply({ content: `Verification panel posted in ${channel}.`, ephemeral: true });
    }
    if (commandName === 'role') {
      const sub = interaction.options.getSubcommand();
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageRoles) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'You need Manage Roles permission.', ephemeral: true });
      }
      const user = interaction.options.getUser('user', true);
      const role = interaction.options.getRole('role', true);
      const target = await interaction.guild.members.fetch(user.id).catch(() => null);
      const actor = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const botMember = interaction.guild.members.me;
      if (!target) return interaction.reply({ content: 'That member is not in this server.', ephemeral: true });
      if (!actor) return interaction.reply({ content: 'I could not verify your member record.', ephemeral: true });
      if (role.managed || role.id === interaction.guild.roles.everyone.id) return interaction.reply({ content: 'That role cannot be assigned manually.', ephemeral: true });
      if (!botMember?.permissions.has(PermissionFlagsBits.ManageRoles) || role.position >= botMember.roles.highest.position) return interaction.reply({ content: 'Move the bot role above the target role and grant Manage Roles.', ephemeral: true });
      if (role.position >= actor.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) return interaction.reply({ content: 'Your highest role must be above the target role.', ephemeral: true });
      if (target.id !== interaction.user.id && target.roles.highest.position >= actor.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) return interaction.reply({ content: 'Your highest role must be above the target member.', ephemeral: true });
      if (sub === 'add') await target.roles.add(role, `Requested by ${interaction.user.tag}`);
      else await target.roles.remove(role, `Requested by ${interaction.user.tag}`);
      await logToGuild(interaction.guild, `Role ${sub === 'add' ? 'added' : 'removed'}`, `Role: ${role.name}\nMember: ${target.user.tag}\nModerator: ${interaction.user.tag}`, BLUE);
      return interaction.reply({ content: `✅ ${sub === 'add' ? 'Added' : 'Removed'} **${role.name}** ${sub === 'add' ? 'to' : 'from'} ${target}.`, ephemeral: true });
    }
    if (commandName === 'suggest') {
      const config = getGuildConfig(interaction.guildId);
      if (!config.suggestionsChannelId) return interaction.reply({ content: 'Suggestions are not configured yet. Ask a server administrator to use `/config suggestions`.', ephemeral: true });
      const channel = interaction.guild.channels.cache.get(config.suggestionsChannelId) || await interaction.guild.channels.fetch(config.suggestionsChannelId).catch(() => null);
      if (!channel?.isTextBased?.()) return interaction.reply({ content: 'The configured suggestions channel is unavailable. Ask an administrator to reconfigure it.', ephemeral: true });
      const title = interaction.options.getString('title', true);
      const details = interaction.options.getString('details', true);
      const suggestion = embed(`💡 ${title}`, details, BLUE).setFooter({ text: `Suggested by ${interaction.user.tag}` });
      const posted = await channel.send({ embeds: [suggestion], allowedMentions: { parse: [] } });
      await posted.react('👍').catch(() => {});
      await posted.react('👎').catch(() => {});
      return interaction.reply({ content: `Suggestion posted in <#${channel.id}>.`, ephemeral: true });
    }
    if (commandName === 'raidmode') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'You need Manage Server permission.', ephemeral: true });
      }
      const config = getGuildConfig(interaction.guildId);
      config.raidMode = interaction.options.getBoolean('enabled', true);
      saveStore();
      await logToGuild(interaction.guild, 'Raid mode updated', `${interaction.user.tag} set raid mode to **${config.raidMode ? 'ON' : 'OFF'}**.`, config.raidMode ? ORANGE : GREEN);
      return interaction.reply({ content: `🛡️ Raid mode is now **${config.raidMode ? 'ON' : 'OFF'}**.`, ephemeral: true });
    }
    if (commandName === 'config') {
      if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: 'You need Manage Server permission to change bot configuration.', ephemeral: true });
      }
      const config = getGuildConfig(interaction.guildId);
      const sub = interaction.options.getSubcommand();
      if (sub === 'welcome') config.welcomeChannelId = interaction.options.getChannel('channel', true).id;
      if (sub === 'logs') config.modLogChannelId = interaction.options.getChannel('channel', true).id;
      if (sub === 'log-channel') {
        const category = interaction.options.getString('category', true);
        config.logChannels ||= { join: null, members: null, messages: null, server: null, voice: null, roles: null, moderation: null };
        config.logChannels[category] = interaction.options.getChannel('channel', true).id;
      }
      if (sub === 'suggestions') config.suggestionsChannelId = interaction.options.getChannel('channel', true).id;
      if (sub === 'autorole') {
        const role = interaction.options.getRole('role', true);
        const botMember = interaction.guild.members.me;
        if (role.id === interaction.guild.roles.everyone.id || role.managed || !botMember || role.position >= botMember.roles.highest.position) {
          return interaction.reply({ content: 'Choose a normal role below the bot role; @everyone and managed roles cannot be used as autoroles.', ephemeral: true });
        }
        config.autoRoleId = role.id;
      }
      if (sub === 'raid-alerts') config.raidAlerts = interaction.options.getBoolean('enabled', true);
      if (sub === 'anti-invites') config.antiInvites = interaction.options.getBoolean('enabled', true);
      if (sub === 'anti-spam') config.antiSpam = interaction.options.getBoolean('enabled', true);
      if (sub === 'anti-mentions') config.antiMentionSpam = interaction.options.getBoolean('enabled', true);
      if (sub === 'ticket-role') {
        const role = interaction.options.getRole('role', true);
        if (role.id === interaction.guild.roles.everyone.id) return interaction.reply({ content: '@everyone cannot be the ticket support role because it would make tickets public.', ephemeral: true });
        config.ticketSupportRoleId = role.id;
      }
      if (sub === 'ticket-category') config.ticketCategoryId = interaction.options.getChannel('category', true).id;
      if (sub === 'verified-role') {
        const role = interaction.options.getRole('role', true);
        const botMember = interaction.guild.members.me;
        if (role.id === interaction.guild.roles.everyone.id || role.managed || !botMember || role.position >= botMember.roles.highest.position) {
          return interaction.reply({ content: 'Choose a normal verified role below the bot role; @everyone and managed roles cannot be assigned.', ephemeral: true });
        }
        config.verifiedRoleId = role.id;
      }
      if (sub === 'youtube-add') {
        const channelId = interaction.options.getString('channel_id', true).trim();
        const destination = interaction.options.getChannel('channel', true);
        const mentionRole = interaction.options.getRole('mention_role');
        if (!validYouTubeChannelId(channelId)) return interaction.reply({ content: 'That does not look like a YouTube channel ID. It should begin with `UC` and be about 24 characters long.', ephemeral: true });
        const existing = config.youtubeFeeds.find((feed) => feed.channelId === channelId);
        if (existing) {
          existing.destinationChannelId = destination.id;
          existing.roleId = mentionRole?.id || null;
        } else {
          config.youtubeFeeds.push({ channelId, destinationChannelId: destination.id, roleId: mentionRole?.id || null, lastVideoId: null });
        }
      }
      if (sub === 'youtube-remove') {
        const channelId = interaction.options.getString('channel_id', true).trim();
        config.youtubeFeeds = config.youtubeFeeds.filter((feed) => feed.channelId !== channelId);
      }
      if (sub === 'youtube-list') {
        const entries = config.youtubeFeeds.map((feed) => `• \`${feed.channelId}\` → <#${feed.destinationChannelId}>${feed.roleId ? ` (mentions <@&${feed.roleId}>)` : ''}`);
        return interaction.reply({ content: entries.length ? entries.join('\n') : 'No YouTube feeds configured.', ephemeral: true });
      }
      if (sub === 'instagram-add') {
        const username = interaction.options.getString('username', true).replace(/^@/, '').trim();
        const feedUrl = interaction.options.getString('feed_url', true).trim();
        const destination = interaction.options.getChannel('channel', true);
        const mentionRole = interaction.options.getRole('mention_role');
        if (!validInstagramUsername(username)) return interaction.reply({ content: 'That username contains unsupported characters. Enter the Instagram username without @.', ephemeral: true });
        if (!safeFeedUrl(feedUrl)) return interaction.reply({ content: 'The feed URL must be a public HTTPS RSS/Atom URL. An Instagram profile URL alone is not a feed.', ephemeral: true });
        const existing = config.instagramFeeds.find((feed) => feed.username.toLowerCase() === username.toLowerCase());
        if (existing) {
          existing.feedUrl = feedUrl;
          existing.destinationChannelId = destination.id;
          existing.roleId = mentionRole?.id || null;
          existing.lastItemKey = null;
        } else {
          config.instagramFeeds.push({ username, feedUrl, destinationChannelId: destination.id, roleId: mentionRole?.id || null, lastItemKey: null });
        }
      }
      if (sub === 'instagram-remove') {
        const username = interaction.options.getString('username', true).replace(/^@/, '').trim().toLowerCase();
        config.instagramFeeds = config.instagramFeeds.filter((feed) => feed.username.toLowerCase() !== username);
      }
      if (sub === 'instagram-list') {
        const entries = config.instagramFeeds.map((feed) => `• [@${feed.username}](https://www.instagram.com/${encodeURIComponent(feed.username)}/) → <#${feed.destinationChannelId}>${feed.roleId ? ` (mentions <@&${feed.roleId}>)` : ''}`);
        return interaction.reply({ content: entries.length ? entries.join('\n') : 'No Instagram feeds configured.', ephemeral: true });
      }
      if (sub === 'kick-add') {
        const username = interaction.options.getString('username', true).replace(/^@/, '').trim();
        const feedUrl = interaction.options.getString('feed_url', true).trim();
        const destination = interaction.options.getChannel('channel', true);
        const mentionRole = interaction.options.getRole('mention_role');
        if (!validKickUsername(username)) return interaction.reply({ content: 'Enter a Kick username containing only letters, numbers, and underscores.', ephemeral: true });
        if (!safeFeedUrl(feedUrl)) return interaction.reply({ content: 'The feed URL must be a public HTTPS RSS/Atom URL. A Kick profile URL alone is not a feed.', ephemeral: true });
        const existing = config.kickFeeds.find((feed) => feed.username.toLowerCase() === username.toLowerCase());
        if (existing) Object.assign(existing, { feedUrl, destinationChannelId: destination.id, roleId: mentionRole?.id || null, lastItemKey: null });
        else config.kickFeeds.push({ username, feedUrl, destinationChannelId: destination.id, roleId: mentionRole?.id || null, lastItemKey: null });
      }
      if (sub === 'kick-remove') {
        const username = interaction.options.getString('username', true).replace(/^@/, '').trim().toLowerCase();
        config.kickFeeds = config.kickFeeds.filter((feed) => feed.username.toLowerCase() !== username);
      }
      if (sub === 'kick-list') {
        const entries = config.kickFeeds.map((feed) => `• [${feed.username}](https://kick.com/${encodeURIComponent(feed.username)}) → <#${feed.destinationChannelId}>${feed.roleId ? ` (mentions <@&${feed.roleId}>)` : ''}`);
        return interaction.reply({ content: entries.length ? entries.join('\n') : 'No Kick creator feeds configured.', ephemeral: true });
      }
      if (sub === 'show') {
        return interaction.reply({ embeds: [embed('Current configuration', `Welcome: ${config.welcomeChannelId ? `<#${config.welcomeChannelId}>` : 'Not set'}\nLogs: ${config.modLogChannelId ? `<#${config.modLogChannelId}>` : 'Not set'}\nSuggestions: ${config.suggestionsChannelId ? `<#${config.suggestionsChannelId}>` : 'Not set'}\nAutorole: ${config.autoRoleId ? `<@&${config.autoRoleId}>` : 'Not set'}\nRaid alerts: ${config.raidAlerts ? 'On' : 'Off'}\nRaid mode: ${config.raidMode ? 'On' : 'Off'}\nAnti-invites: ${config.antiInvites ? 'On' : 'Off'}\nAnti-spam: ${config.antiSpam ? 'On' : 'Off'}\nAnti-mentions: ${config.antiMentionSpam ? 'On' : 'Off'}\nYouTube feeds: ${config.youtubeFeeds.length}\nInstagram feeds: ${config.instagramFeeds.length}\nKick feeds: ${config.kickFeeds.length}\nServer stats: ${config.serverStatsChannels.categoryId ? 'Configured' : 'Not configured'}\nTicket support role: ${config.ticketSupportRoleId ? `<@&${config.ticketSupportRoleId}>` : 'Not set'}\nTicket category: ${config.ticketCategoryId ? `<#${config.ticketCategoryId}>` : 'Not set'}\nVerified role: ${config.verifiedRoleId ? `<@&${config.verifiedRoleId}>` : 'Not set'}`, BLUE)], ephemeral: true });
      }
      saveStore();
      return interaction.reply({ content: `✅ Configuration updated: **${sub}**.`, ephemeral: true });
    }
    if (commandName === 'mod') {
      const sub = interaction.options.getSubcommand();
      const targetUser = interaction.options.getUser('user');
      const target = targetUser ? await interaction.guild.members.fetch(targetUser.id).catch(() => null) : null;
      const need = {
        warn: PermissionFlagsBits.ModerateMembers,
        warnings: PermissionFlagsBits.ModerateMembers,
        'clear-warnings': PermissionFlagsBits.ModerateMembers,
        timeout: PermissionFlagsBits.ModerateMembers,
        kick: PermissionFlagsBits.KickMembers,
        ban: PermissionFlagsBits.BanMembers,
        purge: PermissionFlagsBits.ManageMessages
      }[sub];
      if (need && !interaction.memberPermissions?.has(need) && !interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
        return interaction.reply({ content: `You do not have permission to use \/mod ${sub}.`, ephemeral: true });
      }
      const config = getGuildConfig(interaction.guildId);
      if (sub === 'warnings') {
        const warnings = config.warnings[targetUser.id] || [];
        const text = warnings.length ? warnings.slice(-10).map((item, i) => `${i + 1}. ${truncate(item.reason, 160)} — <@${item.moderatorId}> (<t:${Math.floor(new Date(item.at).getTime() / 1000)}:R>)`).join('\n') : 'No recorded warnings.';
        return interaction.reply({ embeds: [embed(`Warnings for ${targetUser.tag}`, text, ORANGE)], ephemeral: true });
      }
      if (sub === 'warn') {
        const reason = interaction.options.getString('reason', true);
        config.warnings[targetUser.id] ||= [];
        config.warnings[targetUser.id].push({ reason, moderatorId: interaction.user.id, at: new Date().toISOString() });
        saveStore();
        await logToGuild(interaction.guild, 'Member warned', `Member: ${targetUser.tag}\nModerator: ${interaction.user.tag}\nReason: ${truncate(reason, 700)}`, ORANGE);
        return interaction.reply({ content: `⚠️ Recorded warning for **${targetUser.tag}**.`, ephemeral: true });
      }
      if (sub === 'clear-warnings') {
        config.warnings[targetUser.id] = [];
        saveStore();
        return interaction.reply({ content: `Cleared warnings for **${targetUser.tag}**.`, ephemeral: true });
      }
      if (sub === 'timeout' || sub === 'kick' || sub === 'ban') {
        if (!target) return interaction.reply({ content: 'That member is not currently in this server.', ephemeral: true });
        if (target.id === interaction.user.id || target.id === client.user.id) return interaction.reply({ content: 'You cannot target yourself or the bot.', ephemeral: true });
        if (target.roles.highest.position >= interaction.member.roles.highest.position && interaction.guild.ownerId !== interaction.user.id) return interaction.reply({ content: 'Your highest role must be above the target member’s highest role.', ephemeral: true });
        if (!target.moderatable && sub === 'timeout') return interaction.reply({ content: 'I cannot timeout that member due to role hierarchy or permissions.', ephemeral: true });
        const reason = interaction.options.getString('reason', true);
        if (sub === 'timeout') {
          const minutes = interaction.options.getInteger('minutes', true);
          markModerationAction(interaction.guildId, targetUser.id);
          await target.timeout(minutes * 60000, `${interaction.user.tag}: ${reason}`);
          await logToGuild(interaction.guild, 'Member timed out', `Member: ${target.user.tag}\nModerator: ${interaction.user.tag}\nDuration: ${minutes} minute(s)\nReason: ${truncate(reason, 700)}`, ORANGE);
        } else if (sub === 'kick') {
          if (!target.kickable) return interaction.reply({ content: 'I cannot kick that member due to role hierarchy or permissions.', ephemeral: true });
          markModerationAction(interaction.guildId, targetUser.id);
          await target.kick(`${interaction.user.tag}: ${reason}`);
          await logToGuild(interaction.guild, 'Member kicked', `Member: ${target.user.tag}\nModerator: ${interaction.user.tag}\nReason: ${truncate(reason, 700)}`, RED);
        } else {
          markModerationAction(interaction.guildId, targetUser.id);
          await interaction.guild.members.ban(targetUser.id, { reason: `${interaction.user.tag}: ${reason}`, deleteMessageSeconds: 0 });
          await logToGuild(interaction.guild, 'Member banned', `Member: ${targetUser.tag}\nModerator: ${interaction.user.tag}\nReason: ${truncate(reason, 700)}`, RED);
        }
        return interaction.reply({ content: `✅ ${sub[0].toUpperCase()}${sub.slice(1)} action completed for **${targetUser.tag}**.`, ephemeral: true });
      }
      if (sub === 'purge') {
        const amount = interaction.options.getInteger('amount', true);
        if (!interaction.channel?.bulkDelete) return interaction.reply({ content: 'This channel does not support bulk deletion.', ephemeral: true });
        const deleted = await interaction.channel.bulkDelete(amount, true);
        await logToGuild(interaction.guild, 'Messages purged', `${interaction.user.tag} purged ${deleted.size} messages in <#${interaction.channelId}>.`, ORANGE);
        return interaction.reply({ content: `🧹 Deleted ${deleted.size} recent message(s).`, ephemeral: true });
      }
    }
  } catch (error) {
    console.error(`Interaction /${commandName} failed:`, error);
    const message = 'That command failed. Check the bot permissions, role hierarchy, and configuration, then check the console logs.';
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (!message.guild || message.author.bot || !message.member) return;
  const config = getGuildConfig(message.guild.id);
  const content = message.content || '';
  const commandMessage = content.startsWith(PREFIX);

  // Moderators and admins are exempt from automatic content filters, not from explicit commands.
  if (!isStaff(message.member)) {
    const joinedRecently = message.member.joinedTimestamp && (Date.now() - message.member.joinedTimestamp < 10 * 60 * 1000);
    const invite = /(?:https?:\/\/)?(?:www\.)?(?:discord\.gg|discord(?:app)?\.com\/invite)\/[\w-]+/i.test(content);
    const massMentions = (message.mentions.users.size + message.mentions.roles.size + (message.mentions.everyone ? 5 : 0)) >= 5;

    if (config.antiInvites && invite) {
      await message.delete().catch(() => {});
      const notice = await message.channel.send(`${message.author}, Discord invite links are not allowed here.`).catch(() => null);
      if (notice) setTimeout(() => notice.delete().catch(() => {}), 6000);
      await logToGuild(message.guild, 'Invite link blocked', `${message.author.tag} posted a Discord invite in <#${message.channel.id}>.`, ORANGE);
      return;
    }
    if (config.antiMentionSpam && massMentions) {
      await message.delete().catch(() => {});
      await message.member.timeout(2 * 60 * 1000, 'Automatic protection: mass mentions').catch(() => {});
      await logToGuild(message.guild, 'Mass mentions blocked', `${message.author.tag} triggered the mass-mention filter in <#${message.channel.id}>.`, ORANGE);
      return;
    }
    if (config.raidMode && joinedRecently && /(https?:\/\/|discord\.gg\/)/i.test(content)) {
      await message.delete().catch(() => {});
      await message.member.timeout(5 * 60 * 1000, 'Raid mode: new member posted a link').catch(() => {});
      await logToGuild(message.guild, 'Raid-mode link blocked', `${message.author.tag} (recent join) posted a link in <#${message.channel.id}>.`, RED);
      return;
    }
    if (config.antiSpam && !commandMessage) {
      const key = `${message.guild.id}:${message.author.id}`;
      const now = Date.now();
      const recent = (messageWindows.get(key) || []).filter((time) => now - time < 6000);
      recent.push(now);
      messageWindows.set(key, recent);
      const oldDuplicate = duplicateMessages.get(key);
      const isDuplicate = oldDuplicate && oldDuplicate.content === content && now - oldDuplicate.at < 12000;
      duplicateMessages.set(key, { content, at: now });
      if (recent.length >= 6 || isDuplicate) {
        await message.delete().catch(() => {});
        await message.member.timeout(60 * 1000, 'Automatic protection: rapid/repeated messages').catch(() => {});
        await logToGuild(message.guild, 'Anti-spam action', `${message.author.tag} triggered the anti-spam filter in <#${message.channel.id}>.`, ORANGE);
        messageWindows.set(key, []);
        return;
      }
    }
  }

  if (!commandMessage && content.trim().length >= 5) await awardMessageXP(message, config);

  if (commandMessage) {
    const key = `${message.guild.id}:${message.author.id}`;
    const now = Date.now();
    if ((cooldowns.get(key) || 0) > now) return;
    cooldowns.set(key, now + 700);
    try { await handlePrefixCommand(message); }
    catch (error) { console.error('Prefix command error:', error); }
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const config = getGuildConfig(member.guild.id);
  await logToGuild(member.guild, 'Member joined', `Member: ${member.user.tag} (${member.id})\\nAccount created: <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>`, GREEN);
  scheduleServerStatsUpdate(member.guild);
  const usedInvite = await detectUsedInvite(member.guild);
  if (usedInvite?.inviter?.id) {
    const inviterId = usedInvite.inviter.id;
    config.inviteStats[inviterId] ||= { joins: 0, leaves: 0 };
    config.inviteStats[inviterId].joins = Math.max(0, Number(config.inviteStats[inviterId].joins) || 0) + 1;
    config.invitedByMember[member.id] = inviterId;
    saveStore();
    await logToGuild(member.guild, 'Invite tracked', `New member: ${member.user.tag}\nInviter: <@${inviterId}>\nInvite code: \`${usedInvite.code}\``, GREEN);
  }
  if (config.autoRoleId) {
    const role = member.guild.roles.cache.get(config.autoRoleId) || await member.guild.roles.fetch(config.autoRoleId).catch(() => null);
    if (role) await member.roles.add(role, 'Configured autorole').catch((error) => console.warn('Autorole failed:', error.message));
  }
  if (config.welcomeChannelId) {
    await logToChannel(member.guild, config.welcomeChannelId, {
      embeds: [embed(`👋 Welcome to ${member.guild.name}!`, `Welcome ${member} — please read the rules and enjoy your stay.\nMember number: **${member.guild.memberCount}**`, GREEN).setThumbnail(member.user.displayAvatarURL())],
      allowedMentions: { users: [member.id] }
    });
  }
  await logToGuild(member.guild, 'Member joined', `${member.user.tag} (${member.id}) joined the server. Account created <t:${Math.floor(member.user.createdTimestamp / 1000)}:R>.`, GREEN);

  const now = Date.now();
  const recent = (joinTimestamps.get(member.guild.id) || []).filter((time) => now - time < 10000);
  recent.push(now);
  joinTimestamps.set(member.guild.id, recent);
  if (config.raidAlerts && recent.length >= 7 && !config.raidMode) {
    config.raidMode = true;
    saveStore();
    await logToGuild(member.guild, '🚨 Join-wave detected', `${recent.length} members joined within about 10 seconds. Raid mode has been enabled automatically. Review the join list and use \/raidmode enabled:false or \.raidmode off after the wave is checked.`, RED);
  } else if (config.raidAlerts && recent.length >= 7) {
    await logToGuild(member.guild, '🚨 Additional join wave', `${recent.length} joins detected in 10 seconds while raid mode is already active.`, RED);
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  scheduleServerStatsUpdate(member.guild);
  await logToGuild(member.guild, 'Member left', `Member: ${member.user?.tag || 'Unknown member'} (${member.id})`, ORANGE);
  const config = getGuildConfig(member.guild.id);
  const inviterId = config.invitedByMember[member.id];
  if (inviterId) {
    config.inviteStats[inviterId] ||= { joins: 0, leaves: 0 };
    config.inviteStats[inviterId].leaves = Math.max(0, Number(config.inviteStats[inviterId].leaves) || 0) + 1;
    delete config.invitedByMember[member.id];
    saveStore();
  }
  // Discord emits this for both voluntary leaves and kicks/bans. Wait briefly for audit logs.
  await new Promise((resolve) => setTimeout(resolve, 1200));
  if (wasRecentlyHandledByBot(member.guild.id, member.id)) return; // The command handler already sent the action log.
  const banEntry = await findRecentAuditEntry(member.guild, AuditLogEvent.MemberBanAdd, member.id, 15000);
  if (banEntry) return; // GuildBanAdd sends the dedicated ban notification.
  const kickEntry = await findRecentAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id, 15000);
  if (kickEntry) {
    const moderator = kickEntry.executor ? `${kickEntry.executor.tag} (${kickEntry.executor.id})` : 'Unknown / audit log unavailable';
    await logToGuild(member.guild, '👢 Member kicked', `Member: ${member.user?.tag || 'Unknown member'} (${member.id})\nModerator: ${moderator}\nReason: ${truncate(kickEntry.reason || 'No reason supplied', 500)}`, RED);
    return;
  }
  await logToGuild(member.guild, 'Member left', `${member.user?.tag || 'Unknown member'} (${member.id}) left the server.`, ORANGE);
});

client.on(Events.GuildBanAdd, async (ban) => {
  await new Promise((resolve) => setTimeout(resolve, 900));
  if (wasRecentlyHandledByBot(ban.guild.id, ban.user.id)) return;
  const entry = await findRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id, 15000);
  const moderator = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : 'Unknown / audit log unavailable';
  await logToGuild(ban.guild, '🔨 Member banned', `Member: ${ban.user.tag} (${ban.user.id})\nModerator: ${moderator}\nReason: ${truncate(entry?.reason || 'No reason supplied', 500)}`, RED);
});

client.on(Events.GuildBanRemove, async (ban) => {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const entry = await findRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id, 15000);
  const moderator = entry?.executor ? `${entry.executor.tag} (${entry.executor.id})` : 'Unknown / audit log unavailable';
  await logToGuild(ban.guild, '♻️ Member unbanned', `User: ${ban.user.tag} (${ban.user.id})\nModerator: ${moderator}\nReason: ${truncate(entry?.reason || 'No reason supplied', 500)}`, GREEN);
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (wasRecentlyHandledByBot(newMember.guild.id, newMember.id)) return;
  if (oldMember.nickname !== newMember.nickname) {
    await logToGuild(newMember.guild, 'Nickname changed', `Member: ${newMember.user.tag} (${newMember.id})\nBefore: ${oldMember.nickname || oldMember.user.username}\nAfter: ${newMember.nickname || newMember.user.username}`, BLUE);
  }
  const added = newMember.roles.cache.filter((role) => role.id !== newMember.guild.id && !oldMember.roles.cache.has(role.id)).map((role) => role.name);
  const removed = oldMember.roles.cache.filter((role) => role.id !== oldMember.guild.id && !newMember.roles.cache.has(role.id)).map((role) => role.name);
  if (added.length || removed.length) {
    const lines = [];
    if (added.length) lines.push(`Added: ${truncate(added.join(', '), 450)}`);
    if (removed.length) lines.push(`Removed: ${truncate(removed.join(', '), 450)}`);
    await logToGuild(newMember.guild, 'Member roles changed', `Member: ${newMember.user.tag} (${newMember.id})\n${lines.join('\n')}`, BLUE);
  }
  const beforeTimeout = oldMember.communicationDisabledUntilTimestamp || null;
  const afterTimeout = newMember.communicationDisabledUntilTimestamp || null;
  if (beforeTimeout !== afterTimeout) {
    if (afterTimeout) await logToGuild(newMember.guild, '⏱️ Member timed out', `Member: ${newMember.user.tag} (${newMember.id})\nTimeout until: <t:${Math.floor(afterTimeout / 1000)}:F>`, ORANGE);
    else if (beforeTimeout) await logToGuild(newMember.guild, '✅ Member timeout removed', `Member: ${newMember.user.tag} (${newMember.id}) is no longer timed out.`, GREEN);
  }
});

client.on(Events.ChannelCreate, async (channel) => {
  if (channel.guild) scheduleServerStatsUpdate(channel.guild);
  if (channel.guild) await logToGuild(channel.guild, 'Channel created', `Channel: ${channel}\nName: ${channel.name}\nType: ${channel.type}`, GREEN);
});
client.on(Events.ChannelDelete, async (channel) => {
  if (channel.guild) scheduleServerStatsUpdate(channel.guild);
  if (channel.guild) await logToGuild(channel.guild, 'Channel deleted', `Name: #${channel.name}\nID: ${channel.id}`, RED);
});
client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  const changes = [];
  if (oldChannel.name !== newChannel.name) changes.push(`Name: ${oldChannel.name} → ${newChannel.name}`);
  if ('topic' in oldChannel && oldChannel.topic !== newChannel.topic) changes.push(`Topic changed in #${newChannel.name}`);
  if ('parentId' in oldChannel && oldChannel.parentId !== newChannel.parentId) changes.push(`Category changed for #${newChannel.name}`);
  if (changes.length) await logToGuild(newChannel.guild, 'Channel updated', changes.join('\n'), ORANGE);
});
client.on(Events.GuildRoleCreate, async (role) => {
  await logToGuild(role.guild, 'Role created', `Role: ${role.name} (${role.id})`, GREEN);
});
client.on(Events.GuildRoleDelete, async (role) => {
  await logToGuild(role.guild, 'Role deleted', `Role: ${role.name} (${role.id})`, RED);
});
client.on(Events.GuildRoleUpdate, async (oldRole, newRole) => {
  const changes = [];
  if (oldRole.name !== newRole.name) changes.push(`Name: ${oldRole.name} → ${newRole.name}`);
  if (oldRole.position !== newRole.position) changes.push(`Position: ${oldRole.position} → ${newRole.position}`);
  if (oldRole.color !== newRole.color) changes.push('Color changed');
  if (changes.length) await logToGuild(newRole.guild, 'Role updated', `Role: ${newRole.name} (${newRole.id})\n${changes.join('\n')}`, ORANGE);
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const member = newState.member || oldState.member;
  const guild = newState.guild || oldState.guild;
  if (!guild || !member || member.user?.bot) return;
  const before = oldState.channel;
  const after = newState.channel;
  if (before?.id === after?.id) return;
  let title = 'Voice channel updated';
  let description = `Member: ${member.user.tag} (${member.id})`;
  if (!before && after) { title = 'Voice joined'; description += `\nJoined: ${after.name}`; }
  else if (before && !after) { title = 'Voice left'; description += `\nLeft: ${before.name}`; }
  else if (before && after) { title = 'Voice moved'; description += `\nFrom: ${before.name}\nTo: ${after.name}`; }
  await logToGuild(guild, title, description, BLUE);
});

client.on(Events.MessageDelete, async (message) => {
  if (!message.guild || message.author?.bot) return;
  await logToGuild(message.guild, 'Message deleted', `Author: ${message.author?.tag || 'Unknown'}\nChannel: <#${message.channelId}>\nContent: ${truncate(message.content || '[content unavailable or uncached]', 700)}`, ORANGE);
});

client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
  if (!newMessage.guild || newMessage.author?.bot) return;
  if (oldMessage.partial || newMessage.partial) return;
  if (oldMessage.content === newMessage.content) return;
  await logToGuild(newMessage.guild, 'Message edited', `Author: ${newMessage.author.tag}\nChannel: <#${newMessage.channelId}>\nBefore: ${truncate(oldMessage.content || '[empty]', 350)}\nAfter: ${truncate(newMessage.content || '[empty]', 350)}`, BLUE);
});

async function pollYouTubeFeeds() {
  if (!client.isReady() || rssPollInFlight) return;
  rssPollInFlight = true;
  try {
    for (const [guildId, config] of listGuildConfigs()) {
      if (!config.youtubeFeeds?.length) continue;
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      let changed = false;
      for (const feed of config.youtubeFeeds) {
        try {
          const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(feed.channelId)}`;
          const result = await parser.parseURL(feedUrl);
          const items = Array.isArray(result.items) ? result.items : [];
          if (!items.length) continue;
          const getVideoId = (item) => String(item.id || item.link || '').match(/(?:video:|v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/)?.[1] || null;
          const newestFirst = items.map((item) => ({ item, videoId: getVideoId(item) })).filter((entry) => entry.videoId);
          if (!newestFirst.length) continue;
          if (!feed.lastVideoId) {
            feed.lastVideoId = newestFirst[0].videoId;
            changed = true;
            continue; // First poll seeds the latest ID and avoids a burst of old announcements.
          }
          const position = newestFirst.findIndex((entry) => entry.videoId === feed.lastVideoId);
          const unseen = position >= 0 ? newestFirst.slice(0, position).reverse() : [newestFirst[0]];
          if (unseen.length) {
            const destination = guild.channels.cache.get(feed.destinationChannelId)
              || await guild.channels.fetch(feed.destinationChannelId).catch(() => null);
            if (destination?.isTextBased?.()) {
              for (const entry of unseen.slice(-5)) {
                const title = truncate(entry.item.title || 'New YouTube upload', 240);
                const link = entry.item.link || `https://www.youtube.com/watch?v=${entry.videoId}`;
                const who = feed.roleId ? `<@&${feed.roleId}> ` : '';
                await destination.send({
                  content: `${who}📺 **New upload from ${truncate(result.title || 'YouTube channel', 100)}!**\n${title}\n${link}`,
                  allowedMentions: { parse: [], roles: feed.roleId ? [feed.roleId] : [] }
                }).catch((error) => console.warn('YouTube alert send failed:', error.message));
              }
            }
            feed.lastVideoId = newestFirst[0].videoId;
            changed = true;
          }
        } catch (error) {
          console.warn(`YouTube RSS poll failed for ${feed.channelId}:`, error?.message || error);
        }
      }
      if (changed) saveStore();
    }
  } finally {
    rssPollInFlight = false;
  }
}

async function pollInstagramFeeds() {
  if (!client.isReady() || instagramPollInFlight) return;
  instagramPollInFlight = true;
  try {
    for (const [guildId, config] of listGuildConfigs()) {
      if (!config.instagramFeeds?.length) continue;
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      let changed = false;
      for (const feed of config.instagramFeeds) {
        try {
          if (!safeFeedUrl(feed.feedUrl)) {
            console.warn(`Ignoring invalid Instagram feed URL configured for @${feed.username}.`);
            continue;
          }
          const result = await parser.parseURL(feed.feedUrl);
          const items = Array.isArray(result.items) ? result.items : [];
          if (!items.length) continue;
          const getItemKey = (item) => String(item.guid || item.id || item.link || item.title || '').trim();
          const newestFirst = items.map((item) => ({ item, key: getItemKey(item) })).filter((entry) => entry.key);
          if (!newestFirst.length) continue;
          if (!feed.lastItemKey) {
            feed.lastItemKey = newestFirst[0].key;
            changed = true;
            continue; // Seed current state without posting a historical flood on initial setup.
          }
          const previousIndex = newestFirst.findIndex((entry) => entry.key === feed.lastItemKey);
          const unseen = previousIndex >= 0 ? newestFirst.slice(0, previousIndex).reverse() : [newestFirst[0]];
          if (!unseen.length) continue;
          const destination = guild.channels.cache.get(feed.destinationChannelId)
            || await guild.channels.fetch(feed.destinationChannelId).catch(() => null);
          if (!destination?.isTextBased?.()) continue;
          for (const entry of unseen.slice(-3)) {
            const title = truncate(entry.item.title || `New Instagram post from @${feed.username}`, 220);
            const rawLink = String(entry.item.link || `https://www.instagram.com/${encodeURIComponent(feed.username)}/`).trim();
            const link = /^https:\/\//i.test(rawLink) ? rawLink : `https://www.instagram.com/${encodeURIComponent(feed.username)}/`;
            const rolePing = feed.roleId ? `<@&${feed.roleId}> ` : '';
            await destination.send({
              content: `${rolePing}📸 **New Instagram post from @${truncate(feed.username, 30)}**\n${title}\n${link}`,
              allowedMentions: { parse: [], roles: feed.roleId ? [feed.roleId] : [] }
            }).catch((error) => console.warn(`Instagram alert send failed for @${feed.username}:`, error.message));
          }
          feed.lastItemKey = newestFirst[0].key;
          changed = true;
        } catch (error) {
          console.warn(`Instagram RSS poll failed for @${feed.username}:`, error?.message || error);
        }
      }
      if (changed) saveStore();
    }
  } finally {
    instagramPollInFlight = false;
  }
}

async function pollKickFeeds() {
  if (!client.isReady() || kickPollInFlight) return;
  kickPollInFlight = true;
  try {
    for (const [guildId, config] of listGuildConfigs()) {
      if (!config.kickFeeds?.length) continue;
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      let changed = false;
      for (const feed of config.kickFeeds) {
        try {
          if (!safeFeedUrl(feed.feedUrl)) continue;
          const result = await parser.parseURL(feed.feedUrl);
          const items = Array.isArray(result.items) ? result.items : [];
          const newestFirst = items.map((item) => ({
            item,
            key: String(item.guid || item.id || item.link || item.title || '').trim()
          })).filter((entry) => entry.key);
          if (!newestFirst.length) continue;
          if (!feed.lastItemKey) {
            feed.lastItemKey = newestFirst[0].key;
            changed = true;
            continue;
          }
          const priorIndex = newestFirst.findIndex((entry) => entry.key === feed.lastItemKey);
          const unseen = priorIndex >= 0 ? newestFirst.slice(0, priorIndex).reverse() : [newestFirst[0]];
          if (!unseen.length) continue;
          const destination = guild.channels.cache.get(feed.destinationChannelId)
            || await guild.channels.fetch(feed.destinationChannelId).catch(() => null);
          if (!destination?.isTextBased?.()) continue;
          for (const entry of unseen.slice(-3)) {
            const rawLink = String(entry.item.link || `https://kick.com/${encodeURIComponent(feed.username)}`).trim();
            const link = /^https:\/\//i.test(rawLink) ? rawLink : `https://kick.com/${encodeURIComponent(feed.username)}`;
            const title = truncate(entry.item.title || `New feed update from ${feed.username}`, 220);
            const rolePing = feed.roleId ? `<@&${feed.roleId}> ` : '';
            await destination.send({
              content: `${rolePing}🟢 **Kick update from ${truncate(feed.username, 30)}**\n${title}\n${link}`,
              allowedMentions: { parse: [], roles: feed.roleId ? [feed.roleId] : [] }
            }).catch((error) => console.warn(`Kick alert send failed for ${feed.username}:`, error.message));
          }
          feed.lastItemKey = newestFirst[0].key;
          changed = true;
        } catch (error) {
          console.warn(`Kick RSS poll failed for ${feed.username}:`, error?.message || error);
        }
      }
      if (changed) saveStore();
    }
  } finally {
    kickPollInFlight = false;
  }
}

const pollMinutes = Math.max(2, Number(process.env.SOCIAL_POLL_INTERVAL_MINUTES || process.env.YOUTUBE_POLL_INTERVAL_MINUTES || 3));
setInterval(() => pollYouTubeFeeds().catch((error) => console.error('YouTube poll error:', error)), pollMinutes * 60 * 1000).unref();
setInterval(() => pollInstagramFeeds().catch((error) => console.error('Instagram poll error:', error)), pollMinutes * 60 * 1000).unref();
setInterval(() => pollKickFeeds().catch((error) => console.error('Kick feed poll error:', error)), pollMinutes * 60 * 1000).unref();

client.on(Events.Error, (error) => console.error('Discord client error:', error));
process.on('unhandledRejection', (error) => console.error('Unhandled promise rejection:', error));
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  // Leave restart/recovery to Docker's supervisor rather than continue in an unknown state.
  process.exit(1);
});

await client.login(process.env.DISCORD_TOKEN);
