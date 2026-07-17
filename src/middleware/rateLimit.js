// Limiteur de tentatives simple, en mémoire (pas de dépendance externe, une seule instance Render).
// Sert à ralentir le brute force sur les mots de passe et les codes à 6 chiffres
// (connexion, code de vérification, code de réinitialisation).
const buckets = new Map(); // clé -> { count, resetAt }

// Nettoyage périodique pour ne pas accumuler indéfiniment des entrées expirées en mémoire.
setInterval(() => {
  const now = Date.now();
  for (const [key, b] of buckets) if (now > b.resetAt) buckets.delete(key);
}, 10 * 60 * 1000).unref();

function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, keyFn } = {}) {
  return (req, res, next) => {
    const key = (keyFn ? keyFn(req) : req.ip) || "unknown";
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.resetAt) { b = { count: 0, resetAt: now + windowMs }; buckets.set(key, b); }
    b.count++;
    if (b.count > max) {
      const retryMin = Math.ceil((b.resetAt - now) / 60000);
      return res.status(429).json({ error: `Trop de tentatives. Réessaie dans ${retryMin} min.` });
    }
    next();
  };
}

module.exports = { rateLimit };
