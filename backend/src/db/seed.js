// The cluster is an mihraj-owned `initdb` instance started with
// `npm run db:start`. It has no `postgres` superuser role, so after the first
// `quiz_app` role exists there is no way to connect with administrative
// rights. `initDb` (src/db/init.js) applies the schema as `quiz_app`, and this
// script only ensures the role and database exist before that first run:
// once `quiz_app` exists, this script is a no-op.
//
// Usage: node src/db/seed.js

import { Pool } from "pg";

const pool = new Pool({
  host: "/home/mihraj/quiz-platform/sockdir",
  port: 5432,
  database: "postgres",
  user: "postgres",
});

const client = await pool.connect();

try {
  await client.query(`DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'quiz_app') THEN
    CREATE ROLE quiz_app LOGIN SUPERUSER PASSWORD 'quiz_app_password';
  END $$;`);
} finally {
  await client.end();
}

console.log("db-seed: role and database are in place; run npm run db:init to apply the schema");
