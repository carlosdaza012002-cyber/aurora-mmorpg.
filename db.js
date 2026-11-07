const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "data");
const USERS_FILE = path.join(DATA_DIR, "users.json");
let pool = null;

async function initStorage() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!process.env.DATABASE_URL) {
    if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "[]");
    console.log("Storage: JSON local (development only). Set DATABASE_URL to enable PostgreSQL.");
    return;
  }
  const { Pool } = require("pg");
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
  });
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY,
      email VARCHAR(180) NOT NULL UNIQUE,
      character_name VARCHAR(18) NOT NULL DEFAULT 'Aventurero',
      character_class VARCHAR(20) NOT NULL DEFAULT 'Guerrero',
      salt VARCHAR(64) NOT NULL,
      password_hash CHAR(128) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS users_created_at_idx ON users(created_at);
  `);
  await pool.query("SELECT 1");
  console.log("Storage: PostgreSQL connected and schema verified.");
}

function fromRow(row) {
  if (!row) return null;
  return { id: row.id, email: row.email, characterName: row.character_name,
    characterClass: row.character_class, salt: row.salt, passwordHash: row.password_hash,
    createdAt: row.created_at };
}
function readJsonUsers() {
  try { return JSON.parse(fs.readFileSync(USERS_FILE, "utf8")); }
  catch { return []; }
}
function writeJsonUsers(users) {
  const temp = USERS_FILE + ".tmp";
  fs.writeFileSync(temp, JSON.stringify(users, null, 2));
  fs.renameSync(temp, USERS_FILE);
}
async function findUserByEmail(email) {
  if (pool) { const r = await pool.query("SELECT * FROM users WHERE email=$1 LIMIT 1", [email]); return fromRow(r.rows[0]); }
  return readJsonUsers().find(u => u.email === email) || null;
}
async function findUserById(id) {
  if (pool) { const r = await pool.query("SELECT * FROM users WHERE id=$1 LIMIT 1", [id]); return fromRow(r.rows[0]); }
  return readJsonUsers().find(u => u.id === id) || null;
}
async function updateUserCharacter(userId, characterName, characterClass) {
  if (pool) {
    await pool.query("UPDATE users SET character_name=$2, character_class=$3 WHERE id=$1", [userId, characterName, characterClass]);
    return;
  }
  const users=readJsonUsers(),user=users.find(u=>u.id===userId);
  if(user){user.characterName=characterName;user.characterClass=characterClass;writeJsonUsers(users);}
}
async function createUser(user) {
  if (pool) {
    const r = await pool.query(
      `INSERT INTO users(id,email,character_name,character_class,salt,password_hash,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [user.id,user.email,user.characterName,user.characterClass,user.salt,user.passwordHash,user.createdAt]
    );
    return fromRow(r.rows[0]);
  }
  const users=readJsonUsers();
  if(users.some(u=>u.email===user.email)){const e=new Error("EMAIL_EXISTS");e.code="23505";throw e;}
  users.push(user);writeJsonUsers(users);return user;
}
module.exports = { initStorage, findUserByEmail, findUserById, createUser, updateUserCharacter, get storageMode(){return pool?"postgres":"json";} };
