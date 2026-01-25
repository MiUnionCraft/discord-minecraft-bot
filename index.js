require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  AttachmentBuilder,
  TextInputStyle
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
const reminderIntervals = new Map();
const slaTimers = new Map();

const INACTIVITY = Number(process.env.TICKET_INACTIVITY_MINUTES) || 1140;
const WARNING = Number(process.env.TICKET_WARNING_MINUTES) || 30;

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
  const sla = slaTimers.get(channel.id);
  if (sla) {
    clearTimeout(sla.staffTimer);
    clearTimeout(sla.adminTimer);
    slaTimers.delete(channel.id);
  }
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
  clearInterval(reminderIntervals.get(channel.id));

  timeouts.delete(channel.id);
  reminderIntervals.delete(channel.id);
  
  await channel.delete().catch(() => {});
}

/* =======================
   PROGRAMAR AUTO CIERRE
======================= */
function scheduleClose(channel, ownerId) {
  clearTimeout(timeouts.get(channel.id));
  clearInterval(reminderIntervals.get(channel.id));

  const interval = setInterval(() => {
    channel.send({
      content: ownerId ? `<@${ownerId}>` : null,
      embeds: [
        baseEmbed()
          .setTitle('⏰ Inactividad detectada')
          .setDescription(
            'Este ticket está inactivo, aún no hay respuesta.\n\n' +
            '🕒 **Si no respondes, se cerrará automáticamente en** `24 horas`**.**'
          .setColor(0xe70000)
          )
      ]
    }).catch(() => {});
  }, 30 * 60 * 1000);

  reminderIntervals.set(channel.id, interval);

  const timeout = setTimeout(() => {
    closeTicket(channel, '⏰ Ticket cerrado automáticamente por inactividad');
  }, 24 * 60 * 60 * 1000);
  
  timeouts.set(channel.id, timeout);
}

function startSLA(channel) {
  const staffMinutes = Number(process.env.SLA_STAFF_MINUTES) || 15;
  const adminMinutes = Number(process.env.SLA_ADMIN_MINUTES) || 60;
  
  const staffTimer = setTimeout(() => {
    channel.send({
      content: `<@&${process.env.STAFF_ROLE_ID}>`,
      embeds: [
        baseEmbed()
          .setTitle('🚨 SLA EN RIESGO')
          .setDescription(
            'Este ticket **no ha sido reclamado**.\n' +
            `⏱️ Tiempo sin atención: **${staffMinutes} minutos**`
          )
          .setColor(0xf97316)
      ]
    }).catch(() => {});
  }, staffMinutes * 60 * 1000);
  const adminTimer = setTimeout(() => {
    channel.send({
      content: `<@&${process.env.ADMIN_ROLE_ID}>`,
      embeds: [
        baseEmbed()
          .setTitle('⛔ SLA INCUMPLIDO')
          .setDescription(
            'Este ticket sigue sin ser atendido.\n' +
            `⏱️ Tiempo total: **${adminMinutes} minutos**`
          )
          .setColor(0xef4444)
      ]
    }).catch(() => {});
  }, adminMinutes * 60 * 1000);
  slaTimers.set(channel.id, { staffTimer, adminTimer });
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
client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  if (!msg.channel.name?.startsWith('ticket-')) return;

  const ownerId = msg.channel.topic?.split('owner:')[1];
  if (!ownerId) return;

  if (msg.author.id === ownerId) {
    scheduleClose(msg.channel, ownerId);
  }
});

