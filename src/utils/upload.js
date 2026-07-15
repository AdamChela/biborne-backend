const multer = require("multer");

// Stockage en mémoire (et non sur disque) : les fichiers sont envoyés vers Cloudinary
// juste après (voir routes/messages.routes.js + utils/cloudinary.js), donc pas besoin
// d'écrire sur le disque local de Render, qui est de toute façon effacé à chaque déploiement.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });
module.exports = { upload };
