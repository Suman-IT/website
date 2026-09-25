"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_js_1 = require("./app.js");
const config_js_1 = require("./config/config.js");
const pool_js_1 = require("./database/pool.js");
async function start() {
    const configuration = (0, config_js_1.loadConfiguration)();
    const pool = (0, pool_js_1.createDatabasePool)();
    try {
        await (0, pool_js_1.verifySecuritySchema)(pool);
    }
    catch (error) {
        await pool.end();
        throw error;
    }
    const app = (0, app_js_1.createApp)(configuration, pool);
    app.listen(configuration.port, () => {
        console.info(`Server listening on port ${configuration.port}`);
    });
}
start().catch((error) => {
    console.error("Startup failed:", error instanceof Error ? error.message : "unknown error");
    process.exitCode = 1;
});
