const { Op } = require("sequelize");
const { Message } = require("../models");
const { deleteAsset, extractCloudinaryInfoFromUrl } = require("./cloudinary");
const { sendAlertEmail } = require("./alert");

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 jours
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;  // 6h, même logique "opportuniste" que utils/supervision.js

let io = null;
function setIo(instance) { io = instance; }

let lastCheck = 0;
let checking = false;

// Nettoyage "opportuniste" (même principe que utils/supervision.js) : le serveur Render gratuit
// s'endort sans trafic, donc un vrai cron programmé n'est pas fiable. À la place, on profite de
// chaque requête entrante pour vérifier si ça fait plus de CHECK_INTERVAL_MS qu'on n'a pas fait
// le tour — jamais de manière bloquante (tourne après la réponse, sans ralentir la requête en cours).
function maybeRunMediaCleanup() {
  const now = Date.now();
  if (checking || now - lastCheck < CHECK_INTERVAL_MS) return;
  lastCheck = now;
  checking = true;
  runMediaCleanup()
    .catch(e => console.error("[MediaCleanup] Erreur:", e.message))
    .finally(() => { checking = false; });
}

// Supprime définitivement, sur Cloudinary, tout média envoyé il y a plus de 30 jours, et marque
// le message correspondant comme "expiré" (le message reste visible dans l'historique — texte de
// légende, date, expéditeur — mais le fichier n'est plus accessible : voir Message.mediaExpired).
async function runMediaCleanup() {
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const rows = await Message.findAll({
    where: {
      type: { [Op.in]: ["image", "video", "audio", "file"] },
      fileUrl: { [Op.ne]: null },
      mediaExpired: false,
      createdAt: { [Op.lt]: cutoff },
    },
  });
  if (!rows.length) return;

  let deleted = 0;
  const failures = [];
  for (const msg of rows) {
    try {
      // Colonnes dédiées si le message a été envoyé après l'ajout de cette fonctionnalité,
      // sinon on retrouve les mêmes infos en parsant l'URL Cloudinary (messages plus anciens).
      let publicId = msg.cloudinaryPublicId;
      let resourceType = msg.cloudinaryResourceType;
      if (!publicId) {
        const info = extractCloudinaryInfoFromUrl(msg.fileUrl);
        if (info) { publicId = info.publicId; resourceType = info.resourceType; }
      }
      if (publicId) await deleteAsset(publicId, resourceType);
      msg.fileUrl = null;
      msg.cloudinaryPublicId = null;
      msg.mediaExpired = true;
      await msg.save();
      deleted++;
      io?.to(msg.conversationId).emit("media_expired", { id: msg.id, conversationId: msg.conversationId });
    } catch (e) {
      failures.push(`${msg.id} : ${e.message}`);
    }
  }

  console.log(`[MediaCleanup] ${deleted} média(s) expiré(s) supprimé(s) (>${RETENTION_MS / 86400000}j).`);
  if (failures.length) {
    console.error("[MediaCleanup] Échecs :", failures);
    await sendAlertEmail("⚠️ Nettoyage média : échecs partiels",
      `${failures.length} suppression(s) ont échoué sur ${rows.length} :\n\n${failures.join("\n")}`
    ).catch(() => {});
  }
}

module.exports = { setIo, maybeRunMediaCleanup, runMediaCleanup };
