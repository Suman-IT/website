import { createApp } from "./app.js";
import { loadConfiguration } from "./config/config.js";
import { createDatabasePool, verifySecuritySchema } from "./database/pool.js";

async function start(): Promise<void> {
  const configuration = loadConfiguration();
  const pool = createDatabasePool();
  try {
    await verifySecuritySchema(pool);
  } catch (error) {
    await pool.end();
    throw error;
  }
  const app = createApp(configuration, pool);
  app.listen(configuration.port, () => {
    console.info(`Server listening on port ${configuration.port}`);
  });
}

start().catch((error: unknown) => {
  console.error("Startup failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