client.on('interactionCreate', async interaction => {

  /* =======================
     BOTONES
  ======================= */
  if (interaction.isButton()) {

    /* ===== VERIFICACIÓN ===== */
    if (interaction.customId === 'start_verify') {
      const a = Math.floor(Math.random() * 5) + 1;
      const b = Math.floor(Math.random() * 5) + 1;
      const correct = a + b;

      captchaData.set(interaction.user.id, {
        correct,
        expires: Date.now() + 60000
      });

      return interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('🔐 Captcha')
            .setDescription(`${a} + ${b} = ?`)
        ],
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

    /* ===== CAPTCHA ===== */
    if (interaction.customId.startsWith('captcha_')) {
      const data = captchaData.get(interaction.user.id);
      if (!data)
        return interaction.reply({ content: 'Captcha inválido', ephemeral: true });

      const pick = Number(interaction.customId.split('_')[1]);
      if (pick !== data.correct) {
        logVerify(interaction.guild, interaction.user, false, 'Captcha incorrecto');
        return interaction.member.kick('Falló verificación').catch(() => {});
      }

      const verified = interaction.guild.roles.cache.get(process.env.VERIFY_ROLE_ID);
      const unverified = interaction.guild.roles.cache.get(process.env.UNVERIFIED_ROLE_ID);

      await interaction.member.roles.remove(unverified).catch(() => {});
      await interaction.member.roles.add(verified);

      captchaData.delete(interaction.user.id);
      logVerify(interaction.guild, interaction.user, true, 'Verificado');

      return interaction.reply({ content: '✅ Verificación completada', ephemeral: true });
    }

    /* ===== BOTONES TICKET ===== */
    if (interaction.customId.startsWith('ticket_')) {
      const type = interaction.customId.replace('ticket_', '');

      const modal = new ModalBuilder()
        .setCustomId(`ticket_modal_${type}`)
        .setTitle('🎫 Crear Ticket');

      const nickInput = new TextInputBuilder()
        .setCustomId('mc_nick')
        .setLabel('Nick de Minecraft')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      
      const modeInput = new TextInputBuilder()
        .setCustomId('modalidad')
        .setLabel('Modalidad (Survival, SkyBlock, etc.)')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
      
      modal.addComponents(
        new ActionRowBuilder().addComponents(nickInput),
        new ActionRowBuilder().addComponents(modeInput)
      );
      
      return interaction.showModal(modal);  
    }

    /* ===== RECLAMAR ===== */
    if (interaction.customId === 'reclamar') {

      if (!interaction.member.roles.cache.has(process.env.STAFF_ROLE_ID)) {
        return interaction.reply({
          content: '❌ Solo el staff puede reclamar este ticket',
          ephemeral: true
        });
      }

      const channel = interaction.channel;

      // ❌ Ya reclamado
      if (channel.topic?.includes('staff:')) {
        return interaction.reply({
          content: '⚠️ Este ticket ya fue reclamado',
          ephemeral: true
        });
      }
      // 🧠 Guardar staff en el topic
      const newTopic = `${channel.topic || ''} | staff:${interaction.user.id}`;
      await channel.setTopic(newTopic);

      // ⏱️ Cancelar SLA
      const sla = slaTimers.get(channel.id);
      if (sla) {
        clearTimeout(sla.staffTimer);
        clearTimeout(sla.adminTimer);
        slaTimers.delete(channel.id);
      }

      return interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('✋🏻 Ticket Reclamado')
            .setDescription(
              `👨‍💼 Staff: **${interaction.user.tag}**\n` +
              `🟢 Ya estás siendo atendido.`
            )
            .setColor(0x22c55e)
        ]
      });
    }

    /* ===== CERRAR ===== */
    if (interaction.customId === 'cerrar') {
      return closeTicket(interaction.channel, '🔒 Ticket cerrado por staff');
    }

    return;
  }
  /* =======================
     MODAL SUBMIT
  ======================= */
  if (interaction.isModalSubmit()) {
    
    if (!interaction.customId.startsWith('ticket_modal_')) return;
    
    const type = interaction.customId.replace('ticket_modal_', '');
    const nick = interaction.fields.getTextInputValue('mc_nick');
    const modalidad = interaction.fields.getTextInputValue('modalidad');

    const channel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: process.env.TICKET_CATEGORY_ID,
      topic: `owner:${interaction.user.id} | nick:${nick} | modalidad:${modalidad}`,
      permissionOverwrites: [
        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
        { id: process.env.STAFF_ROLE_ID, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] }
      ]
    });
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('reclamar')
      .setLabel('Reclamar')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId('info_reclamo')
      .setLabel('¿Quién reclamó?')
      .setStyle(ButtonStyle.Secondary),
    
    new ButtonBuilder()
      .setCustomId('info_cierre')
      .setLabel('¿Quién cerró?')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId('cerrar')
      .setLabel('Cerrar')
      .setStyle(ButtonStyle.Danger)
  );
    
    await channel.send({
      content: `<@&${process.env.STAFF_ROLE_ID}>`,
      embeds: [
        baseEmbed()
          .setTitle('🎫 Ticket Abierto')
          .addFields(
            { name: '👤 Usuario', value: `${interaction.user}`, inline: true },
            { name: '🧑 Nick', value: nick, inline: true },
            { name: '🎮 Modalidad', value: modalidad, inline: true },
            { name: '📂 Categoría', value: type }
          )
      ]
      components: [row]
    });

    scheduleClose(channel, interaction.user.id);
    startSLA(channel);
    
    return interaction.reply({
      embeds: [baseEmbed().setDescription('✅ Ticket creado correctamente')],
      ephemeral: true
    });
  }
  /* =======================
     SLASH COMMANDS
  ======================= */
  if (!interaction.isChatInputCommand()) return;

  try {

    /* ===== /ticket ===== */
    if (interaction.commandName === 'ticket') {

      await interaction.deferReply();

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
              'Por favor elige una de nuestras opciones, sé claro y directo con lo que necesitas así nuestro <@&914728126066622545> con gusto te atenderá.\n\n' +
              '🛡️ **Soporte** ➜ `Ayuda general discord y minecraft.`\n' +
              '💀 **Bugs** ➜ `Avisar los errores o bugs que encuentras.`\n' +
              '🪙 **Compras** ➜ `Recibir ayuda en la tienda.`\n' +
              '🫠 **Apelaciones** ➜ `Para desbaneos (Evidencia).`'
            )
        ],
        components: [row1, row2]
      });
    }

    /* ===== /verificacion ===== */
    if (interaction.commandName === 'verificacion') {
      if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
        return interaction.reply({
          content: '❌ Solo administradores',
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('🔐 Verificación')
            .setDescription('Hola querido usuario, este es nuestro sistema de verificación, antes de que todos los canales sean activados, necesitamos que presiones el botón para interactuar en nuestra comunidad.')
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId('start_verify')
              .setLabel('🤖 Verificarme')
              .setStyle(ButtonStyle.Success)
          )
        ]
      });
    }

    /* ===== /status ===== */
    if (interaction.commandName === 'status') {
      const s = await mc.status(
        process.env.MC_IP,
        Number(process.env.MC_PORT)
      );

      return interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('🟢 Servidor Online')
            .setDescription(`Jugadores: **${s.players.online}/${s.players.max}**`)
            .setColor(0x22c55e)
        ]
      });
    }

    /* ===== /players ===== */
    if (interaction.commandName === 'players') {
      const s = await mc.status(
        process.env.MC_IP,
        Number(process.env.MC_PORT)
      );

      return interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('👥 Jugadores Conectados')
            .setDescription(
              s.players.sample?.map(p => `• ${p.name}`).join('\n') ||
              'No hay jugadores conectados'
            )
        ]
      });
    }

    /* ===== /version ===== */
    if (interaction.commandName === 'version') {
      const s = await mc.status(
        process.env.MC_IP,
        Number(process.env.MC_PORT)
      );

      return interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('📦 Versión')
            .setDescription(
              '`1.16.5 - 1.21.5`' +
              '\n\n**Recomendado:** `1.20.4`\n'
            )
        ]
      });
    }

    /* ===== /ip ===== */
    if (interaction.commandName === 'ip') {
      return interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle('🌐 IP del Servidor')
            .setDescription(
              '`play.miunioncraft.com`'
            )
        ]
      });
    }

    /* ===== /embed ===== */
    if (interaction.commandName === 'embed') {
      if (!interaction.member.roles.cache.has(process.env.STAFF_ROLE_ID)) {
        return interaction.reply({
          embeds: [
            baseEmbed()
              .setDescription('❌ No autorizado')
              .setColor(0xef4444)
          ],
          ephemeral: true
        });
      }

      return interaction.reply({
        embeds: [
          baseEmbed()
            .setTitle(interaction.options.getString('titulo'))
            .setDescription(interaction.options.getString('descripcion'))
        ]
      });
    }

  } catch (err) {
    console.error(err);
    if (interaction.replied || interaction.deferred) {
      interaction.editReply({
        embeds: [
          baseEmbed()
            .setDescription('❌ Ocurrió un error')
            .setColor(0xef4444)
        ]
      });
    }
  }
});

/* =======================
   LOGIN
======================= */
client.login(process.env.DISCORD_TOKEN);
