const request = require("supertest");
const { buildApp, resetDb } = require("./helpers/testApp");
const { Client, Message } = require("../src/models");

const app = buildApp();

async function registerAndApproveClient(email) {
  await request(app).post("/api/auth/client/register").send({ name: "Client " + email, email, password: "clientpass1" });
  const client = await Client.findOne({ where: { email } });
  const verify = await request(app).post("/api/auth/client/verify").send({ email, code: client.verifyCode });
  await Client.update({ approved: true }, { where: { email } });
  return { token: verify.body.token, conversationId: verify.body.conversationId, clientId: client.id };
}

describe("Messages : édition, suppression, pagination", () => {
  beforeEach(async () => { await resetDb(); });

  test("un client non approuvé ne peut pas envoyer de message", async () => {
    await request(app).post("/api/auth/client/register").send({ name: "Non approuvé", email: "np@test.com", password: "clientpass1" });
    const client = await Client.findOne({ where: { email: "np@test.com" } });
    const verify = await request(app).post("/api/auth/client/verify").send({ email: "np@test.com", code: client.verifyCode });
    const res = await request(app)
      .post(`/api/messages/${verify.body.conversationId}/text`)
      .set("Authorization", "Bearer " + verify.body.token)
      .send({ content: "Je ne devrais pas pouvoir envoyer ça" });
    expect(res.status).toBe(403);
    expect(res.body.needsApproval).toBe(true);
  });

  test("on peut modifier son propre message texte", async () => {
    const a = await registerAndApproveClient("edit@test.com");
    const sent = await request(app)
      .post(`/api/messages/${a.conversationId}/text`)
      .set("Authorization", "Bearer " + a.token)
      .send({ content: "Erreur de frappe" });
    const res = await request(app)
      .patch(`/api/messages/single/${sent.body.id}`)
      .set("Authorization", "Bearer " + a.token)
      .send({ content: "Corrigé" });
    expect(res.status).toBe(200);
    expect(res.body.content).toBe("Corrigé");
    expect(res.body.edited).toBe(true);
  });

  test("on ne peut pas modifier le message de quelqu'un d'autre", async () => {
    const a = await registerAndApproveClient("owner1@test.com");
    const b = await registerAndApproveClient("owner2@test.com");
    const sent = await request(app)
      .post(`/api/messages/${a.conversationId}/text`)
      .set("Authorization", "Bearer " + a.token)
      .send({ content: "Message de A" });
    const res = await request(app)
      .patch(`/api/messages/single/${sent.body.id}`)
      .set("Authorization", "Bearer " + b.token)
      .send({ content: "Piraté par B" });
    expect(res.status).toBe(403);
    const stillOriginal = await Message.findByPk(sent.body.id);
    expect(stillOriginal.content).toBe("Message de A");
  });

  test("la suppression est douce : le contenu est masqué mais la ligne reste", async () => {
    const a = await registerAndApproveClient("del@test.com");
    const sent = await request(app)
      .post(`/api/messages/${a.conversationId}/text`)
      .set("Authorization", "Bearer " + a.token)
      .send({ content: "À supprimer" });
    const res = await request(app)
      .delete(`/api/messages/single/${sent.body.id}`)
      .set("Authorization", "Bearer " + a.token);
    expect(res.status).toBe(200);
    const row = await Message.findByPk(sent.body.id);
    expect(row).not.toBeNull();
    expect(row.deletedAt).not.toBeNull();
    expect(row.content).toBe("À supprimer"); // conservé en base, seul l'affichage le masque côté client
  });

  test("pagination : ne renvoie que les N derniers messages avec hasMore", async () => {
    const a = await registerAndApproveClient("page@test.com");
    for (let i = 0; i < 5; i++) {
      await request(app)
        .post(`/api/messages/${a.conversationId}/text`)
        .set("Authorization", "Bearer " + a.token)
        .send({ content: "Message " + i });
      // Petite pause : garantit un createdAt distinct par message (le curseur "before" en dépend).
      await new Promise(r => setTimeout(r, 5));
    }
    const page1 = await request(app)
      .get(`/api/messages/${a.conversationId}?limit=2`)
      .set("Authorization", "Bearer " + a.token);
    expect(page1.status).toBe(200);
    expect(page1.body.messages.length).toBe(2);
    expect(page1.body.hasMore).toBe(true);
    // Ordre chronologique croissant : les 2 plus récents parmi les 5 (Message 3, Message 4)
    expect(page1.body.messages[0].content).toBe("Message 3");
    expect(page1.body.messages[1].content).toBe("Message 4");

    const page2 = await request(app)
      .get(`/api/messages/${a.conversationId}?limit=2&before=${encodeURIComponent(page1.body.messages[0].createdAt)}`)
      .set("Authorization", "Bearer " + a.token);
    expect(page2.status).toBe(200);
    expect(page2.body.messages.length).toBe(2);
    expect(page2.body.messages[1].content).toBe("Message 2");
  });
});
