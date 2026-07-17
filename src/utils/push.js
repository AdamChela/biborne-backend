const webpush = require("web-push");
const { PushSubscription } = require("../models");

const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const configured = !!(VAPID_PUBLIC && VAPID_PRIVATE);
if (configured) {
  webpush.setVapidDetails("mailto:adam.biborne@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);
}

// Envoie une notification push à tous les appareils abonnés d'un compte donné.
// Ne fait rien si les clés VAPID ne sont pas configurées (mode dégradé, pas d'erreur).
async function sendPushToOwner(ownerType, ownerId, payload) {
  if (!configured) return;
  try {
    const subs = await PushSubscription.findAll({ where: { ownerType, ownerId: String(ownerId) } });
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify(payload)
        );
      } catch (e) {
        // Abonnement expiré/révoqué côté navigateur : on le supprime pour ne plus réessayer dans le vide.
        if (e.statusCode === 410 || e.statusCode === 404) await s.destroy().catch(() => {});
      }
    }));
  } catch (e) {
    console.error("[Push] Erreur sendPushToOwner:", e.message);
  }
}

module.exports = { sendPushToOwner, VAPID_PUBLIC, configured };
