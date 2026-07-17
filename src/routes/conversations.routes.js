const express = require("express");
const { Conversation, Client, Employee, Message, ConversationNote, ConversationParticipant, ConversationInvite } = require("../models");
const { authMiddleware, employeeOnly } = require("../middleware/auth");
const { alertError } = require("../utils/alert");

const router = express.Router();
router.use(authMiddleware);

// Liste des conversations
router.get("/", async (req, res) => {
  try {
    const where = req.user.type === "client" ? { clientId: req.user.id } : {};
    const convs = await Conversation.findAll({
      where,
      include: [Client, Employee, { model: Message, limit: 1, order: [["createdAt","DESC"]], separate: true }],
      order: [["updatedAt","DESC"]],
    });
    res.json(convs);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Créer une conversation (client)
router.post("/", async (req, res) => {
  try {
    if (req.user.type !== "client") return res.status(403).json({ error: "Réservé aux clients" });
    // Évite les doublons : 1 seule conversation par client
    let conv = await Conversation.findOne({ where: { clientId: req.user.id } });
    if (!conv) conv = await Conversation.create({ clientId: req.user.id });
    const full = await Conversation.findByPk(conv.id, { include: [Client, Employee] });
    res.json(full);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Assigner un employé
router.patch("/:id/assign", employeeOnly, async (req, res) => {
  try {
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });
    conv.employeeId = req.user.id;
    await conv.save();
    res.json(conv);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Mettre à jour le label/statut
router.patch("/:id/ticket", employeeOnly, async (req, res) => {
  try {
    const { ticketStatus } = req.body;
    const allowed = ["todo","in_progress","done","waiting","urgent"];
    if (!allowed.includes(ticketStatus)) return res.status(400).json({ error: "Statut invalide" });
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });
    const emp = await Employee.findByPk(req.user.id);
    conv.ticketStatus = ticketStatus;
    conv.ticketOwner = ticketStatus === "todo" ? null : (emp?.name || req.user.name || "Employé");
    await conv.save();
    req.io?.emit("ticket_updated", { conversationId: conv.id, ticketStatus: conv.ticketStatus, ticketOwner: conv.ticketOwner });
    res.json(conv);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Valider un client (bloqué par défaut après inscription, voir Client.approved) : lui donne accès au chat.
router.patch("/:id/approve-client", employeeOnly, async (req, res) => {
  try {
    const conv = await Conversation.findByPk(req.params.id, { include: [Client] });
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });
    if (!conv.Client) return res.status(400).json({ error: "Cette conversation n'a pas de client associé" });
    conv.Client.approved = true;
    await conv.Client.save();
    // Prévient le client (s'il attend sur l'écran de validation) et les autres employés (pour retirer le badge).
    req.io?.to(`client:${conv.Client.id}`).emit("client_approved", { conversationId: conv.id });
    req.io?.emit("client_approved_broadcast", { conversationId: conv.id });
    res.json({ ok: true });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Renommer le "groupe" (titre affiché de la conversation, prioritaire sur le nom du restaurant)
router.patch("/:id/name", employeeOnly, async (req, res) => {
  try {
    const { displayName } = req.body;
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });
    conv.displayName = displayName?.trim() || null;
    await conv.save();
    req.io?.emit("conversation_renamed", { conversationId: conv.id, displayName: conv.displayName });
    res.json(conv);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Supprimer définitivement une conversation (réservé aux employés autorisés, voir Employee.canDelete)
router.delete("/:id", employeeOnly, async (req, res) => {
  try {
    if (!req.user.canDelete) return res.status(403).json({ error: "Tu n'as pas la permission de supprimer une conversation" });
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });
    await Message.destroy({ where: { conversationId: conv.id } });
    await ConversationParticipant.destroy({ where: { conversationId: conv.id } });
    await ConversationInvite.destroy({ where: { conversationId: conv.id } });
    await ConversationNote.destroy({ where: { conversationId: conv.id } });
    await conv.destroy();
    req.io?.emit("conversation_deleted", { conversationId: req.params.id });
    res.json({ ok: true });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Liste de toutes les personnes présentes dans la conversation (client + invités via lien)
router.get("/:id/participants", async (req, res) => {
  try {
    const conv = await Conversation.findByPk(req.params.id, { include: [Client] });
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });
    const guests = await ConversationParticipant.findAll({
      where: { conversationId: req.params.id },
      attributes: ["id", "displayName", "role", "phone", "createdAt"],
      order: [["createdAt", "ASC"]],
    });
    res.json({
      client: conv.Client
        ? { id: conv.Client.id, name: conv.Client.name, phone: conv.Client.phone, restaurantName: conv.Client.restaurantName }
        : null,
      guests,
    });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Lire la note interne partagée d'une conversation
router.get("/:id/note", employeeOnly, async (req, res) => {
  try {
    const note = await ConversationNote.findOne({ where: { conversationId: req.params.id } });
    res.json(note || { content: "", updatedByName: null });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Mettre à jour (ou créer) la note interne partagée d'une conversation
router.put("/:id/note", employeeOnly, async (req, res) => {
  try {
    const { content } = req.body;
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });
    const emp = await Employee.findByPk(req.user.id);
    let note = await ConversationNote.findOne({ where: { conversationId: req.params.id } });
    if (!note) note = await ConversationNote.create({ conversationId: req.params.id, content, updatedByName: emp?.name });
    else { note.content = content; note.updatedByName = emp?.name; await note.save(); }
    req.io?.emit("note_updated", { conversationId: req.params.id, content: note.content, updatedByName: note.updatedByName });
    res.json(note);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
