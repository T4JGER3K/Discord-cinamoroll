const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionsBitField,
  ActivityType
} = require('discord.js');
const sqlite3 = require('sqlite3').verbose();

// Inicjalizacja klienta – wymagane intencje dla wiadomości, reakcji, zdarzeń głosowych oraz zarządzania członkami
const client = new Client({
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers
  ]
});

// Inicjalizacja bazy SQLite
const db = new sqlite3.Database('./logChannels.db', (err) => {
  if (err) {
    console.error('Błąd połączenia z bazą danych:', err.message);
  } else {
    console.log('Połączono z bazą danych.');
    initDatabase();
  }
});

// Funkcja migracyjna – tworzymy tabele i dodajemy kolumnę changeChannelId, jeśli nie istnieje
function initDatabase() {
  db.run(
    `CREATE TABLE IF NOT EXISTS logChannels (
      guildId TEXT PRIMARY KEY,
      textChannelId TEXT,
      editChannelId TEXT,
      voiceChannelId TEXT
    )`,
    (err) => {
      if (err) console.error('Błąd przy tworzeniu tabeli:', err.message);
      else migrateLogChannels();
    }
  );
  db.run(
    `CREATE TABLE IF NOT EXISTS customEmbeds (
      guildId TEXT,
      embedName TEXT,
      embedTitle TEXT,
      embedContent TEXT,
      PRIMARY KEY (guildId, embedName)
    )`,
    (err) => {
      if (err) console.error('Błąd przy tworzeniu tabeli customEmbeds:', err.message);
    }
  );
}

function migrateLogChannels() {
  db.all(`PRAGMA table_info(logChannels)`, (err, rows) => {
    if (err) {
      console.error('Błąd przy pobieraniu informacji o tabeli:', err.message);
      return;
    }
    const hasChangeColumn = rows.some(row => row.name === 'changeChannelId');
    if (!hasChangeColumn) {
      db.run(`ALTER TABLE logChannels ADD COLUMN changeChannelId TEXT`, (err) => {
        if (err) console.error('Błąd przy migracji tabeli (dodawanie changeChannelId):', err.message);
        else console.log('Migracja zakończona – kolumna changeChannelId została dodana.');
      });
    } else {
      console.log('Migracja: kolumna changeChannelId już istnieje.');
    }
  });
}

/**
 * Pobiera ustawienia kanałów logów dla danego serwera.
 * Zwraca obiekt { textChannelId, editChannelId, voiceChannelId, changeChannelId } lub null.
 */
function getLogChannels(guildId, callback) {
  db.get(
    'SELECT textChannelId, editChannelId, voiceChannelId, changeChannelId FROM logChannels WHERE guildId = ?',
    [guildId],
    (err, row) => {
      if (err) {
        console.error('Błąd przy pobieraniu kanałów logów:', err.message);
        return callback(null);
      }
      if (!row) return callback(null);
      callback({
        textChannelId: row.textChannelId,
        editChannelId: row.editChannelId,
        voiceChannelId: row.voiceChannelId,
        changeChannelId: row.changeChannelId
      });
    }
  );
}

/**
 * Zapisuje ustawienia kanałów logów dla danego serwera.
 * logType: 'text', 'edit', 'voice' lub 'change'
 */
function setLogChannel(guildId, channelId, logType, callback) {
  getLogChannels(guildId, (settings) => {
    let textId = settings ? settings.textChannelId : null;
    let editId = settings ? settings.editChannelId : null;
    let voiceId = settings ? settings.voiceChannelId : null;
    let changeId = settings ? settings.changeChannelId : null;

    if (logType === 'text') textId = channelId;
    if (logType === 'edit') editId = channelId;
    if (logType === 'voice') voiceId = channelId;
    if (logType === 'change') changeId = channelId;

    db.run(
      'INSERT OR REPLACE INTO logChannels (guildId, textChannelId, editChannelId, voiceChannelId, changeChannelId) VALUES (?, ?, ?, ?, ?)',
      [guildId, textId, editId, voiceId, changeId],
      (err) => {
        if (err) {
          console.error('Błąd przy zapisie kanału logów:', err.message);
          return callback(false);
        }
        callback(true);
      }
    );
  });
}

/**
 * Funkcja wysyłająca logi tekstowe (dla zdarzeń wiadomości, timeoutów)
 */
