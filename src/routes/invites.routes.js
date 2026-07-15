const express = require("express");
const jwt = require("jsonwebtoken");
const { ConversationInvite, ConversationParticipant, Conversation, Client } = require("../models");
const { authMiddleware } = require("../middleware/auth");

const router = express.Router();

function randCode(n=12){
  const c="ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:n},()=>c[Math.floor(Math.random()*c.length)]).join("");
}

// Créer un lien (30 min, 1 seule utilisation)
router.post("/:convId/invite", authMiddleware, async (req, res) => {
  try {
    const conv = await Conversation.findByPk(req.params.convId);
    if (!conv) return res.status(404).json({ error: "Conversation introuvable" });
    if (req.user.type === "client" && conv.clientId !== req.user.id) return res.status(403).json({ error: "Accès refusé" });

    const code = randCode(12);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
    await ConversationInvite.create({ conversationId: req.params.convId, code, expiresAt });
    res.json({ code, expiresAt });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Infos sur le lien
router.get("/join/:code", async (req, res) => {
  try {
    const invite = await ConversationInvite.findOne({
      where: { code: req.params.code },
      include: [{ model: Conversation, include: [Client] }],
    });
    if (!invite) return res.status(404).json({ error: "Lien invalide" });
    if (invite.usedAt) return res.status(410).json({ error: "Ce lien a déjà été utilisé" });
    if (invite.expiresAt < new Date()) return res.status(410).json({ error: "Ce lien a expiré (30 min)" });
    const conv = invite.Conversation;
    res.json({
      conversationId: conv.id,
      restaurantName: conv.Client?.restaurantName || conv.Client?.name || "Restaurant",
      city: conv.Client?.city || "",
      expiresAt: invite.expiresAt,
    });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Rejoindre (1 seule utilisation)
router.post("/join/:code", async (req, res) => {
  try {
    const { displayName, role, phone } = req.body;
    if (!displayName?.trim()) return res.status(400).json({ error: "Prénom requis" });
    if (!["manager","employee"].includes(role)) return res.status(400).json({ error: "Rôle invalide" });
    if (!phone?.trim()) return res.status(400).json({ error: "Numéro de téléphone requis" });

    const invite = await ConversationInvite.findOne({ where: { code: req.params.code } });
    if (!invite) return res.status(404).json({ error: "Lien invalide" });
    if (invite.usedAt) return res.status(410).json({ error: "Ce lien a déjà été utilisé" });
    if (invite.expiresAt < new Date()) return res.status(410).json({ error: "Ce lien a expiré" });

    // On crée d'abord le participant (sans token) pour obtenir son id : le token JWT a besoin
    // de cet id afin que l'invité puisse rejoindre sa room d'appel personnelle (guest:<id>).
    const participant = await ConversationParticipant.create({
      conversationId: invite.conversationId,
      displayName: displayName.trim(),
      role,
      phone: phone.trim(),
    });

    const guestToken = jwt.sign(
      { type: "guest", id: participant.id, conversationId: invite.conversationId, displayName: displayName.trim(), role, phone: phone.trim() },
      process.env.JWT_SECRET,
      { expiresIn: "90d" }
    );
    participant.guestToken = guestToken;
    await participant.save();

    // On ne marque le lien "utilisé" qu'une fois l'invité effectivement créé avec succès :
    // sinon une erreur imprévue grille le lien à usage unique sans que personne n'ait pu rejoindre.
    invite.usedAt = new Date();
    invite.usedBy = displayName.trim();
    await invite.save();

    res.json({ token: guestToken, participant: { id: participant.id, displayName: displayName.trim(), role, phone: phone.trim() }, conversationId: invite.conversationId });
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
