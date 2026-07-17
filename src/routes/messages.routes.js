const express = require("express");
const { Message, Conversation, Employee, Client, ConversationParticipant } = require("../models");
const { upload } = require("../utils/upload");
const { uploadBuffer } = require("../utils/cloudinary");
const { alertError } = require("../utils/alert");
const { sameConversationOnly } = require("../middleware/convAccess");
const { sendPushToOwner } = require("../utils/push");
const { Op } = require("sequelize");
const jwt = require("jsonwebtoken");

const router = express.Router();

// Auth flexible : client, employé, invité
router.use((req, res, next) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Token manquant" });
  try {
    req.user = jwt.verify(header.replace("Bearer ", ""), process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error: "Token invalide" }); }
});

// Empêche un client non encore validé par un employé d'envoyer des messages (voir Client.approved).
// Vérifié en base à chaque envoi (pas dans le JWT) pour prendre effet immédiatement après validation.
async function blockUnapprovedClient(req, res, next) {
  if (req.user.type !== "client") return next();
  try {
    const client = await Client.findByPk(req.user.id);
    if (!client?.approved) return res.status(403).json({ error: "Ton compte est en attente de validation par l'équipe Biborne.", needsApproval: true });
    next();
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
}

let io = null;
function setIo(instance) { io = instance; }

function buildMsg(req, convId, extra) {
  return {
    conversationId: convId,
    senderType: req.user.type,
    employeeId: req.user.type === "employee" ? req.user.id : null,
    clientId:   req.user.type === "client"   ? req.user.id : null,
    guestName:  req.user.type === "guest"    ? req.user.displayName : null,
    guestId:    req.user.type === "guest"    ? req.user.id : null,
    guestPhone: req.user.type === "guest"    ? req.user.phone : null,
    guestRole:  req.user.type === "guest"    ? req.user.role : null,
    ...extra,
  };
}

function emit(convId, senderType, msg) {
  // Émet dans la room de la conversation (tout le monde dedans reçoit)
  io?.to(convId).emit("new_message", msg);
  // Si le message vient d'un client/invité, notifie aussi les employés PAS dans la room
  if (senderType !== "employee") {
    io?.to("employees").except(convId).emit("new_message", msg);
  }
}

// Notification push (PWA) pour les destinataires potentiellement absents de l'app au moment de l'envoi.
// No-op silencieux si les clés VAPID ne sont pas configurées (voir utils/push.js).
async function notifyPush(convId, senderType, msg) {
  try {
    const conv = await Conversation.findByPk(convId);
    if (!conv) return;
    const typeLabels = { image: "📷 Photo", video: "🎬 Vidéo", audio: "🎤 Message vocal", file: "📎 Fichier" };
    const preview = msg.type === "text" ? (msg.content || "").slice(0, 120) : (typeLabels[msg.type] || "Nouveau message");
    const senderName = senderType === "employee" ? (msg.Employee?.name || "Biborne")
      : senderType === "client" ? (conv.displayName || "Client")
      : (msg.guestName || "Invité");
    const payload = { title: senderName, body: preview, conversationId: convId };
    if (senderType === "employee") {
      const guests = await ConversationParticipant.findAll({ where: { conversationId: convId }, attributes: ["id"] });
      await Promise.all([
        conv.clientId ? sendPushToOwner("client", conv.clientId, payload) : null,
        ...guests.map(g => sendPushToOwner("guest", g.id, payload)),
      ]);
    } else {
      const emps = await Employee.findAll({ attributes: ["id"] });
      await Promise.all(emps.map(e => sendPushToOwner("employee", e.id, payload)));
    }
  } catch (e) { console.error("[Push] Erreur notifyPush:", e.message); }
}

// Historique, paginé : renvoie par défaut les 50 derniers messages (ordre chronologique croissant).
// ?before=<ISO createdAt du plus ancien message déjà chargé> pour remonter dans l'historique.
// ?limit=<n> pour ajuster la taille de page (200 max). hasMore indique s'il reste des messages plus anciens.
router.get("/:convId", sameConversationOnly, async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 50, 1), 200);
    const where = { conversationId: req.params.convId };
    if (req.query.before) {
      const before = new Date(req.query.before);
      if (!isNaN(before)) where.createdAt = { [Op.lt]: before };
    }
    const rows = await Message.findAll({
      where,
      include: [{ model: Employee, attributes: ["id", "name"] }],
      order: [["createdAt", "DESC"]],
      limit: limit + 1,
    });
    const hasMore = rows.length > limit;
    const messages = rows.slice(0, limit).reverse().map(m => m.toJSON());
    res.json({ messages, hasMore });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Texte