function sendTextLog(guild, logPayload) {
  getLogChannels(guild.id, (settings) => {
    if (settings && settings.textChannelId) {
      guild.channels
        .fetch(settings.textChannelId)
        .then(channel => {
          if (channel && channel.isTextBased()) {
            channel.send(logPayload).catch(err => console.error("Błąd przy wysyłaniu logu tekstowego:", err));
          } else {
            console.error("Kanał logów tekstowych nie został znaleziony lub nie jest tekstowy.");
          }
        })
        .catch(err => console.error("Błąd przy pobieraniu kanału logów tekstowych:", err));
    }
  });
}

/**
 * Funkcja wysyłająca logi głosowe (dla zdarzeń kanałów głosowych)
 */
function sendVoiceLog(guild, embed) {
  getLogChannels(guild.id, (settings) => {
    if (settings && settings.voiceChannelId) {
      guild.channels
        .fetch(settings.voiceChannelId)
        .then(channel => {
          if (channel && channel.isTextBased()) {
            channel.send({ embeds: [embed] }).catch(err => console.error("Błąd przy wysyłaniu logu głosowego:", err));
          } else {
            console.error("Kanał logów głosowych nie został znaleziony lub nie jest tekstowy.");
          }
        })
        .catch(err => console.error("Błąd przy pobieraniu kanału logów głosowych:", err));
    }
  });
}

/**
 * Funkcja wysyłająca logi zmian (dla zdarzeń change)
 */
function sendChangeLog(guild, embed) {
  getLogChannels(guild.id, (settings) => {
    if (settings && settings.changeChannelId) {
      guild.channels
        .fetch(settings.changeChannelId)
        .then(channel => {
          if (channel && channel.isTextBased()) {
            channel.send({ embeds: [embed] }).catch(err => console.error("Błąd przy wysyłaniu logu zmian:", err));
          } else {
            console.error("Kanał logów zmian nie został znaleziony lub nie jest tekstowy.");
          }
        })
        .catch(err => console.error("Błąd przy pobieraniu kanału logów zmian:", err));
    }
  });
}

client.once('ready', () => {
  client.user.setPresence({
    activities: [{
      name: 'cinamoinka',
      type: ActivityType.Streaming,
      url: 'https://www.twitch.tv/cinamoinka'
    }],
    status: 'online'
  });
  console.log(`Zalogowano jako ${client.user.tag}!`);
});

