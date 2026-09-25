import { createApp } from "./app.js";
import { loadConfiguration } from "./config/config.js";
import { createDatabasePool, verifySecuritySchema } from "./database/pool.js";

async function start(): Promise<void> {
  const configuration = loadConfiguration();
  const pool = createDatabasePool();
  const app = createApp(configuration, pool);
  app.listen(configuration.port, () => {
    console.info(`Server listening on port ${configuration.port}`);
  });

  // Bind the HTTP port before checking MySQL. Hostinger expects the process
  // to call listen() quickly; database credentials/schema issues should not
  // prevent the public site and /health endpoint from coming up.
  try {
    await verifySecuritySchema(pool);
    console.info("Database schema verified");
  } catch (error) {
    console.error("Database startup check failed:", error instanceof Error ? error.message : "unknown error");
  }
}

start().catch((error: unknown) => {
  console.error("Startup failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
});
