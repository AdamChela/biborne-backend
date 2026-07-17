// Ces tests couvrent la faille IDOR corrigée cette session (voir src/middleware/convAccess.js) :
// avant le correctif, n'importe quel client/invité authentifié pouvait lire/écrire la conversation
// de n'importe qui d'autre simplement en connaissant son UUID.
const request = require("supertest");
const { buildApp, resetDb } = require("./helpers/testApp");
const { Employee, Client } = require("../src/models");
const bcrypt = require("bcryptjs");

const app = buildApp();

async function registerAndApproveClient(email) {
  await request(app).post("/api/auth/client/register").send({ name: "Client " + email, email, password: "clientpass1" });
  const client = await Client.findOne({ where: { email } });
  const verify = await request(app).post("/api/auth/client/verify").send({ email, code: client.verifyCode });
  await Client.update({ approved: true }, { where: { email } });
  return { token: verify.body.token, conversationId: verify.body.conversationId };
}

async function makeEmployeeToken() {
  const emp = await Employee.create({ name: "Agent", email: "agent@biborne.com", password: await bcrypt.hash("pass12345", 10) });
  const login = await request(app).post("/api/auth/employee/login").send({ email: "agent@biborne.com", password: "pass12345" });
  return login.body.token;
}

describe("IDOR - accès aux conversations", () => {
  beforeEach(async () => { await resetDb(); });

  test("un client ne peut pas lire les messages d'une conversation qui n'est pas la sienne", async () => {
    const a = await registerAndApproveClient("a@test.com");
    const b = await registerAndApproveClient("b@test.com");

    // A envoie un message dans sa propre conversation : autorisé.
    const send = await request(app)
      .post(`/api/messages/${a.conversationId}/text`)
      .set("Authorization", "Bearer " + a.token)
      .send({ content: "Message privé de A" });
    expect(send.status).toBe(200);

    // B essaie de lire la conversation de A en devinant/volant son UUID : doit être refusé.
    const read = await request(app)
      .get(`/api/messages/${a.conversationId}`)
      .set("Authorization", "Bearer " + b.token);
    expect(read.status).toBe(403);

    // B essaie d'écrire dans la conversation de A : doit être refusé aussi.
    const write = await request(app)
      .post(`/api/messages/${a.conversationId}/text`)
      .set("Authorization", "Bearer " + b.token)
      .send({ content: "Injecté par B" });
    expect(write.status).toBe(403);

    // A peut bien relire sa propre conversation, et n'y voit que son propre message.
    const ownRead = await request(app)
      .get(`/api/messages/${a.conversationId}`)
      .set("Authorization", "Bearer " + a.token);
    expect(ownRead.status).toBe(200);
    expect(ownRead.body.messages.length).toBe(1);
    expect(ownRead.body.messages[0].content).toBe("Message privé de A");
  });

  test("un employé peut lire n'importe quelle conversation", async () => {
    const a = await registerAndApproveClient("a2@test.com");
    const empToken = await makeEmployeeToken();
    const res = await request(app)
      .get(`/api/messages/${a.conversationId}`)
      .set("Authorization", "Bearer " + empToken);
    expect(res.status).toBe(200);
  });

  test("la liste des participants d'une conversation est protégée de la même façon", async () => {
    const a = await registerAndApproveClient("a3@test.com");
    const b = await registerAndApproveClient("b3@test.com");
    const forbidden = await request(app)
      .get(`/api/conversations/${a.conversationId}/participants`)
      .set("Authorization", "Bearer " + b.token);
    expect(forbidden.status).toBe(403);
    const allowed = await request(app)
      .get(`/api/conversations/${a.conversationId}/participants`)
      .set("Authorization", "Bearer " + a.token);
    expect(allowed.status).toBe(200);
  });

  test("un invité n'a accès qu'à la conversation de son lien d'invitation", async () => {
    const a = await registerAndApproveClient("a4@test.com");
    const b = await registerAndApproveClient("b4@test.com");
    const empToken = await makeEmployeeToken();

    const invite = await request(app)
      .post(`/api/invites/${a.conversationId}/invite`)
      .set("Authorization", "Bearer " + empToken);
    expect(invite.status).toBe(200);

    const join = await request(app).post(`/api/invites/join/${invite.body.code}`).send({
      displayName: "Invité Test", role: "employee", phone: "0600000000",
    });
    expect(join.status).toBe(200);
    const guestToken = join.body.token;

    const readOwn = await request(app)
      .get(`/api/messages/${a.conversationId}`)
      .set("Authorization", "Bearer " + guestToken);
    expect(readOwn.status).toBe(200);

    const readOther = await request(app)
      .get(`/api/messages/${b.conversationId}`)
      .set("Authorization", "Bearer " + guestToken);
    expect(readOther.status).toBe(403);
  });

  test("la liste des conversations (GET /api/conversations) ne fuit pas les conversations des autres", async () => {
    const a = await registerAndApproveClient("a6@test.com");
    const b = await registerAndApproveClient("b6@test.com"); // conversation d'un autre client, ne doit jamais apparaître
    const empToken = await makeEmployeeToken();

    const invite = await request(app)
      .post(`/api/invites/${a.conversationId}/invite`)
      .set("Authorization", "Bearer " + empToken);
    const join = await request(app).post(`/api/invites/join/${invite.body.code}`).send({
      displayName: "Invité Test", role: "employee", phone: "0600000001",
    });
    const guestToken = join.body.token;

    const guestList = await request(app).get("/api/conversations").set("Authorization", "Bearer " + guestToken);
    expect(guestList.status).toBe(200);
    expect(guestList.body.length).toBe(1);
    expect(guestList.body[0].id).toBe(a.conversationId);

    const clientList = await request(app).get("/api/conversations").set("Authorization", "Bearer " + a.token);
    expect(clientList.status).toBe(200);
    expect(clientList.body.length).toBe(1);
    expect(clientList.body[0].id).toBe(a.conversationId);

    const empList = await request(app).get("/api/conversations").set("Authorization", "Bearer " + empToken);
    expect(empList.status).toBe(200);
    expect(empList.body.length).toBe(2); // un employé voit bien tout : a et b
  });

  test("requête sans token refusée partout", async () => {
    const a = await registerAndApproveClient("a5@test.com");
    const res = await request(app).get(`/api/messages/${a.conversationId}`);
    expect(res.status).toBe(401);
  });
});