//
// OBSŁUGA KOMEND (ping, help, embed, log, clear, create embed, delete embed)
//

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  // !ping
  if (message.content === '!ping') {
    return message.channel.send('Pong!');
  }

  // !help – wyświetla komendy
  if (message.content === '!help') {
    const helpEmbed = new EmbedBuilder()
      .setColor('#1abc9c')
      .setTitle('Komendy Bota')
      .setDescription('Dostępne komendy:')
      .addFields(
        { name: '**!ping**', value: 'Sprawdź, czy bot działa.' },
        { name: '**!embed**', value: 'Wyświetla embedy. Użyj: `!embed nazwa`.\nDostępne typy: regulamin, role, opis oraz niestandardowe embedy.' },
        { name: '**!log**', value: 'Ustaw kanał logów (text, edit, voice, change).' }
      );
    if (message.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
      helpEmbed.addFields(
        { name: '**!clear <liczba>**', value: 'Usuń wiadomości na kanale.' },
        { name: '**!create embed**', value: 'Tworzy niestandardowy embed (przez serię pytań).' },
        { name: '**!delete embed nazwa**', value: 'Usuwa niestandardowy embed.' }
      );
    }
    helpEmbed.setFooter({ text: '© tajgerek' });
    return message.channel.send({ embeds: [helpEmbed] });
  }

  // !create embed – tworzenie niestandardowego embeda (tylko admin)
  if (message.content === '!create embed') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('Tylko administratorzy mogą tworzyć embedy.');
    const filter = m => m.author.id === message.author.id;
    message.channel.send('Podaj nazwę embeda:').then(() => {
      message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] })
      .then(collectedName => {
        const embedName = collectedName.first().content.trim();
        message.channel.send('Podaj tytuł embeda:').then(() => {
          message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] })
          .then(collectedTitle => {
            const embedTitle = collectedTitle.first().content.trim();
            message.channel.send('Podaj treść embeda:').then(() => {
              message.channel.awaitMessages({ filter, max: 1, time: 30000, errors: ['time'] })
              .then(collectedContent => {
                const embedContent = collectedContent.first().content.trim();
                db.run(
                  'INSERT OR REPLACE INTO customEmbeds (guildId, embedName, embedTitle, embedContent) VALUES (?, ?, ?, ?)',
                  [message.guild.id, embedName, embedTitle, embedContent],
                  function(err) {
                    if (err) {
                      console.error('Błąd przy tworzeniu embeda:', err.message);
                      return message.channel.send('Wystąpił błąd przy tworzeniu embeda.');
                    }
                    message.channel.send(`Embed o nazwie **${embedName}** został utworzony!`);
                  }
                );
              }).catch(() => {
                message.channel.send('Nie otrzymano treści embeda. Anulowano tworzenie.');
              });
            });
          }).catch(() => {
            message.channel.send('Nie otrzymano tytułu embeda. Anulowano tworzenie.');
          });
        });
      }).catch(() => {
        message.channel.send('Nie otrzymano nazwy embeda. Anulowano tworzenie.');
      });
    });
    return;
  }

  // !delete embed nazwa – usuwanie niestandardowego embeda (tylko admin)
  if (message.content.startsWith('!delete embed')) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('Tylko administratorzy mogą usuwać embedy.');
    const args = message.content.split(' ');
    if (args.length < 3) return message.channel.send('Podaj nazwę embeda do usunięcia.');
    const embedName = args.slice(2).join(' ').trim();
    db.run(
      'DELETE FROM customEmbeds WHERE guildId = ? AND embedName = ?',
      [message.guild.id, embedName],
      function(err) {
        if (err) {
          console.error(err.message);
          return message.channel.send('Wystąpił błąd przy usuwaniu embeda.');
        }
        if (this.changes === 0) {
          return message.channel.send(`Nie znaleziono embeda o nazwie **${embedName}**.`);
        }
        message.channel.send(`Embed o nazwie **${embedName}** został usunięty.`);
      }
    );
    return;
  }

  // Predefiniowane komendy – regulamin, opis, role
  if (message.content === '!embed regulamin') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('Tylko administratorzy mogą używać tej komendy.');
    const regulaminEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('REGULAMIN SERWERA DISCORD')
      .setDescription('Zasady korzystania z naszego serwera. Prosimy o ich przestrzeganie!')
      .addFields(
        {
          name: '**1. Zasady ogólne**',
          value: '1.1. Szanuj innych – Nie tolerujemy hejtu, wyzywania, obrażania ani dyskryminacji.\n' +
                 '1.2. Nie spamuj – Unikaj floodowania wiadomościami, używania capslocka i niepotrzebnego pingowania.\n' +
                 '1.3. Trzymaj się tematu – Rozmawiamy na tematy związane z serwerem i transmisją.\n' +
                 '1.4. Zakaz NSFW – Żadne treści dla dorosłych.\n' +
                 '1.5. Zakaz reklamy – Nie promuj innych serwerów, kanałów czy treści bez zgody administracji.',
          inline: false
        },
        {
          name: '**2. Zachowanie na streamach**',
          value: '2.1. Bądź miły/a dla streamerki – Zachowuj się kulturalnie i szanuj osobę prowadzącą transmisję.\n' +
                 '2.2. Nie spoileruj – Szanuj doświadczenie innych widzów, nie zdradzaj fabuły.\n' +
                 '2.3. Nie narzucaj tematów – Streamerka decyduje o tym, o czym rozmawiamy.',
          inline: false
        },
        {
          name: '**3. Kanały głosowe**',
          value: '3.1. Nie przeszkadzaj – Unikaj puszczania głośnych dźwięków, muzyki czy trollowania.\n' +
                 '3.2. Dbaj o jakość dźwięku – Używaj dobrego mikrofonu, aby rozmowa była czysta i zrozumiała.',
          inline: false
        },
        {
          name: '**4. Kary i ostrzeżenia**',
          value: '4.1. Administracja ma prawo do wydawania ostrzeżeń, mute, kicka lub bana za złamanie regulaminu.\n' +
                 '4.2. Jeśli masz problem, zgłoś go do administracji.',
          inline: false
        }
      )
      .setFooter({ text: '© tajgerek' });
    const sentMessage = await message.channel.send({ embeds: [regulaminEmbed] });
    try {
      await sentMessage.react('✅');
    } catch (error) {
      console.error("Nie udało się dodać reakcji ✅", error);
    }
    return;
  }

  if (message.content === '!embed opis') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('Tylko administratorzy mogą używać tej komendy.');
    let channelsList = '';
    message.guild.channels.cache.forEach(ch => {
      if (ch.type === 0 && ch.viewable && ch.parentId !== '1348705959131742269') {
        const shortDescription = ch.topic ? ch.topic : 'Brak opisu';
        channelsList += `<#${ch.id}> - ${shortDescription}\n\n`;
      }
    });
    const opisEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Lista Kanałów')
      .setDescription(channelsList || 'Brak dostępnych kanałów.')
      .setFooter({ text: '© tajgerek' });
    return message.channel.send({ embeds: [opisEmbed] });
  }

  if (message.content === '!embed role') {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('Tylko administratorzy mogą używać tej komendy.');
    const roleEmbed = new EmbedBuilder()
      .setColor('#0099ff')
      .setTitle('Role Reaction')
      .setDescription(
        `<:radiant_valorant:1350175816314650654> - <@&1349830365761769532>\n` +
        `<:immortal_valorant:1350175814456709322> - <@&1350176656631005184>\n` +
        `<:ascendant_valorant:1350175817962881034> - <@&1350633930730242178>\n` +
        `<:diamond_valorant:1350175812929720430> - <@&1350633934047940719>\n` +
        `<:platinum_valorant:1350175819359715533> - <@&1350633936903995472>\n` +
        `<:gold_valorant:1350175808253329538> - <@&1350633938661670953>\n` +
        `<:silver_valorant:1350175811147141315> - <@&1350633940079214665>\n` +
        `<:bronze_valorant:1350175809901559919> - <@&1350633970684919921>\n` +
        `<:iron_valorant:1350175806596321380> - <@&1350634082186428436>`
      )
      .setFooter({ text: '© tajgerek' });
    const sentMessage = await message.channel.send({ embeds: [roleEmbed] });
    const reactionEmojiMap = [
      "<:radiant_valorant:1350175816314650654>",
      "<:immortal_valorant:1350175814456709322>",
      "<:ascendant_valorant:1350175817962881034>",
      "<:diamond_valorant:1350175812929720430>",
      "<:platinum_valorant:1350175819359715533>",
      "<:gold_valorant:1350175808253329538>",
      "<:silver_valorant:1350175811147141315>",
      "<:bronze_valorant:1350175809901559919>",
      "<:iron_valorant:1350175806596321380>"
    ];
    for (const emoji of reactionEmojiMap) {
      try {
        await sentMessage.react(emoji);
      } catch (error) {
        console.error("Nie udało się dodać reakcji", emoji, error);
      }
    }
    return;
  }

  // Ogólna komenda !embed dla niestandardowych embedów – pomijamy predefiniowane nazwy
  if (message.content.startsWith('!embed')) {
    let args = message.content.slice('!embed'.length).trim();
    if (['regulamin', 'opis', 'role'].includes(args.toLowerCase())) return;
    if (!args) return message.channel.send('Podaj nazwę embeda.');
    const embedName = args;
    db.get(
      'SELECT embedTitle, embedContent FROM customEmbeds WHERE guildId = ? AND embedName = ?',
      [message.guild.id, embedName],
      (err, row) => {
        if (err) {
          console.error(err.message);
          return message.channel.send('Wystąpił błąd przy pobieraniu embeda.');
        }
        if (!row) return message.channel.send(`Embed o nazwie **${embedName}** nie został znaleziony.`);
        const customEmbed = new EmbedBuilder()
          .setTitle(row.embedTitle)
          .setDescription(row.embedContent)
          .setFooter({ text: '© tajgerek' });
        message.channel.send({ embeds: [customEmbed] });
      }
    );
    return;
  }

  // !log – ustawianie kanału logów (text, edit, voice, change)
  if (message.content.startsWith('!log')) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('Tylko administratorzy mogą ustawiać kanał logów.');
    const args = message.content.split(' ');
    if (args.length < 3)
      return message.reply('Podaj kanał oraz typ logów. Np. !log #log-channel text');
    const channel = message.mentions.channels.first() || message.guild.channels.cache.get(args[1]);
    const logType = args[2].toLowerCase();
    if (!channel || !['text', 'edit', 'voice', 'change'].includes(logType))
      return message.reply('Podaj prawidłowy kanał oraz typ logów (text, edit, voice, change).');
    setLogChannel(message.guild.id, channel.id, logType, (success) => {
      if (success) {
        message.reply(`Kanał logów typu **${logType}** został ustawiony na ${channel}.`);
      } else {
        message.reply('Wystąpił błąd podczas ustawiania kanału logów.');
      }
    });
  }

  // !clear – usuwanie wiadomości (tylko admin)
  if (message.content.startsWith('!clear')) {
    if (!message.member.permissions.has(PermissionsBitField.Flags.Administrator))
      return message.reply('Nie masz uprawnień do usuwania wiadomości.');
    const args = message.content.split(' ');
    const amount = parseInt(args[1]);
    if (isNaN(amount) || amount <= 0 || amount > 100)
      return message.reply('Podaj liczbę wiadomości do usunięcia (od 1 do 100).');
    try {
      const deletedMessages = await message.channel.bulkDelete(amount, true);
      const infoMsg = await message.channel.send(`Usunięto ${deletedMessages.size} wiadomości.`);
      setTimeout(() => infoMsg.delete().catch(() => {}), 5000);
    } catch (err) {
      console.error('Błąd przy usuwaniu wiadomości:', err);
      message.reply('Wystąpił błąd przy usuwaniu wiadomości.');
    }
  }
});

