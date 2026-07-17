const { Conversation } = require("../models");

// Vérifie que l'utilisateur authentifié a le droit d'accéder à CETTE conversation précise
// (et pas juste qu'il a un token valide quelconque). Sans ce contrôle, un client ou un invité
// qui connaît/devine l'ID d'une conversation qui n'est pas la sienne pourrait lire les messages
// et les numéros de téléphone d'un autre restaurant (faille IDOR).
// Les employés voient toutes les conversations (comportement voulu) : aucune restriction pour eux.
async function sameConversationOnly(req, res, next) {
  if (req.user.type === "employee") return next();
  const convId = req.params.convId || req.params.id;
  try {
    if (req.user.type === "guest") {
      // L'ID de la conversation est embarqué dans le token de l'invité à sa création (voir invites.routes.js).
      if (req.user.conversationId !== convId) return res.status(403).json({ error: "Accès refusé" });
      return next();
    }
    if (req.user.type === "client") {
      const conv = await Conversation.findByPk(convId);
      if (!conv || conv.clientId !== req.user.id) return res.status(403).json({ error: "Accès refusé" });
      return next();
    }
    return res.status(403).json({ error: "Accès refusé" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Erreur serveur" });
  }
}

module.exports = { sameConversationOnly };
