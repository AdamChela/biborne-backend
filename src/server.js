require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const { sequelize } = require("./models");
const setupSocket = require("./sockets/chat.socket");

const authRoutes          = require("./routes/auth.routes");
const conversationsRoutes = require("./routes/conversations.routes");
const { router: messagesRouter, setIo } = require("./routes/messages.routes");
const callsRoutes         = require("./routes/calls.routes");
const invitesRoutes       = require("./routes/invites.routes");
const quickRepliesRoutes  = require("./routes/quick-replies.routes");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors({ origin: process.env.CORS_ORIGIN || "*" }));
app.use(express.json());
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));
app.use((req, res, next) => { req.io = io; next(); });

setIo(io);

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api/auth",          authRoutes);
app.use("/api/conversations", conversationsRoutes);
app.use("/api/messages",      messagesRouter);
app.use("/api/calls",         callsRoutes);
app.use("/api/invites",       invitesRoutes);
app.use("/api/quick-replies", quickRepliesRoutes);

setupSocket(io);

async function start() {
  await sequelize.sync({ alter: true });
  console.log("Base de donnees synchronisee");
  const PORT = process.env.PORT || 4000;
  server.listen(PORT, () => console.log(`Serveur Biborne Messagerie demarre sur le port ${PORT}`));
}
start();