//
// OBSŁUGA REAKCJI – przypisywanie ról
//
const reactionRoleMap = {
  "1350175816314650654": "1349830365761769532", // Radiant
  "1350175814456709322": "1350176656631005184", // Immortal
  "1350175817962881034": "1350633930730242178", // Ascendant
  "1350175812929720430": "1350633934047940719", // Diamond
  "1350175819359715533": "1350633936903995472", // Platinum
  "1350175808253329538": "1350633938661670953", // Gold
  "1350175811147141315": "1350633940079214665", // Silver
  "1350175809901559919": "1350633970684919921", // Bronze
  "1350175806596321380": "1350634082186428436"  // Iron
};

client.on('messageReactionAdd', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Nie udało się pobrać reakcji:', error);
      return;
    }
  }
  if (!reaction.message.guild) return;
  
  // Obsługa roli na podstawie mapy dla innych emoji
  const roleId = reactionRoleMap[reaction.emoji.id];
  if (roleId) {
    try {
      const member = await reaction.message.guild.members.fetch(user.id);
      if (!member.roles.cache.has(roleId)) {
        await member.roles.add(roleId);
        console.log(`Dodano rolę (${roleId}) użytkownikowi ${user.tag}`);
      }
    } catch (error) {
      console.error('Błąd przy dodawaniu roli:', error);
    }
  }
  
  // Dodatkowa obsługa dla regulaminu – emoji ✅
  if (reaction.emoji.name === '✅') {
    const embeds = reaction.message.embeds;
    if (embeds.length && embeds[0].title === 'REGULAMIN SERWERA DISCORD') {
      try {
        const member = await reaction.message.guild.members.fetch(user.id);
        if (!member.roles.cache.has('1348705958213456004')) {
          await member.roles.add('1348705958213456004');
          console.log(`Dodano rolę (1348705958213456004) użytkownikowi ${user.tag} za reakcję ✅`);
        }
      } catch (error) {
        console.error('Błąd przy dodawaniu roli regulamin:', error);
      }
    }
  }
});

