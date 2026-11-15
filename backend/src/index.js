import { createApp } from "./app.js";
import { createPool, migrate } from "./db.js";

const pool = createPool();
// SKIP_MIGRATE=1: o esquema já existe e o usuário do serviço não é dono das tabelas
if (process.env.SKIP_MIGRATE !== "1") await migrate(pool);
const server = createApp({ pool, jwtSecret: process.env.JWT_SECRET || "" });
const port = Number(process.env.PORT || 8791);
server.listen(port, () => console.log(`mangaba-chrome-backend na porta ${port}`));
