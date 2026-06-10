require("dotenv").config();

const express = require("express");
const cors = require("cors");
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { Client, GatewayIntentBits } = require("discord.js");
const { status } = require("minecraft-server-util");

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const dbPool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 5,
  queueLimit: 0
});

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
      smp: {
        name: "Remény SMP",
        ip: "remenymc.shockbyte.pro",
        port: 25399,
        logo: "mc-logo.png"
      },
      hytale: {
        name: "Remény Hytale",
        ip: "remenyhytale.shockbyte.pro",
        port: 25838,
        logo: "hytale-logo.png"
      }
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
    const smp = config.smp;

    if (!smp || !smp.ip) {
      return res.status(400).json({
        error: "Nincs SMP IP beállítva."
      });
    }

    const result = await status(
      smp.ip,
      Number(smp.port) || 25565
    );

    res.json({
      ...smp,
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

app.get("/api/hytale", (req, res) => {
  try {
    const config = JSON.parse(fs.readFileSync("server.json", "utf8"));

    if (!config.hytale) {
      return res.status(400).json({
        error: "Nincs Hytale adat beállítva."
      });
    }

    res.json(config.hytale);

  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: "Nem sikerült lekérni a Hytale adatokat."
    });
  }
});

app.get("/api/player-stats/:name", async (req, res) => {
  try {
    const playerName = req.params.name;

    const [rows] = await dbPool.execute(
      `SELECT 
          player_name,
          kills,
          deaths,
          play_seconds,
          blocks_placed,
          distance_traveled,
          skin_url
       FROM player_stats
       WHERE LOWER(player_name) = LOWER(?)
       LIMIT 1`,
      [playerName]
    );

    if (rows.length === 0) {
      return res.json({
        name: playerName,
        kills: 0,
        deaths: 0,
        hours: 0,
        blocksPlaced: 0,
        distanceTraveled: 0,
        skinUrl: null,
        found: false
      });
    }

    const player = rows[0];

    res.json({
      name: player.player_name,
      kills: Number(player.kills) || 0,
      deaths: Number(player.deaths) || 0,
      hours: Math.floor((Number(player.play_seconds) || 0) / 3600),
      blocksPlaced: Number(player.blocks_placed) || 0,
      distanceTraveled: Math.floor(Number(player.distance_traveled) || 0),
      skinUrl: player.skin_url || null,
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
