// Thins `pg.Pool` so services stay independent of the pg package; `pool.query`
// returns the standard `{ rows, ... }` shape tests rely on.
import { Pool as PgPool } from "pg";

export default class DatabasePool {
  constructor(config = {}) {
    this.pgPool = new PgPool(config);
  }

  async query(text, values) {
    return this.pgPool.query(text, values);
  }
}