client.on('messageReactionRemove', async (reaction, user) => {
  if (user.bot) return;
  if (reaction.partial) {
    try {
      await reaction.fetch();
    } catch (error) {
      console.error('Nie udało się pobrać reakcji:', error);
      return;
    }
  }
  if (!reaction.message.guild) return;
  
  const roleId = reactionRoleMap[reaction.emoji.id];
  if (roleId) {
    try {
      const member = await reaction.message.guild.members.fetch(user.id);
      if (member.roles.cache.has(roleId)) {
        await member.roles.remove(roleId);
        console.log(`Usunięto rolę (${roleId}) użytkownikowi ${user.tag}`);
      }
    } catch (error) {
      console.error('Błąd przy usuwaniu roli:', error);
    }
  }
  
  if (reaction.emoji.name === '✅') {
    const embeds = reaction.message.embeds;
    if (embeds.length && embeds[0].title === 'REGULAMIN SERWERA DISCORD') {
      try {
        const member = await reaction.message.guild.members.fetch(user.id);
        if (member.roles.cache.has('1348705958213456004')) {
          await member.roles.remove('1348705958213456004');
          console.log(`Usunięto rolę (1348705958213456004) użytkownikowi ${user.tag} po usunięciu reakcji ✅`);
        }
      } catch (error) {
        console.error('Błąd przy usuwaniu roli regulamin:', error);
      }
    }
  }
});

//
// OBSŁUGA ZDARZEŃ – zmiany na serwerze (change)
//

// --- Role ---

