# Dr. Das Nursing Home Application

Hostinger deployment handoff for the deployable Dr. Das Nursing Home application.

This folder is separate from the reference static website in the parent folder and from the reusable `SKDORA-Healthcare-Codex-Skill-Pack` instructions.

Before deployment, confirm Hostinger supports Node.js 24.21.0, a persistent Node process, private MySQL connectivity, HTTPS, environment variables, and scheduled jobs. Copy `.env.example` to the server environment, run `npm ci`, `npm run build`, apply migrations with a protected migration account, and start with `npm start`.

Set production `NODE_ENV=production` and an exact HTTPS `APP_ORIGIN`. Keep passwords, bootstrap files, database volumes, and `.env` outside the uploaded source. Verify `/health`, `/`, `/staff.html`, authentication, public booking, reception, permissions, audit, backups, and restore before launch.

The runtime application serves the public hospital website from `/` and the staff dashboard from `/staff.html`.
