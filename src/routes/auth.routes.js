const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { Employee, Client, Conversation } = require("../models");
const { sendVerificationEmail, sendPasswordResetEmail } = require("../utils/email");
const { authMiddleware, employeeOnly } = require("../middleware/auth");
const { alertError } = require("../utils/alert");

const router = express.Router();

function makeToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: "90d" });
}
function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// ── CONNEXION UNIFIEE (PWA) ─────────────────────────────────────────────────────
// Détecte automatiquement s'il s'agit d'un employé ou d'un client à partir de l'email.
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" });

    const emp = await Employee.findOne({ where: { email } });
    if (emp) {
      if (!await bcrypt.compare(password, emp.password)) return res.status(401).json({ error: "Email ou mot de passe incorrect" });
      const token = makeToken({ id: emp.id, type: "employee", role: emp.role, name: emp.name, canDelete: !!emp.canDelete });
      return res.json({ type: "employee", token, employee: { id: emp.id, name: emp.name, email: emp.email, role: emp.role, canDelete: !!emp.canDelete } });
    }

    const client = await Client.findOne({ where: { email } });
    if (client) {
      if (!client.verified) return res.status(403).json({ error: "Compte non vérifié, vérifiez votre email", needsVerification: true });
      if (!await bcrypt.compare(password, client.password)) return res.status(401).json({ error: "Email ou mot de passe incorrect" });
      let conv = await Conversation.findOne({ where: { clientId: client.id } });
      if (!conv) conv = await Conversation.create({ clientId: client.id });
      const token = makeToken({ id: client.id, type: "client" });
      return res.json({
        type: "client", token,
        client: { id: client.id, name: client.name, email: client.email, phone: client.phone, restaurantName: client.restaurantName, city: client.city },
        conversationId: conv.id,
      });
    }

    return res.status(401).json({ error: "Email ou mot de passe incorrect" });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// ── EMPLOYES ──────────────────────────────────────────────────────────────────
