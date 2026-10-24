import { SlashCommandBuilder, ChannelType } from 'discord.js';

export const commands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check whether the bot is responding.'),
  new SlashCommandBuilder().setName('stats').setDescription('Show bot CPU, RAM, uptime, and Discord latency.'),
  new SlashCommandBuilder().setName('help').setDescription('Show the bot features and commands.'),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show basic information about this server.'),
  new SlashCommandBuilder().setName('userinfo').setDescription('Show basic information about a server member.')
    .addUserOption((option) => option.setName('user').setDescription('Member to inspect').setRequired(false)),
  new SlashCommandBuilder().setName('level').setDescription('Show your or another member’s message level.')
    .addUserOption((option) => option.setName('user').setDescription('Member to inspect').setRequired(false)),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Show the top 10 members by chat activity.'),
  new SlashCommandBuilder().setName('poll').setDescription('Create a community poll with up to four options.')
    .addStringOption((option) => option.setName('question').setDescription('Poll question').setRequired(true).setMaxLength(250))
    .addStringOption((option) => option.setName('option1').setDescription('First option').setRequired(true).setMaxLength(80))
    .addStringOption((option) => option.setName('option2').setDescription('Second option').setRequired(true).setMaxLength(80))
    .addStringOption((option) => option.setName('option3').setDescription('Optional third option').setRequired(false).setMaxLength(80))
    .addStringOption((option) => option.setName('option4').setDescription('Optional fourth option').setRequired(false).setMaxLength(80)),
  new SlashCommandBuilder().setName('ticket-panel').setDescription('Post the button members use to open private support tickets.')
    .addChannelOption((option) => option.setName('channel').setDescription('Where the ticket panel should be posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
  new SlashCommandBuilder().setName('verify-panel').setDescription('Post a button members use to receive the configured verified role.')
    .addChannelOption((option) => option.setName('channel').setDescription('Where the verification panel should be posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)),
  new SlashCommandBuilder().setName('role').setDescription('Add or remove a role from a member (permission and hierarchy checked).')
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a role to a member')
      .addUserOption((option) => option.setName('user').setDescription('Target member').setRequired(true))
      .addRoleOption((option) => option.setName('role').setDescription('Role to add').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a role from a member')
      .addUserOption((option) => option.setName('user').setDescription('Target member').setRequired(true))
      .addRoleOption((option) => option.setName('role').setDescription('Role to remove').setRequired(true))),
  new SlashCommandBuilder().setName('suggest').setDescription('Send a suggestion to the configured suggestions channel.')
    .addStringOption((option) => option.setName('title').setDescription('Short suggestion title').setRequired(true).setMaxLength(100))
    .addStringOption((option) => option.setName('details').setDescription('Explain your idea').setRequired(true).setMaxLength(1500)),
  new SlashCommandBuilder().setName('raidmode').setDescription('Manually enable or disable stricter anti-raid filters.')
    .addBooleanOption((option) => option.setName('enabled').setDescription('Turn raid mode on or off').setRequired(true)),
  new SlashCommandBuilder().setName('config').setDescription('Configure welcome messages, logs, YouTube alerts, and protections.')
    .addSubcommand((sub) => sub.setName('welcome').setDescription('Set the welcome-message channel')
      .addChannelOption((option) => option.setName('channel').setDescription('Welcome channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((sub) => sub.setName('logs').setDescription('Set the moderation-log channel')
      .addChannelOption((option) => option.setName('channel').setDescription('Private staff log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub.setName('log-channel').setDescription('Set one of the seven separate log channels')
      .addStringOption((option) => option.setName('category').setDescription('Which type of events to log').setRequired(true).addChoices(
        { name: 'Join logs', value: 'join' }, { name: 'Member logs', value: 'members' }, { name: 'Message logs', value: 'messages' },
        { name: 'Server logs', value: 'server' }, { name: 'Voice logs', value: 'voice' }, { name: 'Role logs', value: 'roles' }, { name: 'Moderation logs', value: 'moderation' }
      ))
      .addChannelOption((option) => option.setName('channel').setDescription('Destination log channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub.setName('suggestions').setDescription('Set the suggestion channel')
      .addChannelOption((option) => option.setName('channel').setDescription('Suggestion channel').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true)))
    .addSubcommand((sub) => sub.setName('autorole').setDescription('Set the role given to new members')
      .addRoleOption((option) => option.setName('role').setDescription('Role to add when someone joins').setRequired(true)))
    .addSubcommand((sub) => sub.setName('raid-alerts').setDescription('Enable or disable join-wave alerts')
      .addBooleanOption((option) => option.setName('enabled').setDescription('Enable join-wave monitoring').setRequired(true)))
    .addSubcommand((sub) => sub.setName('anti-invites').setDescription('Block Discord invite links from non-staff members')
      .addBooleanOption((option) => option.setName('enabled').setDescription('Enable invite filtering').setRequired(true)))
    .addSubcommand((sub) => sub.setName('anti-spam').setDescription('Enable or disable rapid-message anti-spam')
      .addBooleanOption((option) => option.setName('enabled').setDescription('Enable anti-spam').setRequired(true)))
    .addSubcommand((sub) => sub.setName('anti-mentions').setDescription('Enable or disable mass-mention filtering')
      .addBooleanOption((option) => option.setName('enabled').setDescription('Enable mass-mention filtering').setRequired(true)))
    .addSubcommand((sub) => sub.setName('youtube-add').setDescription('Subscribe this server to a YouTube channel')
      .addStringOption((option) => option.setName('channel_id').setDescription('YouTube channel ID beginning with UC').setRequired(true).setMaxLength(100))
      .addChannelOption((option) => option.setName('channel').setDescription('Where upload alerts should be posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addRoleOption((option) => option.setName('mention_role').setDescription('Optional role to mention for uploads').setRequired(false)))
    .addSubcommand((sub) => sub.setName('youtube-remove').setDescription('Remove a YouTube channel subscription')
      .addStringOption((option) => option.setName('channel_id').setDescription('YouTube channel ID beginning with UC').setRequired(true).setMaxLength(100)))
    .addSubcommand((sub) => sub.setName('youtube-list').setDescription('List configured YouTube notifications'))
    .addSubcommand((sub) => sub.setName('instagram-add').setDescription('Subscribe to an Instagram account using an RSS/Atom feed URL')
      .addStringOption((option) => option.setName('username').setDescription('Instagram username without @').setRequired(true).setMaxLength(30))
      .addStringOption((option) => option.setName('feed_url').setDescription('HTTPS RSS/Atom URL from a feed provider; profile URLs are not feeds').setRequired(true).setMaxLength(500))
      .addChannelOption((option) => option.setName('channel').setDescription('Where Instagram alerts should be posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addRoleOption((option) => option.setName('mention_role').setDescription('Optional role to mention for new posts').setRequired(false)))
    .addSubcommand((sub) => sub.setName('instagram-remove').setDescription('Remove an Instagram feed subscription')
      .addStringOption((option) => option.setName('username').setDescription('Instagram username without @').setRequired(true).setMaxLength(30)))
    .addSubcommand((sub) => sub.setName('instagram-list').setDescription('List Instagram feed subscriptions'))
    .addSubcommand((sub) => sub.setName('kick-add').setDescription('Subscribe to a Kick creator using a compatible HTTPS RSS/Atom feed URL')
      .addStringOption((option) => option.setName('username').setDescription('Kick creator username').setRequired(true).setMaxLength(30))
      .addStringOption((option) => option.setName('feed_url').setDescription('HTTPS RSS/Atom URL from a compatible feed provider').setRequired(true).setMaxLength(500))
      .addChannelOption((option) => option.setName('channel').setDescription('Where livestream alerts should be posted').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
      .addRoleOption((option) => option.setName('mention_role').setDescription('Optional role to mention for alerts').setRequired(false)))
    .addSubcommand((sub) => sub.setName('kick-remove').setDescription('Remove a Kick creator feed')
      .addStringOption((option) => option.setName('username').setDescription('Kick creator username').setRequired(true).setMaxLength(30)))
    .addSubcommand((sub) => sub.setName('kick-list').setDescription('List Kick creator alert feeds'))
    .addSubcommand((sub) => sub.setName('ticket-role').setDescription('Set the support role that can view tickets')
      .addRoleOption((option) => option.setName('role').setDescription('Support team role').setRequired(true)))
    .addSubcommand((sub) => sub.setName('ticket-category').setDescription('Set the category where new tickets are created')
      .addChannelOption((option) => option.setName('category').setDescription('Ticket category').addChannelTypes(ChannelType.GuildCategory).setRequired(true)))
    .addSubcommand((sub) => sub.setName('verified-role').setDescription('Set the role given by the verification button')
      .addRoleOption((option) => option.setName('role').setDescription('Verified member role').setRequired(true)))
    .addSubcommand((sub) => sub.setName('show').setDescription('Show this server’s current bot configuration')),
  new SlashCommandBuilder().setName('mod').setDescription('Moderation tools. Each action checks caller permissions.')
    .addSubcommand((sub) => sub.setName('warn').setDescription('Record a warning for a member')
      .addUserOption((option) => option.setName('user').setDescription('Member to warn').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for the warning').setRequired(true).setMaxLength(500)))
    .addSubcommand((sub) => sub.setName('warnings').setDescription('View recorded warnings for a member')
      .addUserOption((option) => option.setName('user').setDescription('Member whose warnings you want to view').setRequired(true)))
    .addSubcommand((sub) => sub.setName('clear-warnings').setDescription('Clear recorded warnings for a member')
      .addUserOption((option) => option.setName('user').setDescription('Member whose warnings should be cleared').setRequired(true)))
    .addSubcommand((sub) => sub.setName('timeout').setDescription('Timeout a member')
      .addUserOption((option) => option.setName('user').setDescription('Member to timeout').setRequired(true))
      .addIntegerOption((option) => option.setName('minutes').setDescription('Duration in minutes (1–40320)').setMinValue(1).setMaxValue(40320).setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for timeout').setRequired(true).setMaxLength(500)))
    .addSubcommand((sub) => sub.setName('kick').setDescription('Kick a member')
      .addUserOption((option) => option.setName('user').setDescription('Member to kick').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for kick').setRequired(true).setMaxLength(500)))
    .addSubcommand((sub) => sub.setName('ban').setDescription('Ban a user')
      .addUserOption((option) => option.setName('user').setDescription('User to ban').setRequired(true))
      .addStringOption((option) => option.setName('reason').setDescription('Reason for ban').setRequired(true).setMaxLength(500)))
    .addSubcommand((sub) => sub.setName('purge').setDescription('Delete recent messages in this channel')
      .addIntegerOption((option) => option.setName('amount').setDescription('Number of messages (1–100)').setMinValue(1).setMaxValue(100).setRequired(true)))
].map((command) => command.toJSON());
