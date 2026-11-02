// Wrapper around `pg.Pool` so services stay independent of the pg package;
// `pool.query` returns the standard `{ rows, ... }` shape tests rely on.
export { default } from "/home/mihraj/quiz-platform/backend/src/services/pool-wrapper.js";
