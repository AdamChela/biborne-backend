const nodemailer = require("nodemailer");

function getTransporter() {
  if (!process.env.EMAIL_HOST || !process.env.EMAIL_USER) return null;
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: parseInt(process.env.EMAIL_PORT || "587"),
    secure: process.env.EMAIL_PORT === "465",
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    // Sans ces limites, une connexion SMTP bloquée (ex: port sortant filtré par l'hébergeur)
    // fait attendre la requête indéfiniment côté client (bouton "Envoi..." qui ne se débloque jamais).
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 10000,
  });
}

async function sendVerificationEmail(to, name, code) {
  const transporter = getTransporter();
  if (!transporter) {
    // Mode dev : affiche le code dans la console
    console.log(`\n📧 CODE DE VERIFICATION pour ${to} : [ ${code} ]\n`);
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `Biborne <${process.env.EMAIL_USER}>`,
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
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`\n📧 CODE DE REINITIALISATION pour ${to} : [ ${code} ]\n`);
    return;
  }
  await transporter.sendMail({
    from: process.env.EMAIL_FROM || `Biborne <${process.env.EMAIL_USER}>`,
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

module.exports = { sendVerificationEmail, sendPasswordResetEmail, getTransporter };
