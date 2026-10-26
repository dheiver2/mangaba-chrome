import { createPool, migrate } from "./db.js";

const pool = createPool();
await migrate(pool);
console.log("schema ok");
await pool.end();