router.post("/employee/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "Champs manquants" });
    if (await Employee.findOne({ where: { email } })) return res.status(409).json({ error: "Email déjà utilisé" });
    const emp = await Employee.create({ name, email, password: await bcrypt.hash(password, 10), role: role || "agent" });
    const token = makeToken({ id: emp.id, type: "employee", role: emp.role, name: emp.name, canDelete: !!emp.canDelete });
    res.json({ token, employee: { id: emp.id, name: emp.name, email: emp.email, role: emp.role, canDelete: !!emp.canDelete } });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

router.post("/employee/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const emp = await Employee.findOne({ where: { email } });
    if (!emp || !await bcrypt.compare(password, emp.password))
      return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    const token = makeToken({ id: emp.id, type: "employee", role: emp.role, name: emp.name, canDelete: !!emp.canDelete });
    res.json({ token, employee: { id: emp.id, name: emp.name, email: emp.email, role: emp.role, canDelete: !!emp.canDelete } });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Liste des collègues (pour les mentions @ dans les messages)
router.get("/employees", authMiddleware, employeeOnly, async (req, res) => {
  try {
    const emps = await Employee.findAll({ attributes: ["id", "name"], order: [["name", "ASC"]] });
    res.json(emps);
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// ── MOT DE PASSE OUBLIE (employé ou client) ─────────────────────────────────────
// Demande d'un code de réinitialisation, envoyé par email (valable 15 min).
router.post("/forgot-password", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email requis" });

    const code = randomCode();
    const expiry = new Date(Date.now() + 15 * 60 * 1000); // 15 min

    const emp = await Employee.findOne({ where: { email } });
    if (emp) {
      emp.resetCode = code; emp.resetExpiry = expiry;
      await emp.save();
      await sendPasswordResetEmail(email, emp.name, code);
    } else {
      const client = await Client.findOne({ where: { email } });
      if (client) {
        client.resetCode = code; client.resetExpiry = expiry;
        await client.save();
        await sendPasswordResetEmail(email, client.name, code);
      }
    }
    // Réponse volontairement identique que le compte existe ou non : on ne révèle jamais
    // si un email est associé à un compte (bonne pratique de sécurité).
    res.json({ message: "Si un compte existe avec cet email, un code de réinitialisation vient d'être envoyé." });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Réinitialisation effective avec le code reçu par email.
router.post("/reset-password", async (req, res) => {
  try {
    const { email, code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: "Champs manquants" });
    if (newPassword.length < 6) return res.status(400).json({ error: "Mot de passe trop court (6 caractères minimum)" });

    const emp = await Employee.findOne({ where: { email } });
    if (emp) {
      if (!emp.resetCode || emp.resetCode !== code) return res.status(400).json({ error: "Code incorrect" });
      if (!emp.resetExpiry || new Date() > new Date(emp.resetExpiry)) return res.status(400).json({ error: "Code expiré" });
      emp.password = await bcrypt.hash(newPassword, 10);
      emp.resetCode = null; emp.resetExpiry = null;
      await emp.save();
      return res.json({ message: "Mot de passe mis à jour" });
    }

    const client = await Client.findOne({ where: { email } });
    if (client) {
      if (!client.resetCode || client.resetCode !== code) return res.status(400).json({ error: "Code incorrect" });
      if (!client.resetExpiry || new Date() > new Date(client.resetExpiry)) return res.status(400).json({ error: "Code expiré" });
      client.password = await bcrypt.hash(newPassword, 10);
      client.resetCode = null; client.resetExpiry = null;
      await client.save();
      return res.json({ message: "Mot de passe mis à jour" });
    }

    res.status(404).json({ error: "Compte introuvable" });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// ── CLIENTS ───────────────────────────────────────────────────────────────────

// Étape 1 : Inscription → envoie le code par email
router.post("/client/register", async (req, res) => {
  try {
    const { name, email, phone, password, restaurantName, city } = req.body;
    if (!name || !email || !password) return res.status(400).json({ error: "Nom, email et mot de passe requis" });
    if (password.length < 6) return res.status(400).json({ error: "Mot de passe trop court (6 caractères minimum)" });

    const code = randomCode();
    const expiry = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    const hashed = await bcrypt.hash(password, 10);

    const existing = await Client.findOne({ where: { email } });
    if (existing?.verified) return res.status(409).json({ error: "Cet email est déjà utilisé" });

    if (existing) {
      // Mise à jour du compte non vérifié
      Object.assign(existing, { name, phone, password: hashed, restaurantName, city, verifyCode: code, verifyExpiry: expiry });
      await existing.save();
    } else {
      await Client.create({ name, email, phone, password: hashed, restaurantName, city, verifyCode: code, verifyExpiry: expiry });
    }

    await sendVerificationEmail(email, name, code);
    res.json({ message: "Code envoyé à " + email });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Étape 2 : Vérification du code → active le compte + crée la conversation permanente
router.post("/client/verify", async (req, res) => {
  try {
    const { email, code } = req.body;
    const client = await Client.findOne({ where: { email } });
    if (!client) return res.status(404).json({ error: "Compte introuvable" });
    if (client.verified) return res.status(400).json({ error: "Compte déjà vérifié" });
    if (client.verifyCode !== code) return res.status(400).json({ error: "Code incorrect" });
    if (new Date() > new Date(client.verifyExpiry)) return res.status(400).json({ error: "Code expiré" });

    client.verified = true;
    client.verifyCode = null;
    client.verifyExpiry = null;
    await client.save();

    // Crée la conversation permanente
    const conv = await Conversation.create({ clientId: client.id });
    const token = makeToken({ id: client.id, type: "client" });

    res.json({
      token,
      client: { id: client.id, name: client.name, email: client.email, phone: client.phone, restaurantName: client.restaurantName, city: client.city },
      conversationId: conv.id,
    });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Connexion client (email + mot de passe)
router.post("/client/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: "Email et mot de passe requis" });
    const client = await Client.findOne({ where: { email } });
    if (!client) return res.status(401).json({ error: "Email ou mot de passe incorrect" });
    if (!client.verified) return res.status(403).json({ error: "Compte non vérifié, vérifiez votre email", needsVerification: true });
    if (!await bcrypt.compare(password, client.password)) return res.status(401).json({ error: "Email ou mot de passe incorrect" });

    let conv = await Conversation.findOne({ where: { clientId: client.id } });
    if (!conv) conv = await Conversation.create({ clientId: client.id });

    const token = makeToken({ id: client.id, type: "client" });
    res.json({
      token,
      client: { id: client.id, name: client.name, email: client.email, phone: client.phone, restaurantName: client.restaurantName, city: client.city },
      conversationId: conv.id,
    });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

// Renvoyer le code
router.post("/client/resend-code", async (req, res) => {
  try {
    const { email } = req.body;
    const client = await Client.findOne({ where: { email } });
    if (!client || client.verified) return res.status(400).json({ error: "Compte introuvable ou déjà vérifié" });
    const code = randomCode();
    client.verifyCode = code;
    client.verifyExpiry = new Date(Date.now() + 10 * 60 * 1000);
    await client.save();
    await sendVerificationEmail(email, client.name, code);
    res.json({ message: "Nouveau code envoyé" });
  } catch (e) { console.error(e); alertError(req, e); res.status(500).json({ error: "Erreur serveur" }); }
});

module.exports = router;
