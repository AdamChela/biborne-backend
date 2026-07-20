const { sendEmail, emailConfigured } = require("./email");

const ALERT_TO = process.env.ALERT_EMAIL || "adam.biborne@gmail.com";
const RATE_LIMIT_MS = 30 * 60 * 1000; // 30 min : évite de spammer si la même erreur se répète en boucle

const lastSent = new Map(); // signature d'erreur -> timestamp du dernier email envoyé pour cette erreur

async function sendAlertEmail(subject, text) {
  if (!emailConfigured()) {
    console.log(`\n🚨 ALERTE (email non configuré) : ${subject}\n${text}\n`);
    return;
  }
  try {
    await sendEmail({ to: ALERT_TO, subject: `[Biborne] ${subject}`, text });
  } catch (e) {
    console.error("[Alert] Échec envoi email d'alerte :", e.message);
  }
}

// Appelée depuis les catch(e) des routes quand une erreur serveur (500) survient.
// Limitée à 1 email par 30 min pour une même erreur sur une même route, pour ne pas spammer
// la boîte mail si un bug se répète en boucle.
function alertError(req, err) {
  try {
    const signature = `${req?.method || "?"} ${req?.originalUrl || "?"} :: ${err?.message || err}`;
    const now = Date.now();
    const last = lastSent.get(signature) || 0;
    if (now - last < RATE_LIMIT_MS) return;
    lastSent.set(signature, now);
    const body = [
      `Route : ${req?.method || "?"} ${req?.originalUrl || "?"}`,
      `Erreur : ${err?.message || err}`,
      err?.stack ? `\nStack :\n${err.stack}` : "",
      `\nDate : ${new Date().toLocaleString("fr-FR")}`,
    ].join("\n");
    sendAlertEmail("🐞 Erreur serveur", body).catch(() => {});
  } catch (e) {
    // L'alerte elle-même ne doit jamais faire planter la requête d'origine.
    console.error("[Alert] Erreur interne alertError:", e.message);
  }
}

module.exports = { alertError, sendAlertEmail };
