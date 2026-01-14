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
   HTML ESCAPE (SEGURO)
======================= */
const escapeHTML = t => {
  if (!t || typeof t !== 'string') return '';
  return t
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
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
   CIERRE + LOG HTML
======================= */
async function closeTicket(channel, reason) {
  if (!channel || !channel.guild) return;

  let messages = [];
  let lastId;

  while (true) {
    const fetched = await channel.messages.fetch({ limit: 100, before: lastId });
    if (!fetched.size) break;
    messages.push(...fetched.values());
    lastId = fetched.last().id;
  }

  messages.reverse();

  const html = `
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${channel.name}</title>
<style>
body { background:#0f172a;color:#e5e7eb;font-family:Arial;padding:20px }
.author { color:#38bdf8;font-weight:bold }
.time { color:#94a3b8;font-size:12px }
</style>
</head>
<body>
<h2>${channel.name}</h2>
<p><b>Motivo:</b> ${reason}</p>
<hr>
${messages.map(m => `
<div>
<span class="author">${m.author.tag}</span>
<span class="time">[${new Date(m.createdTimestamp).toLocaleString()}]</span>
<p>${escapeHTML(m.content || '[Adjunto / Embed]')}</p>
</div>
`).join('')}
</body>
</html>`;

  const file = new AttachmentBuilder(Buffer.from(html), {
    name: `${channel.name}.html`
  });

  const logChannel = channel.guild.channels.cache.get(process.env.TICKET_LOG_CHANNEL_ID);
  if (logChannel) {
    await logChannel.send({
      embeds: [baseEmbed().setTitle('📁 Ticket Cerrado').setDescription(reason)],
      files: [file]
    });
  }

  clearTimeout(timeouts.get(channel.id));
  clearTimeout(warnings.get(channel.id));
  await channel.delete().catch(() => {});
}

/* =======================
   PROGRAMAR AUTO CIERRE
======================= */
function scheduleClose(channel) {
  clearTimeout(timeouts.get(channel.id));
  clearTimeout(warnings.get(channel.id));

  warnings.set(channel.id, setTimeout(() => {
    channel.send({
      embeds: [baseEmbed().setTitle('⏰ Inactividad').setDescription(`Se cerrará en ${WARNING} minutos`)]
    }).catch(() => {});
  }, (INACTIVITY - WARNING) * 60000));

  timeouts.set(channel.id, setTimeout(() => {
    closeTicket(channel, '⏰ Ticket cerrado automáticamente por inactividad');
  }, INACTIVITY * 60000));
}

/* =======================
   SLASH COMMANDS
======================= */
const commands = [
  new SlashCommandBuilder().setName('status').setDescription('Estado del servidor'),
  new SlashCommandBuilder().setName('players').setDescription('Jugadores conectados'),
  new SlashCommandBuilder().setName('ip').setDescription('IP del servidor'),
  new SlashCommandBuilder().setName('verificacion').setDescription('Enviar panel de verificación'),
  new SlashCommandBuilder().setName('version').setDescription('Versión del servidor'),
  new SlashCommandBuilder()
    .setName('embed')
    .setDescription('Crear un embed personalizado')
    .addStringOption(o => o.setName('titulo').setDescription('Título').setRequired(true))
    .addStringOption(o => o.setName('descripcion').setDescription('Descripción').setRequired(true)),
  new SlashCommandBuilder().setName('ticket').setDescription('Abrir un ticket de soporte')
].map(c => c.toJSON());

/* =======================
   READY
======================= */
client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
    { body: commands }
  );

  console.log(`✅ ${client.user.tag} listo`);
});

/* =======================
   ANTI ALT
======================= */
client.on('guildMemberAdd', async member => {
  const unverified = member.guild.roles.cache.get(process.env.UNVERIFIED_ROLE_ID);
  if (!unverified) return;

  await member.roles.add(unverified).catch(() => {});

  const minAge = Number(process.env.MIN_ACCOUNT_AGE_DAYS) || 3;
  const age = (Date.now() - member.user.createdTimestamp) / 86400000;

  if (age < minAge) {
    logVerify(member.guild, member.user, false, 'Cuenta demasiado nueva');
    return member.kick('Cuenta demasiado nueva');
  }
});

/* =======================
   RESET INACTIVIDAD
======================= */
client.on('messageCreate', msg => {
  if (!msg.author.bot && msg.channel.name?.startsWith('ticket-')) {
    scheduleClose(msg.channel);
  }
});