// roleCreate: logujemy utworzenie nowej roli
client.on('roleCreate', async (role) => {
  if (!role.guild) return;
  const embed = new EmbedBuilder()
    .setTitle('Utworzono rolę')
    .setColor('#2ecc71')
    .setDescription(`Nowa rola **${role.name}** została utworzona.\nKolor: ${role.hexColor}\nUprawnienia: ${role.permissions.toArray().join(', ') || 'Brak'}`)
    .setTimestamp();
  sendChangeLog(role.guild, embed);
});

// roleDelete: logujemy usunięcie roli
client.on('roleDelete', async (role) => {
  if (!role.guild) return;
  const embed = new EmbedBuilder()
    .setTitle('Usunięto rolę')
    .setColor('#e74c3c')
    .setDescription(`Rola **${role.name}** została usunięta.`)
    .setTimestamp();
  sendChangeLog(role.guild, embed);
});

// roleUpdate: logujemy zmiany w roli – nazwę, kolor i uprawnienia
client.on('roleUpdate', async (oldRole, newRole) => {
  if (!newRole.guild) return;
  let changes = [];
  if (oldRole.name !== newRole.name) {
    changes.push(`Nazwa zmieniona z "${oldRole.name}" na "${newRole.name}"`);
  }
  if (oldRole.color !== newRole.color) {
    changes.push(`Kolor zmieniony z "${oldRole.hexColor}" na "${newRole.hexColor}"`);
  }
  const oldPerms = oldRole.permissions.toArray();
  const newPerms = newRole.permissions.toArray();
  const addedPerms = newPerms.filter(p => !oldPerms.includes(p));
  const removedPerms = oldPerms.filter(p => !newPerms.includes(p));
  if (addedPerms.length > 0) {
    changes.push(`Dodano uprawnienia: ${addedPerms.join(', ')}`);
  }
  if (removedPerms.length > 0) {
    changes.push(`Usunięto uprawnienia: ${removedPerms.join(', ')}`);
  }
  if (changes.length > 0) {
    const embed = new EmbedBuilder()
      .setTitle('Zmiany w roli')
      .setColor('#3498db')
      .setDescription(changes.join('\n'))
      .setTimestamp();
    sendChangeLog(newRole.guild, embed);
  }
});

// --- Kanały ---

// channelCreate: logujemy utworzenie kanału
client.on('channelCreate', async (channel) => {
  if (!channel.guild) return;
  const embed = new EmbedBuilder()
    .setTitle('Utworzono kanał')
    .setColor('#2ecc71')
    .setDescription(`Kanał **${channel.name}** został utworzony.`)
    .setTimestamp();
  sendChangeLog(channel.guild, embed);
});

// channelDelete: logujemy usunięcie kanału
client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const embed = new EmbedBuilder()
    .setTitle('Usunięto kanał')
    .setColor('#e74c3c')
    .setDescription(`Kanał **${channel.name}** został usunięty.`)
    .setTimestamp();
  sendChangeLog(channel.guild, embed);
});

