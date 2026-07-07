const express = require("express");
const { Conversation, Client, Employee, Message } = require("../models");
const { authMiddleware, employeeOnly } = require("../middleware/auth");

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
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
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
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Assigner un employé
router.patch("/:id/assign", employeeOnly, async (req, res) => {
  try {
    const conv = await Conversation.findByPk(req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });
    conv.employeeId = req.user.id;
    await conv.save();
    res.json(conv);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
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
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
