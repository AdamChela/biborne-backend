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

module.exports = { cloudinary, uploadBuffer };
