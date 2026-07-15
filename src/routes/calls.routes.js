const express = require("express");
const { CallSession, Client, ConversationParticipant } = require("../models");
const { authMiddleware, employeeOnly } = require("../middleware/auth");
const { alertError } = require("../utils/alert");

const router = express.Router();
router.use(authMiddleware);

router.post("/", employeeOnly, async (req, res) => {
  try {
    // Rétro-compat : { clientId } seul = appel vers un client (ancien format).
    const { clientId, targetType, targetId, type } = req.body;
    const rt = targetType || "client";
    const rid = targetId || clientId;
    if (!rid) return res.status(400).json({ error: "Destinataire manquant" });

    let room;
    if (rt === "guest") {
      const guest = await ConversationParticipant.findByPk(rid);
      if (!guest) return res.status(404).json({ error: "Invité introuvable" });
      room = `guest:${rid}`;
    } else {
      const client = await Client.findByPk(rid);
      if (!client) return res.status(404).json({ error: "Client introuvable" });
      room = `client:${rid}`;
    }

    const session = await CallSession.create({
      callerId: req.user.id,
      receiverId: rt === "client" ? rid : null,
      receiverType: rt,
      guestReceiverId: rt === "guest" ? rid : null,
      status: "ringing",
      type: type === "video" ? "video" : "audio",
      startedAt: new Date(),
    });
    req.io?.to(room).emit("incoming_call", { sessionId: session.id, callerName: req.user.name || "Biborne" });
    res.json(session);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.patch("/:id", async (req, res) => {
  try {
    const { status } = req.body;
    const session = await CallSession.findByPk(req.params.id);
    if (!session) return res.status(404).json({ error: "Session introuvable" });
    session.status = status;
    if (["ended","missed","declined"].includes(status)) {
      session.endedAt = new Date();
      if (session.startedAt) session.durationSecs = Math.round((session.endedAt - new Date(session.startedAt)) / 1000);
    }
    await session.save();
    res.json(session);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
