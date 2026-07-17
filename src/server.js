require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { sequelize, Employee } = require("./models");
const setupSocket = require("./sockets/chat.socket");
const { maybeRunSupervision } = require("./utils/supervision");

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

setIo(io);

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth",          authRoutes);
app.use("/api/conversations", conversationsRoutes);
app.use("/api/messages",      messagesRouter);
app.use("/api/calls",         callsRoutes);
app.use("/api/invites",       invitesRoutes);
app.use("/api/quick-replies", quickRepliesRoutes);
app.use("/api/push",          pushRoutes);

setupSocket(io);

// Employés autorisés à supprimer définitivement une conversation (voir routes/conversations.routes.js).
// Réappliqué à chaque démarrage : idempotent, et couvre aussi un futur nouvel employé qu'on ajouterait ici.
const DELETE_ALLOWED_EMAILS = ["adam@biborne.com", "samy@biborne.com", "sofiane@biborne.com", "fouzi@biborne.com"];

async function start() {
  await sequelize.sync({ alter: true });
  console.log("Base de donnees synchronisee");
  try {
    await Employee.update({ canDelete: true }, { where: { email: DELETE_ALLOWED_EMAILS } });
  } catch (e) { console.error("[Startup] Erreur mise à jour canDelete:", e.message); }
  const PORT = process.env.PORT || 4000;
  server.listen(PORT, () => console.log(`Serveur Biborne Messagerie demarre sur le port ${PORT}`));
}
start();
