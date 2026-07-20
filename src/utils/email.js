// Envoi d'emails via l'API HTTP de Resend (https://resend.com).
// Le SMTP direct (Gmail, puis même le relais SMTP de Resend) timeout systématiquement depuis Render :
// c'est Render qui bloque les connexions SMTP sortantes en général, pas juste Gmail. L'API HTTP de
// Resend passe en HTTPS (port 443), jamais bloqué, donc la seule méthode fiable dans cet environnement.
const RESEND_API_KEY = process.env.RESEND_API_KEY || process.env.EMAIL_PASS; // EMAIL_PASS = fallback (déjà la clé Resend)
const EMAIL_FROM = process.env.EMAIL_FROM || "Biborne <onboarding@resend.dev>";

function emailConfigured() {
  return !!RESEND_API_KEY;
}

async function sendEmail({ to, subject, html, text }) {
  if (!RESEND_API_KEY) {
    // Mode dev : pas de clé configurée, on affiche juste dans la console au lieu d'envoyer.
    console.log(`\n📧 EMAIL NON ENVOYÉ (RESEND_API_KEY manquante) — à : ${to} — sujet : ${subject}\n${text || ""}\n`);
    return;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: EMAIL_FROM, to, subject, html, text }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend a refusé l'envoi (${res.status}) : ${body.slice(0, 200)}`);
  }
}

async function sendVerificationEmail(to, name, code) {
  await sendEmail({
    to,
    subject: "Votre code de vérification Biborne",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <div style="background:linear-gradient(135deg,#E85D24,#FF7A45);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:32px;font-weight:800;color:#fff">B</span>
          <h1 style="color:#fff;font-size:20px;margin:8px 0 0">Biborne Messagerie</h1>
        </div>
        <p style="color:#1A1410;font-size:16px">Bonjour <strong>${name}</strong>,</p>
        <p style="color:#6B5E54;font-size:14px">Voici votre code de vérification :</p>
        <div style="background:#FFF0EB;border-radius:12px;padding:24px;text-align:center;margin:20px 0">
          <span style="font-size:40px;font-weight:800;color:#E85D24;letter-spacing:8px">${code}</span>
        </div>
        <p style="color:#B0A49C;font-size:13px">Valable <strong>10 minutes</strong>. Ne le partagez avec personne.</p>
      </div>`,
  });
}

async function sendPasswordResetEmail(to, name, code) {
  await sendEmail({
    to,
    subject: "Réinitialisation de votre mot de passe Biborne",
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px">
        <div style="background:linear-gradient(135deg,#E85D24,#FF7A45);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px">
          <span style="font-size:32px;font-weight:800;color:#fff">B</span>
          <h1 style="color:#fff;font-size:20px;margin:8px 0 0">Biborne Messagerie</h1>
        </div>
        <p style="color:#1A1410;font-size:16px">Bonjour <strong>${name}</strong>,</p>
        <p style="color:#6B5E54;font-size:14px">Voici votre code pour réinitialiser votre mot de passe :</p>
        <div style="background:#FFF0EB;border-radius:12px;padding:24px;text-align:center;margin:20px 0">
          <span style="font-size:40px;font-weight:800;color:#E85D24;letter-spacing:8px">${code}</span>
        </div>
        <p style="color:#B0A49C;font-size:13px">Valable <strong>15 minutes</strong>. Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet email.</p>
      </div>`,
  });
}

module.exports = { sendVerificationEmail, sendPasswordResetEmail, sendEmail, emailConfigured };
