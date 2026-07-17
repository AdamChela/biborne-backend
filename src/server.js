require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const bcrypt = require("bcryptjs");
const { Server } = require("socket.io");
const { sequelize, Employee } = require("./models");
const setupSocket = require("./sockets/chat.socket");
const { maybeRunSupervision } = require("./utils/supervision");
const { maybeRunMediaCleanup, setIo: setMediaCleanupIo } = require("./utils/mediaCleanup");

const authRoutes          = require("./routes/auth.routes");
const conversationsRoutes = require("./routes/conversations.routes");
const { router: messagesRouter, setIo } = require("./routes/messages.routes");
const callsRoutes         = require("./routes/calls.routes");
const invitesRoutes       = require("./routes/invites.routes");
const quickRepliesRoutes  = require("./routes/quick-replies.routes");
const pushRoutes          = require("./routes/push.routes");

const app = express();
// Render est derrière un proxy : sans ça, req.ip renvoie toujours l'IP interne du proxy,
// ce qui casse le limiteur de tentatives (rate limit) basé sur l'IP du vrai visiteur.
app.set("trust proxy", 1);
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));
app.use((req, res, next) => { req.io = io; next(); });
// Supervision "opportuniste" : profite du trafic réel entrant pour vérifier périodiquement
// des anomalies (voir utils/supervision.js), sans jamais ralentir la requête en cours.
app.use((req, res, next) => { next(); maybeRunSupervision(); });
// Même principe pour la suppression automatique des médias de plus de 30 jours (voir utils/mediaCleanup.js).
app.use((req, res, next) => { next(); maybeRunMediaCleanup(); });

setIo(io);
setMediaCleanupIo(io);

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth",          authRoutes);
app.use("/api/conversations", conversationsRoutes);
app.use("/api/messages",      messagesRouter);
app.use("/api/calls",         callsRoutes);
app.use("/api/invites",       invitesRoutes);
app.use("/api/quick-replies", quickRepliesRoutes);
app.use("/api/push",          pushRoutes);

setupSocket(io);

// Équipe Biborne : identifiants unifiés (prenom@biborne.com + mot de passe partagé). Recréés/alignés
// à chaque démarrage du serveur (idempotent, voir ensureBiborneTeam ci-dessous) : pratique pour ne
// jamais avoir à se souvenir de qui a quel mot de passe, et couvre aussi un compte déjà existant
// dont le mot de passe aurait été oublié — il est réaligné sur le mot de passe partagé au redémarrage.
const BIBORNE_TEAM = ["Samy", "Adam", "Marwane", "Salem", "Toufik", "Fouzi", "Safir", "Badreddine", "Sofiane", "Abdelnoor"];
const SHARED_PASSWORD = "Atmosphere@2026!";

// Tous les employés Biborne ont les mêmes droits (pas de hiérarchie admin distincte dans cette app) :
// crée les comptes de l'équipe s'ils n'existent pas, aligne leur mot de passe/droits sinon, puis
// s'assure que canDelete est activé pour absolument tous les employés (y compris ceux hors de cette liste).
async function ensureBiborneTeam() {
  const hash = await bcrypt.hash(SHARED_PASSWORD, 10);
  for (const name of BIBORNE_TEAM) {
    const email = `${name.toLowerCase()}@biborne.com`;
    const [emp] = await Employee.findOrCreate({ where: { email }, defaults: { name, email, password: hash, canDelete: true } });
    await emp.update({ name, password: hash, canDelete: true });
  }
  await Employee.update({ canDelete: true }, { where: {} });
}

async function start() {
  await sequelize.sync({ alter: true });
  console.log("Base de donnees synchronisee");
  try {
    await ensureBiborneTeam();
  } catch (e) { console.error("[Startup] Erreur création/alignement équipe Biborne:", e.message); }
  const PORT = process.env.PORT || 4000;
  server.listen(PORT, () => console.log(`Serveur Biborne Messagerie demarre sur le port ${PORT}`));
}
start();
