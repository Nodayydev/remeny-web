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

const SERVER_JSON_PATH = path.join(__dirname, "server.json");

const DEFAULT_SERVER_CONFIG = {
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
};

function normalizeServerEntry(entry, fallback) {
  const merged = { ...fallback, ...(entry || {}) };

  return {
    name: String(merged.name || fallback.name),
    ip: String(merged.ip || fallback.ip).trim(),
    port: Number(merged.port || fallback.port),
    logo: String(merged.logo || fallback.logo),
    motd: merged.motd ? String(merged.motd) : undefined,
    version: merged.version ? String(merged.version) : undefined,
    online: merged.online,
    max: merged.max
  };
}

function readServerConfig() {
  try {
    if (!fs.existsSync(SERVER_JSON_PATH)) {
      return DEFAULT_SERVER_CONFIG;
    }

    const parsed = JSON.parse(fs.readFileSync(SERVER_JSON_PATH, "utf8"));

    return {
      smp: normalizeServerEntry(parsed.smp || parsed || {}, DEFAULT_SERVER_CONFIG.smp),
      hytale: normalizeServerEntry(parsed.hytale || {}, DEFAULT_SERVER_CONFIG.hytale)
    };
  } catch (error) {
    console.error("server.json olvasási hiba:", error);
    return DEFAULT_SERVER_CONFIG;
  }
}

function writeServerConfig(config) {
  const normalized = {
    smp: normalizeServerEntry(config?.smp || config || {}, DEFAULT_SERVER_CONFIG.smp),
    hytale: normalizeServerEntry(config?.hytale || {}, DEFAULT_SERVER_CONFIG.hytale)
  };

  fs.writeFileSync(SERVER_JSON_PATH, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}

function fullAddress(server) {
  const ip = String(server.ip || "").trim();
  const port = Number(server.port);
  if (!ip) return "";
  if (!port || ip.includes(":")) return ip;
  return `${ip}:${port}`;
}

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
  res.json(readServerConfig());
});

app.post("/api/server-config", (req, res) => {
  try {
    const saved = writeServerConfig(req.body);
    res.json({ success: true, config: saved });
  } catch (error) {
    console.error("server.json mentési hiba:", error);
    res.status(500).json({ error: "Nem sikerült menteni a server.json fájlt." });
  }
});

app.get("/api/minecraft", async (req, res) => {
  const config = readServerConfig();
  const smp = config.smp;

  try {
    const ip = String(smp.ip || "").trim();
    const port = Number(smp.port) || 25565;

    if (!ip) {
      throw new Error("Nincs SMP IP beállítva a server.json fájlban.");
    }

    const result = await status(ip, port, {
      timeout: 5000,
      enableSRV: true
    });

    res.json({
      ...smp,
      ip,
      port,
      address: fullAddress(smp),
      online: result.players?.online ?? 0,
      max: result.players?.max ?? 0,
      version: result.version?.name ?? "",
      motd:
        result.motd?.clean ||
        result.motd?.raw ||
        result.motd?.html ||
        smp.motd ||
        ""
    });

  } catch (error) {
    console.error("Minecraft status hiba:", error);

    res.json({
      ...smp,
      address: fullAddress(smp),
      online: 0,
      max: 0,
      version: "Offline",
      motd: smp.motd || "A szerver állapota jelenleg nem elérhető.",
      error: true
    });
  }
});

app.get("/api/hytale", (req, res) => {
  const config = readServerConfig();
  const hytale = config.hytale;

  res.json({
    ...hytale,
    address: fullAddress(hytale)
  });
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
    res.status(500).json({ error: "Nem sikerült lekérni a játékos statokat." });
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
