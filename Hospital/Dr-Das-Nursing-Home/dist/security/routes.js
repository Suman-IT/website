"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createStaffRouter = createStaffRouter;
const express_1 = __importDefault(require("express"));
const routes_js_1 = require("../modules/admin/routes.js");
function cookieName(configuration) {
    return configuration.nodeEnv === "production" ? "__Host-skdora_session" : "skdora_session";
}
function sessionCookie(configuration, token, clear = false) {
    const attributes = [
        `${cookieName(configuration)}=${token}`,
        "Path=/", "HttpOnly", "SameSite=Strict",
    ];
    if (configuration.nodeEnv === "production")
        attributes.push("Secure");
    if (clear)
        attributes.push("Max-Age=0");
    return attributes.join("; ");
}
function readSessionToken(request, configuration) {
    const cookies = (request.headers.cookie ?? "").split(";").map((part) => part.trim());
    const matches = cookies.filter((part) => part.startsWith(`${cookieName(configuration)}=`));
    if (matches.length !== 1)
        return null;
    const token = matches[0]?.slice(cookieName(configuration).length + 1) ?? "";
    return /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
function principalFrom(response) {
    return response.locals.principal;
}
function createStaffRouter(configuration, security, hospital, departments, doctors, schedules, patients, appointments) {
    const router = express_1.default.Router();
    let activePasswordChecks = 0;
    router.use((_request, response, next) => {
        response.setHeader("Cache-Control", "no-store");
        next();
    });
    router.use(express_1.default.json({ limit: "2kb" }));
    const requireOrigin = (request, response, next) => {
        if (request.get("Origin") !== configuration.appOrigin) {
            response.status(403).json({ error: "Forbidden" });
            return;
        }
        next();
    };
    const requirePrincipal = async (request, response, next) => {
        const token = readSessionToken(request, configuration);
        const principal = token ? await security.principalForToken(token) : null;
        if (!principal) {
            response.status(401).json({ error: "Authentication required" });
            return;
        }
        response.locals.principal = principal;
        next();
    };
    const requirePermission = (permission) => async (_request, response, next) => {
        if (!await security.hasPermission(principalFrom(response), permission)) {
            response.status(403).json({ error: "Forbidden" });
            return;
        }
        next();
    };
    router.post("/auth/login", requireOrigin, async (request, response) => {
        const body = request.body;
        if (body === null || typeof body !== "object" || Array.isArray(body) ||
            Object.keys(body).some((key) => !["email", "password"].includes(key))) {
            response.status(400).json({ error: "Invalid login request" });
            return;
        }
        const fields = body;
        const email = typeof fields.email === "string" ? fields.email.trim().toLowerCase() : "";
        const password = fields.password;
        if (email.length < 3 || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
            typeof password !== "string" || password.length < 1 || password.length > 1024) {
            response.status(400).json({ error: "Invalid login request" });
            return;
        }
        if (!await security.allowLoginAttempt(request.socket.remoteAddress ?? "unknown", email)) {
            response.setHeader("Retry-After", "900");
            response.status(429).json({ error: "Too many login attempts" });
            return;
        }
        if (activePasswordChecks >= 2) {
            response.setHeader("Retry-After", "5");
            response.status(429).json({ error: "Please retry shortly" });
            return;
        }
        activePasswordChecks++;
        try {
            const token = await security.login(email, password);
            if (!token) {
                response.status(401).json({ error: "Invalid credentials" });
                return;
            }
            response.setHeader("Set-Cookie", sessionCookie(configuration, token));
            response.status(204).end();
        }
        finally {
            activePasswordChecks--;
        }
    });
    router.get("/auth/me", requirePrincipal, async (_request, response) => {
        const principal = principalFrom(response);
        const hospitalIdentity = await hospital.getForStaff(principal.hospitalId);
        response.json({ displayName: principal.displayName, hospitalDisplayName: hospitalIdentity.displayName });
    });
    router.post("/auth/logout", requireOrigin, requirePrincipal, async (request, response) => {
        const token = readSessionToken(request, configuration);
        if (token)
            await security.logout(token, principalFrom(response));
        response.setHeader("Set-Cookie", sessionCookie(configuration, "", true));
        response.status(204).end();
    });
    router.get("/audit/events/:id", requirePrincipal, requirePermission("audit.read"), async (request, response) => {
        const event = await security.findAuditEvent(principalFrom(response), String(request.params.id));
        if (!event) {
            response.status(404).json({ error: "Not found" });
            return;
        }
        response.json(event);
    });
    router.use("/admin", requirePrincipal, (0, routes_js_1.createAdminRouter)(configuration, security, hospital, departments, doctors, schedules));
    if (configuration.features.core.patients) {
        router.post("/patients/search", requireOrigin, requirePrincipal, async (request, response) => {
            response.json(await patients.search(principalFrom(response), request.body));
        });
        router.post("/patients", requireOrigin, requirePrincipal, async (request, response) => {
            response.status(201).json(await patients.create(principalFrom(response), request.body, request.get("Idempotency-Key") ?? ""));
        });
        router.get("/patients/:id", requirePrincipal, async (request, response) => {
            response.json(await patients.get(principalFrom(response), String(request.params.id)));
        });
        router.put("/patients/:id", requireOrigin, requirePrincipal, async (request, response) => {
            response.json(await patients.update(principalFrom(response), String(request.params.id), request.body));
        });
    }
    if (configuration.features.core.appointments) {
        router.get("/appointments", requirePrincipal, requirePermission("appointment.read"), async (request, response) => {
            const date = dateField(request.query.date, "date");
            const doctorId = request.query.doctorId === undefined ? null : idField(request.query.doctorId, "doctorId");
            const status = request.query.status === undefined ? null : textField(request.query.status, "status", 32);
            const search = request.query.search === undefined ? null : textField(request.query.search, "search", 150);
            response.json(await appointments.listQueue(principalFrom(response), { date, doctorId, status, search }));
        });
        router.post("/appointments/phone", requireOrigin, requirePrincipal, async (request, response) => {
            response.status(201).json(await appointments.createReception(principalFrom(response), request.body, "PHONE", request.get("Idempotency-Key") ?? ""));
        });
        router.post("/appointments/walk-in", requireOrigin, requirePrincipal, async (request, response) => {
            response.status(201).json(await appointments.createReception(principalFrom(response), request.body, "WALK_IN", request.get("Idempotency-Key") ?? ""));
        });
        router.post("/appointments", requireOrigin, requirePrincipal, async (request, response) => {
            response.status(201).json(await appointments.create(principalFrom(response), request.body, request.get("Idempotency-Key") ?? ""));
        });
        router.get("/appointments/:id", requirePrincipal, async (request, response) => {
            response.json(await appointments.get(principalFrom(response), String(request.params.id)));
        });
        router.post("/appointments/:id/cancel", requireOrigin, requirePrincipal, async (request, response) => {
            response.json(await appointments.cancel(principalFrom(response), String(request.params.id), request.body, request.get("Idempotency-Key") ?? ""));
        });
        router.post("/appointments/:id/reschedule", requireOrigin, requirePrincipal, async (request, response) => {
            response.json(await appointments.reschedule(principalFrom(response), String(request.params.id), request.body, request.get("Idempotency-Key") ?? ""));
        });
        router.post("/appointments/:id/status", requireOrigin, requirePrincipal, async (request, response) => {
            response.json(await appointments.transition(principalFrom(response), String(request.params.id), request.body, request.get("Idempotency-Key") ?? ""));
        });
        router.put("/booking-policy", requireOrigin, requirePrincipal, async (request, response) => {
            response.json(await appointments.setCutoff(principalFrom(response), request.body));
        });
    }
    return router;
}