router.post("/:convId/text", sameConversationOnly, blockUnapprovedClient, async (req, res) => {
  try {
    const { content, clientMsgId, mentions } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: "Message vide" });
    const msg = await Message.create(buildMsg(req, req.params.convId, {
      type: "text",
      content,
      mentions: Array.isArray(mentions) && mentions.length ? JSON.stringify(mentions) : null,
    }));
    const convUpdate = { updatedAt: new Date() };
    if (req.user.type !== "employee") convUpdate.unreadForEmployees = true;
    await Conversation.update(convUpdate, { where: { id: req.params.convId } });
    const full = await Message.findByPk(msg.id, { include: [{ model: Employee, attributes: ["id", "name"] }] });
    // clientMsgId permet à l'expéditeur de faire correspondre l'aperçu optimiste affiché
    // instantanément avec le message confirmé par le serveur, et d'éviter un doublon
    // quel que soit l'ordre d'arrivée entre la réponse HTTP et l'évènement socket.
    const payload = { ...full.toJSON(), clientMsgId: clientMsgId || null };
    emit(req.params.convId, req.user.type, payload);
    if (convUpdate.unreadForEmployees) io?.to("employees").emit("conversation_unread_changed", { conversationId: req.params.convId, unread: true });
    notifyPush(req.params.convId, req.user.type, full.toJSON()).catch(() => {});
    res.json(payload);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Média
router.post("/:convId/media", sameConversationOnly, blockUnapprovedClient, upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });
    // Stockage permanent sur Cloudinary (le disque de Render est effacé à chaque déploiement).
    const uploaded = await uploadBuffer(req.file.buffer, req.file.originalname, req.file.mimetype);
    const msg = await Message.create(buildMsg(req, req.params.convId, {
      type: req.body.type || "file",
      fileUrl: uploaded.secure_url,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
    }));
    const convUpdate = { updatedAt: new Date() };
    if (req.user.type !== "employee") convUpdate.unreadForEmployees = true;
    await Conversation.update(convUpdate, { where: { id: req.params.convId } });
    const full = await Message.findByPk(msg.id, { include: [{ model: Employee, attributes: ["id", "name"] }] });
    const payload = { ...full.toJSON(), clientMsgId: req.body.clientMsgId || null };
    emit(req.params.convId, req.user.type, payload);
    if (convUpdate.unreadForEmployees) io?.to("employees").emit("conversation_unread_changed", { conversationId: req.params.convId, unread: true });
    notifyPush(req.params.convId, req.user.type, full.toJSON()).catch(() => {});
    res.json(payload);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Marque comme "lus" les messages de l'AUTRE côté (celui qui appelle ne marque jamais ses propres
// messages comme lus). Appelé quand un employé ouvre une conversation, ou quand un client/invité
// revient sur l'app : fait passer les coches simples en coches doubles côté expéditeur.
router.post("/:convId/read", sameConversationOnly, async (req, res) => {
  try {
    const otherSenderTypes = req.user.type === "employee" ? ["client", "guest"] : ["employee"];
    const [count] = await Message.update(
      { status: "read" },
      { where: { conversationId: req.params.convId, senderType: otherSenderTypes, status: { [Op.ne]: "read" } } }
    );
    if (req.user.type === "employee") {
      await Conversation.update({ unreadForEmployees: false }, { where: { id: req.params.convId } });
      io?.to("employees").emit("conversation_unread_changed", { conversationId: req.params.convId, unread: false });
    }
    if (count > 0) io?.to(req.params.convId).emit("messages_read", { conversationId: req.params.convId, readerType: req.user.type });
    res.json({ ok: true, count });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Vérifie que l'utilisateur authentifié est bien l'auteur du message (édition/suppression).
function isOwner(req, msg) {
  if (req.user.type === "employee") return msg.employeeId === req.user.id;
  if (req.user.type === "client") return msg.clientId === req.user.id;
  if (req.user.type === "guest") return msg.guestId === req.user.id;
  return false;
}

// Modifier un message texte déjà envoyé (comme WhatsApp : réservé à son propre message).
router.patch("/single/:id", async (req, res) => {
  try {
    const msg = await Message.findByPk(req.params.id);
    if (!msg || msg.deletedAt) return res.status(404).json({ error: "Message introuvable" });
    if (msg.type !== "text") return res.status(400).json({ error: "Seuls les messages texte peuvent être modifiés" });
    if (!isOwner(req, msg)) return res.status(403).json({ error: "Tu ne peux modifier que tes propres messages" });
    const { content } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: "Message vide" });
    msg.content = content.trim();
    msg.edited = true;
    await msg.save();
    io?.to(msg.conversationId).emit("message_edited", { id: msg.id, conversationId: msg.conversationId, content: msg.content });
    res.json(msg);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Supprimer un message (suppression "douce" : remplacé par un texte "Message supprimé" à l'affichage).
// Autorisé pour l'auteur, ou pour un employé habilité à supprimer (voir Employee.canDelete), en modération.
router.delete("/single/:id", async (req, res) => {
  try {
    const msg = await Message.findByPk(req.params.id);
    if (!msg || msg.deletedAt) return res.status(404).json({ error: "Message introuvable" });
    const canModerate = req.user.type === "employee" && req.user.canDelete;
    if (!isOwner(req, msg) && !canModerate) return res.status(403).json({ error: "Tu ne peux supprimer que tes propres messages" });
    msg.deletedAt = new Date();
    await msg.save();
    io?.to(msg.conversationId).emit("message_deleted", { id: msg.id, conversationId: msg.conversationId });
    res.json({ ok: true });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = { router, setIo };
