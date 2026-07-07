const express = require("express");
const { CallSession, Client } = require("../models");
const { authMiddleware, employeeOnly } = require("../middleware/auth");

const router = express.Router();
router.use(authMiddleware);

router.post("/", employeeOnly, async (req, res) => {
  try {
    const { clientId } = req.body;
    const client = await Client.findByPk(clientId);
    if (!client) return res.status(404).json({ error: "Client introuvable" });
    const session = await CallSession.create({ callerId: req.user.id, receiverId: clientId, status: "ringing", startedAt: new Date() });
    req.io?.to(`client:${clientId}`).emit("incoming_call", { sessionId: session.id, callerName: req.user.name || "Biborne" });
    res.json(session);
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
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
  } catch (e) { console.error(e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