// channelUpdate: logujemy zmiany w kanale – nazwa, uprawnienia itp.
client.on('channelUpdate', async (oldChannel, newChannel) => {
  if (!newChannel.guild) return;
  let changes = [];
  if (oldChannel.name !== newChannel.name) {
    changes.push(`Nazwa zmieniona z "${oldChannel.name}" na "${newChannel.name}"`);
  }
  
  // Porównanie permission overwrites
  const oldOverwrites = oldChannel.permissionOverwrites.cache;
  const newOverwrites = newChannel.permissionOverwrites.cache;
  
  // Jeśli liczba overwrite się różni
  if (oldOverwrites.size !== newOverwrites.size) {
    changes.push("Liczba wpisów uprawnień została zmieniona.");
  }
  
  // Sprawdzenie szczegółowych różnic dla każdego wpisu
  newOverwrites.forEach((newOverwrite, id) => {
    const oldOverwrite = oldOverwrites.get(id);
    if (!oldOverwrite) {
      changes.push(`Dodano nowe uprawnienia dla ${newOverwrite.type === 'role' ? 'roli' : 'użytkownika'} o ID ${id}.`);
    } else {
      const oldAllow = oldOverwrite.allow.toArray();
      const newAllow = newOverwrite.allow.toArray();
      const addedAllow = newAllow.filter(p => !oldAllow.includes(p));
      const removedAllow = oldAllow.filter(p => !newAllow.includes(p));
      if (addedAllow.length > 0) {
        changes.push(`Dla ${newOverwrite.type === 'role' ? 'roli' : 'użytkownika'} ${id} dodano uprawnienia: ${addedAllow.join(', ')}`);
      }
      if (removedAllow.length > 0) {
        changes.push(`Dla ${newOverwrite.type === 'role' ? 'roli' : 'użytkownika'} ${id} usunięto uprawnienia: ${removedAllow.join(', ')}`);
      }
      
      const oldDeny = oldOverwrite.deny.toArray();
      const newDeny = newOverwrite.deny.toArray();
      const addedDeny = newDeny.filter(p => !oldDeny.includes(p));
      const removedDeny = oldDeny.filter(p => !newDeny.includes(p));
      if (addedDeny.length > 0) {
        changes.push(`Dla ${newOverwrite.type === 'role' ? 'roli' : 'użytkownika'} ${id} dodano zakazy: ${addedDeny.join(', ')}`);
      }
      if (removedDeny.length > 0) {
        changes.push(`Dla ${newOverwrite.type === 'role' ? 'roli' : 'użytkownika'} ${id} usunięto zakazy: ${removedDeny.join(', ')}`);
      }
    }
  });
  
  // Wykrycie usuniętych wpisów
  oldOverwrites.forEach((oldOverwrite, id) => {
    if (!newOverwrites.has(id)) {
      changes.push(`Usunięto uprawnienia dla ${oldOverwrite.type === 'role' ? 'roli' : 'użytkownika'} o ID ${id}.`);
    }
  });
  
  if (changes.length > 0) {
    const embed = new EmbedBuilder()
      .setTitle('Zmiany w kanale')
      .setColor('#3498db')
      .setDescription(changes.join('\n'))
      .setTimestamp();
    sendChangeLog(newChannel.guild, embed);
  }
});

//
// OBSŁUGA ZDARZEŃ WIADOMOŚCI – edycja i usunięcie
//
client.on('messageDelete', async (message) => {
  let msg = message;
  if (message.partial) {
    try {
      msg = await message.fetch();
    } catch (err) {
      if (err.code === 10008) {
        if (!msg.content) {
          msg.content = 'Treść nie jest dostępna (wiadomość częściowa)';
        }
      } else {
        console.error("Błąd przy pobieraniu usuniętej wiadomości:", err);
        return;
      }
    }
  }
  if (msg.author && msg.author.bot) return;
  let author = msg.author;
  let executor = null;
  let deletionLog = null;
  try {
    const fetchedLogs = await msg.guild.fetchAuditLogs({ type: 72, limit: 1 });
    deletionLog = fetchedLogs.entries.first();
    if (deletionLog) {
      const { executor: logExecutor, target, createdTimestamp } = deletionLog;
      if (msg.author?.id && target.id === msg.author.id && (Date.now() - createdTimestamp) < 5000) {
        executor = `<@${logExecutor.id}>`;
      }
    }
  } catch (err) {
    console.error(err);
  }
  if (!author && deletionLog) {
    author = deletionLog.target;
  }
  const fields = [];
  if (author) {
    fields.push({ name: 'Autor', value: `<@${author.id}>`, inline: true });
  } else {
    fields.push({ name: 'Autor', value: 'Nieznany', inline: true });
  }
  if (executor) {
    fields.push({ name: 'Usunięta przez', value: executor, inline: true });
  }
  fields.push(
    { name: 'Kanał', value: `<#${msg.channel.id}>`, inline: true },
    { name: 'Treść', value: msg.content || 'Brak treści' }
  );
  const embed = new EmbedBuilder()
    .setTitle('Usunięta wiadomość')
    .setColor('#FF0000')
    .addFields(fields)
    .setTimestamp();
  sendTextLog(msg.guild, { embeds: [embed] });
});

client.on('messageUpdate', async (oldMessage, newMessage) => {
  if (oldMessage.partial) {
    try {
      await oldMessage.fetch();
    } catch (err) {
      console.error("Błąd przy pobieraniu starej wiadomości:", err);
      return;
    }
  }
  if (newMessage.partial) {
    try {
      await newMessage.fetch();
    } catch (err) {
      console.error("Błąd przy pobieraniu nowej wiadomości:", err);
      return;
    }
  }
  if (oldMessage.author.bot) return;
  if (oldMessage.content === newMessage.content) return;
  const embed = new EmbedBuilder()
    .setTitle('Edytowana wiadomość')
    .setColor('#FFA500')
    .addFields(
      { name: 'Autor', value: `<@${oldMessage.author.id}>`, inline: true },
      { name: 'Kanał', value: `<#${oldMessage.channel.id}>`, inline: true },
      { name: 'Stara treść', value: oldMessage.content || 'Brak treści' },
      { name: 'Nowa treść', value: newMessage.content || 'Brak treści' }
    )
    .setTimestamp();
  sendTextLog(oldMessage.guild, { embeds: [embed] });
});

