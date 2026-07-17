// Exécuté par Jest AVANT le chargement de tout module de l'app (voir "setupFiles" dans package.json).
// Force une base SQLite en mémoire dédiée aux tests : jamais la vraie base Postgres/dev,
// et une base fraîche à chaque exécution (voir tests/helpers/testApp.js -> sequelize.sync({force:true})).
process.env.DATABASE_URL = "sqlite::memory:";
process.env.JWT_SECRET = "test-secret-key-for-jest-do-not-use-in-prod";
process.env.NODE_ENV = "test";
