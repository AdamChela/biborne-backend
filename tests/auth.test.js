const request = require("supertest");
const { buildApp, resetDb } = require("./helpers/testApp");
const { Employee, Client } = require("../src/models");
const bcrypt = require("bcryptjs");

const app = buildApp();

async function makeEmployee(email = "agent@biborne.com", password = "motdepasse123") {
  return Employee.create({ name: "Agent Test", email, password: await bcrypt.hash(password, 10), role: "agent" });
}

describe("Auth", () => {
  beforeEach(async () => { await resetDb(); });

  // Vulnérabilité corrigée cette session : l'inscription employé était ouverte à tout le monde.
  test("l'inscription employé est refusée sans token", async () => {
    const res = await request(app).post("/api/auth/employee/register").send({
      name: "Intrus", email: "intrus@biborne.com", password: "hackme123",
    });
    expect(res.status).toBe(401);
    expect(await Employee.count()).toBe(0);
  });

  test("l'inscription employé est refusée avec un token client", async () => {
    await Client.create({ name: "C", email: "c@x.com", password: await bcrypt.hash("pass1234", 10), verified: true, approved: true });
    const login = await request(app).post("/api/auth/login").send({ email: "c@x.com", password: "pass1234" });
    expect(login.status).toBe(200);
    const res = await request(app)
      .post("/api/auth/employee/register")
      .set("Authorization", "Bearer " + login.body.token)
      .send({ name: "Intrus", email: "intrus@biborne.com", password: "hackme123" });
    expect(res.status).toBe(403);
  });

  test("un employé connecté peut créer un collègue", async () => {
    await makeEmployee();
    const login = await request(app).post("/api/auth/employee/login").send({ email: "agent@biborne.com", password: "motdepasse123" });
    expect(login.status).toBe(200);
    const res = await request(app)
      .post("/api/auth/employee/register")
      .set("Authorization", "Bearer " + login.body.token)
      .send({ name: "Nouveau Collègue", email: "nouveau@biborne.com", password: "unautrepass" });
    expect(res.status).toBe(200);
    expect(res.body.employee.email).toBe("nouveau@biborne.com");
    expect(await Employee.count()).toBe(2);
  });

  test("mauvais mot de passe employé refusé", async () => {
    await makeEmployee();
    const res = await request(app).post("/api/auth/employee/login").send({ email: "agent@biborne.com", password: "faux" });
    expect(res.status).toBe(401);
  });

  test("parcours client complet : inscription -> vérification -> connexion", async () => {
    const reg = await request(app).post("/api/auth/client/register").send({
      name: "Client Test", email: "client@test.com", password: "clientpass1", restaurantName: "Chez Test", city: "Paris",
    });
    expect(reg.status).toBe(200);

    // Pas de serveur SMTP configuré en test : le code est stocké en base (jamais envoyé par email),
    // donc on va le chercher directement pour simuler la réception du mail.
    const client = await Client.findOne({ where: { email: "client@test.com" } });
    expect(client.verifyCode).toBeTruthy();

    const verify = await request(app).post("/api/auth/client/verify").send({ email: "client@test.com", code: client.verifyCode });
    expect(verify.status).toBe(200);
    expect(verify.body.token).toBeTruthy();
    // Nouveau compte client : non approuvé tant qu'un employé ne l'a pas validé manuellement.
    expect(verify.body.client.approved).toBe(false);

    const login = await request(app).post("/api/auth/client/login").send({ email: "client@test.com", password: "clientpass1" });
    expect(login.status).toBe(200);
  });

  test("code de vérification incorrect refusé", async () => {
    await request(app).post("/api/auth/client/register").send({ name: "C2", email: "c2@test.com", password: "clientpass1" });
    const res = await request(app).post("/api/auth/client/verify").send({ email: "c2@test.com", code: "000000" });
    expect(res.status).toBe(400);
  });

  test("limite de tentatives de connexion (anti brute-force)", async () => {
    await makeEmployee();
    let last;
    for (let i = 0; i < 11; i++) {
      last = await request(app).post("/api/auth/employee/login").send({ email: "agent@biborne.com", password: "mauvais" });
    }
    expect(last.status).toBe(429);
  });
});
