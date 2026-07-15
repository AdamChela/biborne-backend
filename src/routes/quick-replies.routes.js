const express = require("express");
const { QuickReply } = require("../models");
const { authMiddleware, employeeOnly } = require("../middleware/auth");
const { alertError } = require("../utils/alert");

const router = express.Router();
router.use(authMiddleware, employeeOnly);

// Liste des réponses rapides partagées
router.get("/", async (req, res) => {
  try {
    const replies = await QuickReply.findAll({ order: [["createdAt", "ASC"]] });
    res.json(replies);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Créer une réponse rapide
router.post("/", async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || !text.trim()) return res.status(400).json({ error: "Texte requis" });
    const reply = await QuickReply.create({ text: text.trim() });
    req.io?.emit("quick_reply_added", reply);
    res.json(reply);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Supprimer une réponse rapide
router.delete("/:id", async (req, res) => {
  try {
    const reply = await QuickReply.findByPk(req.params.id);
    if (!reply) return res.status(404).json({ error: "Réponse rapide introuvable" });
    await reply.destroy();
    req.io?.emit("quick_reply_deleted", { id: req.params.id });
    res.json({ ok: true });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
