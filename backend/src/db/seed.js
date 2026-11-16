// Ensure the local application role/database exist before applying schema.sql.
// The initial DB_ADMIN_USER must be a PostgreSQL administrator; on later runs
// it can be the existing app role if that role can create databases.
//
// Usage: node src/db/seed.js

import { Pool } from "pg";

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

const appUser = process.env.DB_USER || "quiz_app";
const appDatabase = process.env.DB_NAME || "quiz_app";
const appPassword = process.env.DB_PASSWORD || "quiz_app_password";

const pool = new Pool({
  host: process.env.DB_HOST || process.env.PGHOST || "localhost",
  port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
  database: process.env.DB_ADMIN_NAME || "postgres",
  user: process.env.DB_ADMIN_USER || "postgres",
  ...(process.env.DB_ADMIN_PASSWORD ? { password: process.env.DB_ADMIN_PASSWORD } : {}),
});

const client = await pool.connect();

try {
  await client.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = ${quoteLiteral(appUser)}) THEN
      CREATE ROLE ${quoteIdentifier(appUser)} LOGIN PASSWORD ${quoteLiteral(appPassword)};
    END IF;
  END $$;`);
  const database = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [appDatabase]);
  if (database.rowCount === 0) {
    await client.query(`CREATE DATABASE ${quoteIdentifier(appDatabase)} OWNER ${quoteIdentifier(appUser)}`);
  }
} finally {
  await client.end();
}

console.log("db-seed: application role and database are in place; run npm run db:init to apply the schema");