//
// OBSŁUGA ZDARZEŃ GŁOSOWYCH – dołączenie, opuszczenie, przeniesienie, wyciszenie/deaf oraz timeout
//
client.on('voiceStateUpdate', async (oldState, newState) => {
  const member = newState.member || oldState.member;
  if (!member) return;
  if (!oldState.channelId && newState.channelId) {
    const embed = new EmbedBuilder()
      .setTitle('Dołączenie do kanału')
      .setColor('#00FF00')
      .addFields(
        { name: 'Użytkownik', value: `<@${member.id}>`, inline: true },
        { name: 'Kanał', value: `<#${newState.channelId}>`, inline: true }
      )
      .setFooter({ text: '© tajgerek' })
      .setTimestamp();
    sendVoiceLog(newState.guild, embed);
  } else if (oldState.channelId && !newState.channelId) {
    const embed = new EmbedBuilder()
      .setTitle('Opuszczenie kanału')
      .setColor('#FF0000')
      .addFields(
        { name: 'Użytkownik', value: `<@${member.id}>`, inline: true },
        { name: 'Kanał', value: `<#${oldState.channelId}>`, inline: true }
      )
      .setFooter({ text: '© tajgerek' })
      .setTimestamp();
    sendVoiceLog(oldState.guild, embed);
  } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
    const embed = new EmbedBuilder()
      .setTitle('Przeniesienie między kanałami')
      .setColor('#F1C40F')
      .addFields(
        { name: 'Użytkownik', value: `<@${member.id}>`, inline: true },
        { name: 'Stary kanał', value: `<#${oldState.channelId}>`, inline: true },
        { name: 'Nowy kanał', value: `<#${newState.channelId}>`, inline: true }
      )
      .setFooter({ text: '© tajgerek' })
      .setTimestamp();
    sendVoiceLog(oldState.guild, embed);
  }
  if (newState.serverMute !== oldState.serverMute) {
    let action = newState.serverMute ? "Wyciszenie (mute)" : "Odciszenie (mute)";
    let executor = "Nieznany";
    try {
      const fetchedLogs = await newState.guild.fetchAuditLogs({ type: 24, limit: 5 });
      const updateLog = fetchedLogs.entries.find(entry =>
        entry.target.id === member.id &&
        entry.changes.some(change => change.key === 'mute') &&
        (Date.now() - entry.createdTimestamp) < 5000
      );
      if (updateLog) {
        executor = `<@${updateLog.executor.id}>`;
      }
    } catch (err) {
      console.error(err);
    }
    const embed = new EmbedBuilder()
      .setTitle(action)
      .setColor(newState.serverMute ? '#FF0000' : '#00FF00')
      .addFields(
        { name: 'Użytkownik', value: `<@${member.id}>`, inline: true },
        { name: 'Przez', value: executor, inline: true }
      )
      .setTimestamp();
    sendVoiceLog(newState.guild, embed);
  }
  if (newState.serverDeaf !== oldState.serverDeaf) {
    let action = newState.serverDeaf ? "Wyciszenie słuchu" : "Odciszenie słuchu";
    let executor = "Nieznany";
    try {
      const fetchedLogs = await newState.guild.fetchAuditLogs({ type: 24, limit: 5 });
      const updateLog = fetchedLogs.entries.find(entry =>
        entry.target.id === member.id &&
        entry.changes.some(change => change.key === 'deaf') &&
        (Date.now() - entry.createdTimestamp) < 5000
      );
      if (updateLog) {
        executor = `<@${updateLog.executor.id}>`;
      }
    } catch (err) {
      console.error(err);
    }
    const embed = new EmbedBuilder()
      .setTitle(action)
      .setColor(newState.serverDeaf ? '#FF0000' : '#00FF00')
      .addFields(
        { name: 'Użytkownik', value: `<@${member.id}>`, inline: true },
        { name: 'Przez', value: executor, inline: true }
      )
      .setTimestamp();
    sendVoiceLog(newState.guild, embed);
  }
});

client.login(process.env.TOKEN);
