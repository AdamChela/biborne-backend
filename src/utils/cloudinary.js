const cloudinary = require("cloudinary").v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Envoie un buffer (fichier gardé en mémoire par multer, voir utils/upload.js) vers Cloudinary
// et renvoie l'URL publique permanente. Contrairement au disque de Render (effacé à chaque
// déploiement sur le plan gratuit), Cloudinary conserve les fichiers durablement.
function uploadBuffer(buffer, originalname, mimetype) {
  return new Promise((resolve, reject) => {
    const resourceType = mimetype?.startsWith("video/") ? "video"
      : mimetype?.startsWith("audio/") ? "video" // Cloudinary traite l'audio via le pipeline "video"
      : mimetype?.startsWith("image/") ? "image"
      : "raw";
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: resourceType, folder: "biborne", use_filename: true, unique_filename: true },
      (err, result) => { if (err) reject(err); else resolve(result); }
    );
    stream.end(buffer);
  });
}

// Supprime un fichier sur Cloudinary (utilisé par le nettoyage automatique après 30 jours,
// voir utils/mediaCleanup.js). resourceType doit correspondre à celui utilisé à l'upload
// ("image"/"video"/"raw"), sinon Cloudinary ne retrouve pas le fichier.
function deleteAsset(publicId, resourceType) {
  return cloudinary.uploader.destroy(publicId, { resource_type: resourceType || "image" });
}

// Pour les fichiers envoyés avant l'ajout des colonnes cloudinaryPublicId/cloudinaryResourceType :
// on retrouve ces informations en parsant l'URL Cloudinary elle-même (format prévisible).
// Renvoie null si l'URL ne ressemble pas à une URL Cloudinary.
function extractCloudinaryInfoFromUrl(url) {
  if (!url) return null;
  const m = url.match(/\/(image|video|raw)\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?(?:\?.*)?$/);
  if (!m) return null;
  return { resourceType: m[1], publicId: m[2] };
}

module.exports = { cloudinary, uploadBuffer, deleteAsset, extractCloudinaryInfoFromUrl };
