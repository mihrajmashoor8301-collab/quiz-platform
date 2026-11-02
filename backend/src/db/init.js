// PostgreSQL init: applies schema.sql in place of Supabase Edge Functions.
// Runs as `quiz_app` (created by `src/db/seed.js`).
import { Pool } from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaFile = path.resolve(__dirname, "..", "..", "schema.sql");
const schema = fs.readFileSync(schemaFile, "utf8");

export async function initDb() {
  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "quiz_app",
    user: process.env.DB_USER || "quiz_app",
    password: process.env.DB_PASSWORD || "quiz_app_password",
    max: 4,
  });
  await pool.query("SELECT 1");
  await pool.query(schema);
  await pool.end();
}

export default initDb;
