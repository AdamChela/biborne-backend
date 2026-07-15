const { Sequelize } = require("sequelize");
const { Conversation, sequelize } = require("../models");
const { sendAlertEmail } = require("./alert");

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

let lastCheck = 0;
let checking = false;

// Vérifications d'intégrité "opportunistes" : le serveur Render gratuit s'endort sans trafic,
// donc un vrai cron programmé n'est pas fiable. À la place, on profite de chaque requête entrante
// pour vérifier si ça fait plus de CHECK_INTERVAL_MS qu'on n'a pas fait le tour — jamais de manière
// bloquante (le check tourne après la réponse, sans jamais ralentir la requête en cours).
function maybeRunSupervision() {
  const now = Date.now();
  if (checking || now - lastCheck < CHECK_INTERVAL_MS) return;
  lastCheck = now;
  checking = true;
  runSupervisionCheck()
    .catch(e => console.error("[Supervision] Erreur:", e.message))
    .finally(() => { checking = false; });
}

async function runSupervisionCheck() {
  const anomalies = [];

  // Un client ne devrait jamais avoir plus d'une conversation (le code applicatif l'empêche,
  // mais une anomalie ici indiquerait un bug ou une écriture directe en base).
  const dupes = await Conversation.findAll({
    attributes: ["clientId", [sequelize.fn("COUNT", sequelize.col("id")), "cnt"]],
    where: { clientId: { [Sequelize.Op.ne]: null } },
    group: ["clientId"],
    having: sequelize.where(sequelize.fn("COUNT", sequelize.col("id")), { [Sequelize.Op.gt]: 1 }),
    raw: true,
  });
  if (dupes.length) {
    anomalies.push(
      `${dupes.length} client(s) ont plusieurs conversations :\n` +
      dupes.map(d => `  - client ${d.clientId} : ${d.cnt} conversations`).join("\n")
    );
  }

  if (anomalies.length) {
    await sendAlertEmail("⚠️ Anomalies détectées", anomalies.join("\n\n"));
  }
}

module.exports = { maybeRunSupervision, runSupervisionCheck };