/* =======================
   INTERACCIONES
======================= */
client.on('interactionCreate', async interaction => {

  /* ---------- BOTONES ---------- */
  if (interaction.isButton()) {

    if (interaction.customId === 'start_verify') {
      const a = Math.floor(Math.random() * 5) + 1;
      const b = Math.floor(Math.random() * 5) + 1;
      const correct = a + b;

      captchaData.set(interaction.user.id, { correct });

      return interaction.reply({
        embeds: [baseEmbed().setTitle('🔐 Captcha').setDescription(`${a} + ${b} = ?`)],
        components: [
          new ActionRowBuilder().addComponents(
            [correct, correct + 1, correct - 1].map(n =>
              new ButtonBuilder()
                .setCustomId(`captcha_${n}`)
                .setLabel(`${n}`)
                .setStyle(ButtonStyle.Secondary)
            )
          )
        ],
        ephemeral: true
      });
    }

    if (interaction.customId.startsWith('captcha_')) {
      const data = captchaData.get(interaction.user.id);
      if (!data) return;

      const pick = Number(interaction.customId.split('_')[1]);
      if (pick !== data.correct) {
        logVerify(interaction.guild, interaction.user, false, 'Captcha incorrecto');
        return interaction.member.kick();
      }

      await interaction.member.roles.remove(process.env.UNVERIFIED_ROLE_ID);
      await interaction.member.roles.add(process.env.VERIFY_ROLE_ID);

      captchaData.delete(interaction.user.id);
      logVerify(interaction.guild, interaction.user, true, 'Verificado');

      return interaction.reply({ content: '✅ Verificado', ephemeral: true });
    }

    if (interaction.customId.startsWith('ticket_')) {
      const type = interaction.customId.split('_')[1];

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: process.env.TICKET_CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel] },
          { id: process.env.STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel] }
        ]
      });

      await channel.send({
        embeds: [baseEmbed().setTitle('🎫 Ticket Abierto').setDescription(`Categoría: **${type}**`)]
      });

      scheduleClose(channel);
      return interaction.reply({ content: 'Ticket creado', ephemeral: true });
    }
  }

  /* ---------- SLASH ---------- */
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ticket') {

    await interaction.deferReply({ ephemeral: true });

    const row1 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_soporte')
        .setLabel('🛡️ Soporte')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('ticket_bug')
        .setLabel('💀 Reportar Bug')
        .setStyle(ButtonStyle.Secondary)
    );
    
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('ticket_compras')
        .setLabel('🪙 Compras / Donaciones')
        .setStyle(ButtonStyle.Success),
      new ButtonBuilder()
        .setCustomId('ticket_apelacion')
        .setLabel('🫠 Apelaciones')
        .setStyle(ButtonStyle.Danger)
    );

    return interaction.editReply({
      embeds: [
        baseEmbed()
          .setTitle('🎟️ ¿NECESITAS DE NUESTRA AYUDA?')
          .setDescription(
            'Por favor elige una de nuestras opciones para ayuda de un soporte.\n\n' +
            '🛡️ **Soporte** ➜ `Ayuda general discord y minecraft.`\n' +
            '💀 **Bugs** ➜ `Avisar los errores o bugs que encuentras.`\n' +
            '🪙 **Compras** ➜ `Recibir ayuda en la tienda.`\n' +
            '🫠 **Apelaciones** ➜ `Para desbaneos (Evidencia).`'
          )
      ],
      components: [row1, row2]
    });
  }
    
  if (interaction.commandName === 'status') {
    const s = await mc.status(process.env.MC_IP, Number(process.env.MC_PORT));
    return interaction.reply({
      embeds: [baseEmbed().setTitle('🟢 Servidor Online').setDescription(`Jugadores: ${s.players.online}/${s.players.max}`)]
    });
  }

  if (interaction.commandName === 'players') {
    const s = await mc.status(process.env.MC_IP, Number(process.env.MC_PORT));
    return interaction.reply({
      embeds: [baseEmbed().setTitle('👥 Jugadores').setDescription(s.players.sample?.map(p => p.name).join('\n') || 'Nadie')]
    });
  }

  if (interaction.commandName === 'version') {
    const s = await mc.status(process.env.MC_IP, Number(process.env.MC_PORT));
    return interaction.reply({ embeds: [baseEmbed().setTitle('📦 Versión').setDescription(s.version.name)] });
  }

  if (interaction.commandName === 'ip') {
    return interaction.reply({ embeds: [baseEmbed().setTitle('🌐 IP').setDescription(process.env.MC_IP)] });
  }

  if (interaction.commandName === 'verificacion') {
    return interaction.reply({
      embeds: [baseEmbed().setTitle('🔐 Verificación')],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('start_verify').setLabel('Verificarme').setStyle(ButtonStyle.Success)
        )
      ]
    });
  }
});

/* =======================
   LOGIN
======================= */
client.login(process.env.DISCORD_TOKEN);
