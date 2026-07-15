const jwt = require("jsonwebtoken");
const { Conversation } = require("../models");

function setupSocket(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("Token manquant"));
    try { socket.user = jwt.verify(token, process.env.JWT_SECRET); next(); }
    catch { next(new Error("Token invalide")); }
  });

  io.on("connection", async (socket) => {
    const u = socket.user;
    console.log(`[Socket] ${u.type} connecte (${u.id || u.displayName})`);

    // ── Employé : rejoint la room globale + sa room personnelle (pour les appels)
    if (u.type === "employee") {
      socket.join("employees");
      socket.join(`employee:${u.id}`);
    }

    // ── Client : rejoint AUTOMATIQUEMENT sa conversation permanente + sa room personnelle (pour les appels)
    if (u.type === "client") {
      socket.join(`client:${u.id}`);
      try {
        const conv = await Conversation.findOne({ where: { clientId: u.id } });
        if (conv) {
          socket.join(conv.id);
          socket.data.convId = conv.id;
          console.log(`[Socket] Client rejoint room ${conv.id}`);
        }
      } catch(e) { console.error("[Socket] Erreur join client:", e.message); }
    }

    // ── Invité : rejoint sa conversation
    if (u.type === "guest" && u.conversationId) {
      socket.join(u.conversationId);
      socket.data.convId = u.conversationId;
    }

    // Rejoindre une room manuellement (employé ouvre une conversation)
    socket.on("join_conversation", (id) => socket.join(id));
    socket.on("leave_conversation", (id) => socket.leave(id));

    // Indicateur de frappe
    socket.on("typing", ({ conversationId, isTyping }) => {
      socket.to(conversationId).emit("typing", {
        conversationId,
        userType: u.type,
        isTyping,
      });
    });

    // ── WebRTC signaling
    socket.on("call:offer", ({ targetClientId, sessionId, offer, video }) => {
      if (u.type !== "employee") return;
      io.to(`client:${targetClientId}`).emit("call:offer", {
        sessionId, offer, callerName: u.name || "Biborne", callerId: u.id, video: !!video,
      });
    });
    socket.on("call:answer", ({ sessionId, callerId, answer }) => {
      io.to(`employee:${callerId}`).emit("call:answer", { sessionId, answer });
    });
    socket.on("call:ice", ({ targetType, targetId, sessionId, candidate }) => {
      io.to(`${targetType}:${targetId}`).emit("call:ice", { sessionId, candidate });
    });
    socket.on("call:end", ({ targetType, targetId, sessionId, reason }) => {
      io.to(`${targetType}:${targetId}`).emit("call:end", { sessionId, reason });
    });

    socket.on("disconnect", () => {
      console.log(`[Socket] ${u.type} deconnecte`);
    });
  });
}

module.exports = setupSocket;
