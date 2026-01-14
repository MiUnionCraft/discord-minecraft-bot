
require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  AttachmentBuilder
} = require('discord.js');

const mc = require('minecraft-server-util');

/* =======================
   CLIENTE
======================= */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

/* =======================
   VERIFICACIÓN NIVEL DIOS
======================= */
const captchaData = new Map();
const verifyCooldown = new Map();

/* =======================
   UTILIDADES
======================= */
const botAvatar = () =>
  client.user?.displayAvatarURL({ extension: 'png', size: 256 });

const baseEmbed = () =>
  new EmbedBuilder()
    .setColor(0xfacc15)
    .setThumbnail(botAvatar())
    .setFooter({ text: 'MiUnionCraft • Soporte' })
    .setTimestamp();

/* =======================
   AUTO CIERRE
======================= */
const timeouts = new Map();
const warnings = new Map();

const INACTIVITY = Number(process.env.TICKET_INACTIVITY_MINUTES) || 30;
const WARNING = Number(process.env.TICKET_WARNING_MINUTES) || 5;

/* =======================
   HTML ESCAPE
======================= */
const escapeHTML = t => {
  if (!t || typeof t !== 'string') return '';
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
};

/* =======================
   LOG VERIFICACIÓN
======================= */
function logVerify(guild, user, success, reason) {
  const ch = guild.channels.cache.get(process.env.VERIFY_LOG_CHANNEL_ID);
  if (!ch) return;

  ch.send({
    embeds: [
      new EmbedBuilder()
        .setColor(success ? 0x22c55e : 0xef4444)
        .setTitle(success ? '✅ Verificación Exitosa' : '❌ Verificación Fallida')
        .addFields(
          { name: 'Usuario', value: user.tag, inline: true },
          { name: 'ID', value: user.id, inline: true },
          { name: 'Motivo', value: reason }
        )
        .setTimestamp()
    ]
  });
}

