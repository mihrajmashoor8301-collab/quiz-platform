// The cluster is an mihraj-owned `initdb` instance, so there is no superuser
// role: every administrative step runs over the `postgres` connection and
// creates the `quiz_app` role if it is missing.

import fs from "node:fs";
import { Pool } from "pg";

const pool = new Pool({
  host: "/home/mihraj/quiz-platform/sockdir",
  port: 5432,
  database: "postgres",
  user: "postgres",
});

const client = await pool.connect();

// 1. Role. `postgres` is the only connection with administrative rights.
await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quiz_app') THEN
  CREATE ROLE quiz_app LOGIN SUPERUSER PASSWORD 'quiz_app_password';
END $$;`);

// 2. Database.
const existing = await client.query(
  "SELECT datname FROM pg_database WHERE datname = 'quiz_app'"
);
if (existing.rows.length === 0) {
  await client.query("CREATE DATABASE quiz_app OWNER quiz_app");
}

await client.query("GRANT ALL PRIVILEGES ON DATABASE quiz_app TO quiz_app");
await client.end();

// 3. Schema, as `quiz_app`. The connection uses the same credentials as
// the backend, so no extra grants are needed.
const {
  DB_HOST = "/home/mihraj/quiz-platform/sockdir",
  DB_PORT = "5432",
  DB_USER = "quiz_app",
  DB_PASSWORD = "quiz_app_password",
  DB_NAME = "quiz_app",
} = process.env;

const newPool = new Pool({
  host: DB_HOST,
  port: Number(DB_PORT),
  database: DB_NAME,
  user: DB_USER,
  password: DB_PASSWORD,
});
const newClient = await newPool.connect();
try {
  await newClient.query(
    fs.readFileSync("schema.sql", "utf8")
  );
} finally {
  await newClient.end();
  await newPool.close();
}

console.log("db-seed: role, database and schema are in place");
