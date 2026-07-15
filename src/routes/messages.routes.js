const express = require("express");
const { Message, Conversation, Employee } = require("../models");
const { upload } = require("../utils/upload");
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

// Historique
router.get("/:convId", async (req, res) => {
  try {
    const msgs = await Message.findAll({
      where: { conversationId: req.params.convId },
      include: [{ model: Employee, attributes: ["id", "name"] }],
      order: [["createdAt","ASC"]],
    });
    res.json(msgs);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Texte
router.post("/:convId/text", async (req, res) => {
  try {
    const { content, clientMsgId, mentions } = req.body;
    if (!content?.trim()) return res.status(400).json({ error: "Message vide" });
    const msg = await Message.create(buildMsg(req, req.params.convId, {
      type: "text",
      content,
      mentions: Array.isArray(mentions) && mentions.length ? JSON.stringify(mentions) : null,
    }));
    await Conversation.update({ updatedAt: new Date() }, { where: { id: req.params.convId } });
    const full = await Message.findByPk(msg.id, { include: [{ model: Employee, attributes: ["id", "name"] }] });
    // clientMsgId permet à l'expéditeur de faire correspondre l'aperçu optimiste affiché
    // instantanément avec le message confirmé par le serveur, et d'éviter un doublon
    // quel que soit l'ordre d'arrivée entre la réponse HTTP et l'évènement socket.
    const payload = { ...full.toJSON(), clientMsgId: clientMsgId || null };
    emit(req.params.convId, req.user.type, payload);
    res.json(payload);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Média
router.post("/:convId/media", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });
    const msg = await Message.create(buildMsg(req, req.params.convId, {
      type: req.body.type || "file",
      fileUrl: `/uploads/${req.file.filename}`,
      fileName: req.file.originalname,
      mimeType: req.file.mimetype,
    }));
    await Conversation.update({ updatedAt: new Date() }, { where: { id: req.params.convId } });
    const full = await Message.findByPk(msg.id, { include: [{ model: Employee, attributes: ["id", "name"] }] });
    const payload = { ...full.toJSON(), clientMsgId: req.body.clientMsgId || null };
    emit(req.params.convId, req.user.type, payload);
    res.json(payload);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = { router, setIo };