/* =======================
   SLASH COMMANDS
======================= */
const commands = [
  new SlashCommandBuilder().setName('status').setDescription('Estado del servidor'),
  new SlashCommandBuilder().setName('players').setDescription('Jugadores conectados'),
  new SlashCommandBuilder().setName('ip').setDescription('IP del servidor'),
  new SlashCommandBuilder().setName('version').setDescription('Versión del servidor'),
  new SlashCommandBuilder().setName('verificacion').setDescription('Enviar panel de verificación'),
  new SlashCommandBuilder().setName('ticket').setDescription('Abrir un ticket de soporte')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

/* =======================
   READY
======================= */
client.once('clientReady', async () => {
  await rest.put(
    Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
    { body: commands }
  );
  console.log(`✅ ${client.user.tag} listo`);
});

/* =======================
   ANTI-ALT
======================= */
client.on('guildMemberAdd', async member => {
  const unverified = member.guild.roles.cache.get(process.env.UNVERIFIED_ROLE_ID);
  if (!unverified) return;

  await member.roles.add(unverified).catch(() => {});

  const minAge = Number(process.env.MIN_ACCOUNT_AGE_DAYS) || 3;
  const age = (Date.now() - member.user.createdTimestamp) / 86400000;

  if (age < minAge) {
    logVerify(member.guild, member.user, false, 'Cuenta nueva');
    return member.kick('Cuenta demasiado nueva').catch(() => {});
  }
});

/* =======================
   INTERACCIONES
======================= */
client.on('interactionCreate', async interaction => {

  /* ===== BOTONES ===== */
  if (interaction.isButton()) {

    /* ---- VERIFICACIÓN ---- */
    if (interaction.customId === 'start_verify') {

      const now = Date.now();
      const cd = verifyCooldown.get(interaction.user.id);
      if (cd && now - cd < Number(process.env.VERIFY_COOLDOWN_SECONDS) * 1000)
        return interaction.reply({ content: '⏳ Espera un momento.', ephemeral: true });

      verifyCooldown.set(interaction.user.id, now);

      const a = Math.floor(Math.random() * 5) + 1;
      const b = Math.floor(Math.random() * 5) + 1;
      const correct = a + b;

      const options = new Set([correct]);
      while (options.size < 3) options.add(Math.floor(Math.random() * 10) + 1);

      captchaData.set(interaction.user.id, {
        correct,
        attempts: 0,
        expires: Date.now() + Number(process.env.CAPTCHA_EXPIRE_SECONDS) * 1000
      });

      return interaction.reply({
        embeds: [baseEmbed().setTitle('🔐 Verificación').setDescription(`${a} + ${b} = ?`)],
        components: [
          new ActionRowBuilder().addComponents(
            [...options].map(n =>
              new ButtonBuilder()
                .setCustomId(`captcha_${n}`)
                .setLabel(String(n))
                .setStyle(ButtonStyle.Secondary)
            )
          )
        ],
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith('captcha_')) {
      const data = captchaData.get(interaction.user.id);
      if (!data) return interaction.reply({ content: 'Captcha inválido.', ephemeral: true });

      if (Date.now() > data.expires) {
        captchaData.delete(interaction.user.id);
        return interaction.reply({ content: 'Captcha expirado.', ephemeral: true });
      }

      const choice = Number(interaction.customId.split('_')[1]);
      data.attempts++;

      if (choice !== data.correct) {
        if (data.attempts >= Number(process.env.CAPTCHA_MAX_ATTEMPTS)) {
          captchaData.delete(interaction.user.id);
          logVerify(interaction.guild, interaction.user, false, 'Falló captcha');
          return interaction.member.kick('Falló captcha').catch(() => {});
        }
        return interaction.reply({ content: '❌ Incorrecto.', ephemeral: true });
      }

      const verified = interaction.guild.roles.cache.get(process.env.VERIFY_ROLE_ID);
      const unverified = interaction.guild.roles.cache.get(process.env.UNVERIFIED_ROLE_ID);

      await interaction.member.roles.remove(unverified).catch(() => {});
      await interaction.member.roles.add(verified).catch(() => {});
      captchaData.delete(interaction.user.id);

      logVerify(interaction.guild, interaction.user, true, 'Verificado');
      return interaction.reply({ content: '✅ Verificación completada.', ephemeral: true });
    }
  }

  /* ===== SLASH COMMANDS ===== */
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'verificacion') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.reply({ content: '❌ Solo administradores', ephemeral: true });

    if (interaction.channel.id !== process.env.VERIFY_CHANNEL_ID)
      return interaction.reply({ content: '❌ Canal incorrecto', ephemeral: true });

    return interaction.reply({
      embeds: [baseEmbed().setTitle('🔐 Verificación').setDescription('Pulsa el botón para verificarte')],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('start_verify')
            .setLabel('Verificarme')
            .setStyle(ButtonStyle.Success)
        )
      ]
    });
  }

  if (interaction.commandName === 'status') {
    await interaction.deferReply();
    const s = await mc.status(process.env.MC_IP, Number(process.env.MC_PORT));
    return interaction.editReply(`🟢 Online ${s.players.online}/${s.players.max}`);
  }

  if (interaction.commandName === 'players') {
    const s = await mc.status(process.env.MC_IP, Number(process.env.MC_PORT));
    return interaction.reply(
      s.players.sample?.map(p => p.name).join(', ') || 'No hay jugadores'
    );
  }

  if (interaction.commandName === 'version') {
    const s = await mc.status(process.env.MC_IP, Number(process.env.MC_PORT));
    return interaction.reply(`📦 ${s.version.name}`);
  }

  if (interaction.commandName === 'ip') {
    return interaction.reply(`🌐 ${process.env.MC_IP}`);
  }
});

/* =======================
   LOGIN
======================= */
client.login(process.env.DISCORD_TOKEN);
