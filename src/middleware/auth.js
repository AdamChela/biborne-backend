const jwt = require("jsonwebtoken");

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error: "Token manquant" });
  try {
    req.user = jwt.verify(header.replace("Bearer ", ""), process.env.JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token invalide ou expiré" });
  }
}

function employeeOnly(req, res, next) {
  if (req.user?.type !== "employee") return res.status(403).json({ error: "Accès réservé aux employés" });
  next();
}

module.exports = { authMiddleware, employeeOnly };
