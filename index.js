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
body {
  background:#0f172a;
  color:#e5e7eb;
  font-family:Arial, sans-serif;
  padding:20px;
}
h2 { color:#38bdf8; }
hr {
  border:1px solid #1e293b;
  margin:15px 0;
}
.msg { margin-bottom:12px; }
.author { color:#38bdf8; font-weight:bold; }
.time { color:#94a3b8; font-size:12px; }
.content { margin-left:5px; }
</style>
</head>
<body>

<h2>🎫 ${channel.name}</h2>
<p><b>Servidor:</b> ${channel.guild.name}</p>
<p><b>Motivo de cierre:</b> ${reason}</p>
<hr>

${messages.map(m => {
  let content = '';

  if (m.content) {
    content = escapeHTML(m.content);
  } else if (m.embeds.length) {
    content = `<i>[Embed: ${escapeHTML(m.embeds[0].title || 'Sin título')}]</i>`;
  } else if (m.attachments.size) {
    content = '<i>[Archivo adjunto]</i>';
  } else {
    content = '<i>[Mensaje vacío]</i>';
  }

  return `
  <div class="msg">
    <span class="author">${m.author.tag}</span>
    <span class="time">[${new Date(m.createdTimestamp).toLocaleString('es-ES', { hour12: true })}]</span><br>
    <span class="content">${content}</span>
  </div>`;
}).join('')}

</body>
</html>`;

  const file = new AttachmentBuilder(Buffer.from(html, 'utf8'), {
    name: `${channel.name}.html`
  });

  const logChannel = channel.guild.channels.cache.get(process.env.TICKET_LOG_CHANNEL_ID);
  if (logChannel) {
    await logChannel.send({
      embeds: [
        baseEmbed()
          .setTitle('📁 Ticket Cerrado')
          .setDescription(reason)
          .setColor(0xef4444)
      ],
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
      embeds: [
        baseEmbed()
          .setTitle('⏰ Inactividad Detectada')
          .setDescription(`Este ticket se cerrará en **${WARNING} minutos** si no hay actividad.`)
          .setColor(0xfacc15)
      ]
    }).catch(() => {});
  }, (INACTIVITY - WARNING) * 60 * 1000));

  timeouts.set(channel.id, setTimeout(() => {
    closeTicket(channel, '⏰ Ticket cerrado automáticamente por inactividad');
  }, INACTIVITY * 60 * 1000));
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
  new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Abrir un ticket de soporte')
].map(c => c.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

/* =======================
   READY
======================= */
client.once('clientReady', async () => {
  await rest.put(
    Routes.applicationCommands(client.user.id),
    { body: commands }
  );
  console.log(`✅ ${client.user.tag} listo`);
});

/* =======================
   ANTI-ALT + BLOQUEO
======================= */
client.on('guildMemberAdd', async member => {
  const unverified = member.guild.roles.cache.get(process.env.UNVERIFIED_ROLE_ID);
  if (!unverified) return;

  await member.roles.add(unverified).catch(() => {});

  const minAge = Number(process.env.MIN_ACCOUNT_AGE_DAYS) || 3;
  const age = (Date.now() - member.user.createdTimestamp) / 86400000;

  if (age < minAge) {
    logVerify(member.guild, member.user, false, 'Cuenta nueva');
    return member.kick('Cuenta demasiado nueva');
  }

  setTimeout(async () => {
    if (member.roles.cache.has(unverified.id)) {
      logVerify(member.guild, member.user, false, 'No se verificó a tiempo');
      await member.kick('No se verificó a tiempo').catch(() => {});
    }
  }, (Number(process.env.VERIFY_TIMEOUT_MINUTES) || 10) * 60000);
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

  if (interaction.isButton()) {

    if (interaction.customId.startsWith('ticket_')) {
      const type = interaction.customId.split('_')[1];

      const channel = await interaction.guild.channels.create({
        name: `ticket-${interaction.user.username}`,
        type: ChannelType.GuildText,
        parent: process.env.TICKET_CATEGORY_ID,
        permissionOverwrites: [
          { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
          { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
          { id: process.env.STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
        ]
      });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('reclamar').setLabel('✋🏻 Reclamar').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('cerrar').setLabel('🔒 Cerrar').setStyle(ButtonStyle.Danger)
      );

      await channel.send({
        embeds: [
          baseEmbed()
            .setTitle('🎫 Ticket Abierto')
            .setDescription(`Categoría: **${type}**\nUn miembro del staff te atenderá pronto.`)
        ],
        components: [row]
      });

      scheduleClose(channel);
      return interaction.reply({ embeds: [baseEmbed().setDescription('✅ Ticket creado correctamente')], ephemeral: true });
    }

    if (interaction.customId === 'reclamar') {
      if (!interaction.member.roles.cache.has(process.env.STAFF_ROLE_ID))
        return interaction.reply({ embeds: [baseEmbed().setDescription('❌ Solo el staff puede reclamar').setColor(0xef4444)], ephemeral: true });

      return interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('✋🏻 Ticket Reclamado')
            .setDescription(`Este ticket ha sido reclamado por **${interaction.user.tag}**`)
        ]
      });
    }

    if (interaction.customId === 'cerrar') {
      return closeTicket(interaction.channel, '🔒 Ticket cerrado manualmente por el staff');
    }
  }

  if (!interaction.isChatInputCommand()) return;

  try {

    if (interaction.commandName === 'ticket') {

      const row1 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_soporte').setLabel('🛡️ Soporte').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('ticket_bug').setLabel('💀 Reportar Bug').setStyle(ButtonStyle.Secondary)
      );

      const row2 = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('ticket_compras').setLabel('🪙 Compras / Donaciones').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('ticket_apelacion').setLabel('🫠 Apelaciones').setStyle(ButtonStyle.Danger)
      );

      return interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle('🎟️ ¿NECESITAS DE NUESTRA AYUDA?')
            .setDescription(
              'Por favor elige una de nuestras opciones para ayuda de un soporte con la etiqueta <@&661210250598154250> pronto serás atendido.\n\n' +
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
      return interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle('🟢 Servidor Online')
            .setDescription(`Jugadores: **${s.players.online}/${s.players.max}**`)
            .setColor(0x22c55e)
        ]
      });
    }

    if (interaction.commandName === 'players') {
      const s = await mc.status(process.env.MC_IP, Number(process.env.MC_PORT));
      return interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle('👥 Jugadores Conectados')
            .setDescription(s.players.sample?.map(p => `• ${p.name}`).join('\n') || 'No hay jugadores conectados')
        ]
      });
    }

    if (interaction.commandName === 'version') {
      const s = await mc.status(process.env.MC_IP, Number(process.env.MC_PORT));
      return interaction.editReply({
        embeds: [baseEmbed().setTitle('📦 Versión').setDescription(s.version.name)]
      });
    }

    if (interaction.commandName === 'ip') {
      return interaction.editReply({
        embeds: [baseEmbed().setTitle('🌐 IP del Servidor').setDescription(process.env.MC_IP)]
      });
    }

    if (interaction.commandName === 'embed') {
      if (!interaction.member.roles.cache.has(process.env.STAFF_ROLE_ID))
        return interaction.editReply({ embeds: [baseEmbed().setDescription('❌ No autorizado').setColor(0xef4444)] });

      return interaction.editReply({
        embeds: [
          baseEmbed()
            .setTitle(interaction.options.getString('titulo'))
            .setDescription(interaction.options.getString('descripcion'))
        ]
      });
    }

  } catch (e) {
    console.error(e);
    interaction.editReply({
      embeds: [baseEmbed().setDescription('❌ Ocurrió un error').setColor(0xef4444)]
    });
  }

  if (interaction.isButton()) {

    if (interaction.customId === 'start_verify') {

      const now = Date.now();
      const cd = verifyCooldown.get(interaction.user.id);
      if (cd && now - cd < Number(process.env.VERIFY_COOLDOWN_SECONDS) * 1000)
        return interaction.reply({ content: '⏳ Espera un momento.', ephemeral: true });

      verifyCooldown.set(interaction.user.id, now);

      const a = Math.floor(Math.random() * 5) + 1;
      const b = Math.floor(Math.random() * 5) + 1;
      const correct = a + b;

      const opts = new Set([correct]);
      while (opts.size < 3) opts.add(Math.floor(Math.random() * 10) + 1);

      captchaData.set(interaction.user.id, {
        correct,
        attempts: 0,
        expires: Date.now() + Number(process.env.CAPTCHA_EXPIRE_SECONDS) * 1000
      });

      return interaction.reply({
        embeds: [baseEmbed().setTitle('Captcha').setDescription(`${a} + ${b} = ?`)],
        components: [
          new ActionRowBuilder().addComponents(
            [...opts].map(n =>
              new ButtonBuilder().setCustomId(`captcha_${n}`).setLabel(`${n}`).setStyle(ButtonStyle.Secondary)
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

      const pick = Number(interaction.customId.split('_')[1]);
      data.attempts++;

      if (pick !== data.correct) {
        if (data.attempts >= Number(process.env.CAPTCHA_MAX_ATTEMPTS)) {
          captchaData.delete(interaction.user.id);
          logVerify(interaction.guild, interaction.user, false, 'Falló captcha');
          return interaction.member.kick('Falló captcha').catch(() => {});
        }
        return interaction.reply({ content: 'Incorrecto.', ephemeral: true });
      }

      const verified = interaction.guild.roles.cache.get(process.env.VERIFY_ROLE_ID);
      const unverified = interaction.guild.roles.cache.get(process.env.UNVERIFIED_ROLE_ID);

      await interaction.member.roles.remove(unverified).catch(() => {});
      await interaction.member.roles.add(verified);
      captchaData.delete(interaction.user.id);

      logVerify(interaction.guild, interaction.user, true, 'Verificado');

      return interaction.reply({ content: '✅ Verificación completada.', ephemeral: true });
    }
  }

  if (!interaction.isChatInputCommand()) return;
  await interaction.deferReply({ ephemeral: true });

  if (interaction.commandName === 'verificacion') {
    if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return interaction.editReply('❌ Solo administradores');

    if (interaction.channel.id !== process.env.VERIFY_CHANNEL_ID)
      return interaction.editReply('❌ Canal incorrecto');

    return interaction.editReply({
      embeds: [baseEmbed().setTitle('🔐 Verificación').setDescription('Pulsa para verificarte')],
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
