// App Express minimale pour les tests : monte les vraies routes de l'appli (donc les vraies failles
// seraient détectées), mais sans socket.io ni écoute réseau. sequelize est celui de src/models
// (partagé), pointé vers une base SQLite en mémoire par tests/env.setup.js.
const express = require("express");
const cors = require("cors");
const { sequelize } = require("../../src/models");
const authRoutes = require("../../src/routes/auth.routes");
const conversationsRoutes = require("../../src/routes/conversations.routes");
const { router: messagesRouter } = require("../../src/routes/messages.routes");
const invitesRoutes = require("../../src/routes/invites.routes");
const { _resetForTests: resetRateLimits } = require("../../src/middleware/rateLimit");

function buildApp() {
  const app = express();
  app.set("trust proxy", 1);
  app.use(cors());
  app.use(express.json());
  // req.io n'est jamais utilisé pour des assertions de test ; les routes font toutes "req.io?.emit(...)"
  // (optional chaining), donc le laisser à null est sans risque.
  app.use((req, res, next) => { req.io = null; next(); });
  app.use("/api/auth", authRoutes);
  app.use("/api/conversations", conversationsRoutes);
  app.use("/api/messages", messagesRouter);
  app.use("/api/invites", invitesRoutes);
  return app;
}

// Recrée toutes les tables à partir de zéro (base en mémoire) : appelé dans un beforeEach
// de chaque fichier de test pour garantir des tests indépendants les uns des autres.
async function resetDb() {
  await sequelize.sync({ force: true });
  resetRateLimits();
}

module.exports = { buildApp, resetDb, sequelize };
