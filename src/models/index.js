const { Sequelize, DataTypes } = require("sequelize");

const dbUrl = process.env.DATABASE_URL || "sqlite:./dev.sqlite3";
const sequelize = dbUrl.startsWith("postgres")
  ? new Sequelize(dbUrl, { dialect: "postgres", logging: false })
  : new Sequelize({ dialect: "sqlite", storage: dbUrl.replace("sqlite:", ""), logging: false });

const Employee = sequelize.define("Employee", {
  id:       { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:     { type: DataTypes.STRING, allowNull: false },
  email:    { type: DataTypes.STRING, allowNull: false, unique: true },
  password: { type: DataTypes.STRING, allowNull: false },
  role:     { type: DataTypes.STRING, defaultValue: "agent" },
  isOnline: { type: DataTypes.BOOLEAN, defaultValue: false },
  canDelete: { type: DataTypes.BOOLEAN, defaultValue: false }, // autorisé à supprimer définitivement une conversation
  // Pas de resetCode/resetExpiry ici : le mot de passe employé est fixe et géré manuellement,
  // pas de self-service "mot de passe oublié" pour les employés (voir Client plus bas).
});

const Client = sequelize.define("Client", {
  id:             { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  name:           { type: DataTypes.STRING, allowNull: false },
  email:          { type: DataTypes.STRING, allowNull: false, unique: true },
  phone:          { type: DataTypes.STRING },
  password:       { type: DataTypes.STRING },
  restaurantName: { type: DataTypes.STRING },
  city:           { type: DataTypes.STRING },
  verified:       { type: DataTypes.BOOLEAN, defaultValue: false },
  verifyCode:     { type: DataTypes.STRING },
  verifyExpiry:   { type: DataTypes.DATE },
  resetCode:      { type: DataTypes.STRING }, // mot de passe oublié (distinct de verifyCode, pour ne pas interférer avec l'inscription)
  resetExpiry:    { type: DataTypes.DATE },
  // Validation manuelle par un employé Biborne : empêche n'importe qui (ex: quelqu'un qui installe
  // l'appli depuis le Play Store sans être un vrai client) d'accéder au chat après inscription.
  // L'email vérifié (verified) ne suffit pas : ça prouve juste que l'email existe.
  approved:       { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Conversation = sequelize.define("Conversation", {
  id:           { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  status:       { type: DataTypes.STRING, defaultValue: "open" },
  ticketStatus: { type: DataTypes.STRING, defaultValue: "todo" },
  ticketOwner:  { type: DataTypes.STRING },
  // Nom du "groupe" personnalisable par un employé, prioritaire sur le nom du restaurant du client.
  displayName:  { type: DataTypes.STRING },
  // true dès qu'un client/invité envoie un message ; repassé à false quand un employé ouvre la
  // conversation (voir POST /api/messages/:convId/read). Sert au badge "non lu" côté employé.
  unreadForEmployees: { type: DataTypes.BOOLEAN, defaultValue: false },
});

const Message = sequelize.define("Message", {
  id:         { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  senderType: { type: DataTypes.STRING, allowNull: false },
  type:       { type: DataTypes.STRING, allowNull: false },
  content:    { type: DataTypes.TEXT },
  fileUrl:    { type: DataTypes.STRING },
  fileName:   { type: DataTypes.STRING },
  mimeType:   { type: DataTypes.STRING },
  fileSize:   { type: DataTypes.INTEGER },
  duration:   { type: DataTypes.INTEGER },
  // Identifiants Cloudinary du fichier (nécessaires pour pouvoir le supprimer côté Cloudinary,
  // pas juste effacer l'URL en base). Voir utils/mediaCleanup.js.
  cloudinaryPublicId:     { type: DataTypes.STRING },
  cloudinaryResourceType: { type: DataTypes.STRING }, // "image" | "video" | "raw"
  // true une fois le fichier auto-supprimé après 30 jours (voir utils/mediaCleanup.js) :
  // le message reste dans l'historique mais affiche "Média expiré" à la place du contenu.
  mediaExpired: { type: DataTypes.BOOLEAN, defaultValue: false },
  status:     { type: DataTypes.STRING, defaultValue: "sent" }, // "sent" -> "read"
  callStatus: { type: DataTypes.STRING },
  guestName:  { type: DataTypes.STRING },
  guestId:    { type: DataTypes.UUID },   // id du ConversationParticipant si envoyé par un invité
  guestPhone: { type: DataTypes.STRING }, // téléphone de l'invité, dénormalisé comme guestName
  guestRole:  { type: DataTypes.STRING }, // "employee" ou "manager", dénormalisé comme guestName
  mentions:   { type: DataTypes.TEXT },   // JSON.stringify([{type:"employee"|"guest", id, name}])
  edited:     { type: DataTypes.BOOLEAN, defaultValue: false },
  deletedAt:  { type: DataTypes.DATE }, // suppression "douce" : on garde la ligne, on masque le contenu à l'affichage
});

const CallSession = sequelize.define("CallSession", {
  id:              { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  status:          { type: DataTypes.STRING, defaultValue: "ringing" },
  type:            { type: DataTypes.STRING, defaultValue: "audio" }, // "audio" ou "video"
  receiverType:    { type: DataTypes.STRING, defaultValue: "client" }, // "client" ou "guest"
  // Pas de FK ici (contrairement à receiverId -> Client) : un invité vit dans ConversationParticipants,
  // pas dans Clients, donc on le référence dans un champ libre pour ne pas casser la contrainte existante.
  guestReceiverId: { type: DataTypes.UUID },
  startedAt:       { type: DataTypes.DATE },
  endedAt:         { type: DataTypes.DATE },
  durationSecs:    { type: DataTypes.INTEGER },
});

const ConversationInvite = sequelize.define("ConversationInvite", {
  id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  code:      { type: DataTypes.STRING, allowNull: false, unique: true },
  expiresAt: { type: DataTypes.DATE },
  usedAt:    { type: DataTypes.DATE },
  usedBy:    { type: DataTypes.STRING },
});

const ConversationParticipant = sequelize.define("ConversationParticipant", {
  id:          { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  displayName: { type: DataTypes.STRING, allowNull: false },
  role:        { type: DataTypes.STRING, defaultValue: "employee" },
  phone:       { type: DataTypes.STRING },
  // TEXT et non STRING : un token JWT dépasse souvent les 255 caractères de VARCHAR,
  // ce qui faisait échouer silencieusement la création (erreur 500 "Erreur serveur").
  guestToken:  { type: DataTypes.TEXT },
});

// Note interne partagée : une seule par conversation, visible par tous les employés
const ConversationNote = sequelize.define("ConversationNote", {
  id:            { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  content:       { type: DataTypes.TEXT, defaultValue: "" },
  updatedByName: { type: DataTypes.STRING },
});

// Réponse rapide partagée entre tous les employés
const QuickReply = sequelize.define("QuickReply", {
  id:   { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  text: { type: DataTypes.TEXT, allowNull: false },
});

// Abonnement aux notifications push du navigateur (PWA). Un même compte peut avoir plusieurs
// abonnements (plusieurs appareils/navigateurs) : pas de unique sur ownerId, seulement sur endpoint.
const PushSubscription = sequelize.define("PushSubscription", {
  id:        { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  ownerType: { type: DataTypes.STRING, allowNull: false }, // "employee" | "client" | "guest"
  ownerId:   { type: DataTypes.STRING, allowNull: false },
  endpoint:  { type: DataTypes.TEXT, allowNull: false, unique: true },
  p256dh:    { type: DataTypes.STRING, allowNull: false },
  auth:      { type: DataTypes.STRING, allowNull: false },
});

// Relations
Client.hasMany(Conversation, { foreignKey: "clientId" });
Conversation.belongsTo(Client, { foreignKey: "clientId" });
Employee.hasMany(Conversation, { foreignKey: "employeeId" });
Conversation.belongsTo(Employee, { foreignKey: "employeeId" });
Conversation.hasMany(Message, { foreignKey: "conversationId" });
Message.belongsTo(Conversation, { foreignKey: "conversationId" });
Employee.hasMany(Message, { foreignKey: "employeeId" });
Message.belongsTo(Employee, { foreignKey: "employeeId" });
Client.hasMany(Message, { foreignKey: "clientId" });
Message.belongsTo(Client, { foreignKey: "clientId" });
Employee.hasMany(CallSession, { foreignKey: "callerId" });
CallSession.belongsTo(Employee, { foreignKey: "callerId", as: "caller" });
Client.hasMany(CallSession, { foreignKey: "receiverId" });
CallSession.belongsTo(Client, { foreignKey: "receiverId", as: "receiver" });
Conversation.hasMany(ConversationInvite, { foreignKey: "conversationId" });
ConversationInvite.belongsTo(Conversation, { foreignKey: "conversationId" });
Conversation.hasMany(ConversationParticipant, { foreignKey: "conversationId" });
ConversationParticipant.belongsTo(Conversation, { foreignKey: "conversationId" });
Conversation.hasOne(ConversationNote, { foreignKey: "conversationId" });
ConversationNote.belongsTo(Conversation, { foreignKey: "conversationId" });

module.exports = { sequelize, Employee, Client, Conversation, Message, CallSession, ConversationInvite, ConversationParticipant, ConversationNote, QuickReply, PushSubscription };
