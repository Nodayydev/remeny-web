require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits } = require("discord.js");
const { status } = require("minecraft-server-util");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

let guildCache = null;

client.once("clientReady", async () => {
  console.log(`Bot elindult: ${client.user.tag}`);

  guildCache = await client.guilds.fetch(process.env.GUILD_ID);
  await guildCache.members.fetch();

  console.log("Tagok betöltve cache-be.");
});

app.get("/api/rank/:roleName", async (req, res) => {
  try {
    const roleName = req.params.roleName;

    if (!guildCache) {
      return res.status(503).json({ error: "A bot még tölti a tagokat." });
    }

    const role = guildCache.roles.cache.find(
      r => r.name.toLowerCase() === roleName.toLowerCase()
    );

    if (!role) {
      return res.status(404).json({ error: "Nincs ilyen rang." });
    }

    const members = role.members.map(member => ({
      username: member.user.username,
      displayName: member.displayName,
      avatar: member.user.displayAvatarURL({ size: 128 })
    }));

    res.json(members);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Hiba történt a tagok lekérésekor." });
  }
});

app.get("/api/server-config", (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync("server.json", "utf8"));
    res.json(config);
  } catch {
    res.json({
      name: "Remény SMP",
      ip: "remenymc.shockbyte.pro",
      port: 25565,
      logo: "logo.png"
    });
  }
});

app.post("/api/server-config", (req, res) => {
  fs.writeFileSync(
    "server.json",
    JSON.stringify(req.body, null, 2)
  );

  res.json({ success: true });
});

app.get("/api/minecraft", async (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync("server.json", "utf8"));

    const result = await status(
      config.ip,
      Number(config.port) || 25565
    );

    res.json({
      ...config,
      online: result.players.online,
      max: result.players.max,
      version: result.version.name,
      motd: result.motd.html
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Nem sikerült lekérni a Minecraft szerver adatait."
    });
  }
});

app.get("/api/player-stats/:name", async (req, res) => {
  try {
    const playerName = req.params.name;

    let stats = {};

    try {
      stats = JSON.parse(fs.readFileSync("player-stats.json", "utf8"));
    } catch {
      stats = {};
    }

    const playerKey = Object.keys(stats).find(
      key => key.toLowerCase() === playerName.toLowerCase()
    );

    if (!playerKey) {
      return res.json({
        name: playerName,
        kills: 0,
        deaths: 0,
        hours: 0,
        blocksPlaced: 0,
        found: false
      });
    }

    res.json({
      name: playerKey,
      kills: stats[playerKey].kills || 0,
      deaths: stats[playerKey].deaths || 0,
      hours: stats[playerKey].hours || 0,
      blocksPlaced: stats[playerKey].blocksPlaced || 0,
      found: true
    });

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Nem sikerült lekérni a játékos statokat."
    });
  }
});

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "teszt.html"));
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "admin.html"));
});

client.login(process.env.DISCORD_TOKEN);

app.listen(process.env.PORT || 3000, () => {
  console.log(`Web API fut: http://localhost:${process.env.PORT || 3000}`);
});
