const express = require("express");
const { PushSubscription } = require("../models");
const { authMiddleware } = require("../middleware/auth");
const { alertError } = require("../utils/alert");
const { VAPID_PUBLIC, configured } = require("../utils/push");

const router = express.Router();

// Clé publique VAPID : pas un secret, la PWA en a besoin pour s'abonner (PushManager.subscribe).
router.get("/vapid-public-key", (req, res) => {
  res.json({ key: VAPID_PUBLIC || null, configured });
});

router.use(authMiddleware);

// Enregistre (ou met à jour) l'abonnement push du navigateur courant pour le compte connecté.
router.post("/subscribe", async (req, res) => {
  try {
    const { endpoint, keys } = req.body?.subscription || req.body || {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) return res.status(400).json({ error: "Abonnement invalide" });
    const [sub] = await PushSubscription.findOrCreate({
      where: { endpoint },
      defaults: { ownerType: req.user.type, ownerId: String(req.user.id), endpoint, p256dh: keys.p256dh, auth: keys.auth },
    });
    // Si l'abonnement existait déjà (ex: rechargement de page) mais rattaché à un autre compte
    // sur le même navigateur, on le réassigne au compte actuellement connecté.
    sub.ownerType = req.user.type; sub.ownerId = String(req.user.id); sub.p256dh = keys.p256dh; sub.auth = keys.auth;
    await sub.save();
    res.json({ ok: true });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.post("/unsubscribe", async (req, res) => {
  try {
    const { endpoint } = req.body;
    if (endpoint) await PushSubscription.destroy({ where: { endpoint } });
    res.json({ ok: true });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
