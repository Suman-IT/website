"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const node_path_1 = require("node:path");
const input_js_1 = require("./http/input.js");
const departments_service_js_1 = require("./modules/departments/departments.service.js");
const doctors_service_js_1 = require("./modules/doctors/doctors.service.js");
const hospital_service_js_1 = require("./modules/hospital/hospital.service.js");
const schedules_service_js_1 = require("./modules/schedules/schedules.service.js");
const patients_service_js_1 = require("./modules/patients/patients.service.js");
const appointments_service_js_1 = require("./modules/appointments/appointments.service.js");
const routes_js_1 = require("./security/routes.js");
const security_service_js_1 = require("./security/security.service.js");
function createApp(configuration, pool) {
    const app = (0, express_1.default)();
    app.disable("x-powered-by");
    app.use(express_1.default.json({ limit: "16kb" }));
    const hospital = new hospital_service_js_1.HospitalService(pool);
    const departments = new departments_service_js_1.DepartmentService(pool);
    const doctors = new doctors_service_js_1.DoctorService(pool);
    const schedules = new schedules_service_js_1.ScheduleService(pool);
    const appointments = new appointments_service_js_1.AppointmentService(pool, configuration.features.core.appointments);
    app.use((_request, response, next) => {
        response.setHeader("X-Content-Type-Options", "nosniff");
        response.setHeader("Referrer-Policy", "no-referrer");
        next();
    });
    app.get("/health", (_request, response) => {
        response.json({ status: "ok" });
    });
    if (configuration.features.website.enabled) {
        app.use(express_1.default.static((0, node_path_1.join)(process.cwd(), "public"), { index: "index.html" }));
    }
    app.get("/api/public/hospital", async (_request, response) => {
        const identity = await hospital.getActiveHospital();
        response.json({ displayName: identity.displayName });
    });
    if (configuration.features.website.enabled && configuration.features.core.departments) {
        app.get("/api/public/departments", async (_request, response) => {
            const identity = await hospital.getActiveHospital();
            response.json(await departments.listPublic(identity.id));
        });
    }
    if (configuration.features.website.enabled && configuration.features.core.doctors) {
        app.get("/api/public/doctors", async (_request, response) => {
            const identity = await hospital.getActiveHospital();
            response.json(await doctors.listPublic(identity.id));
        });
    }
    if (configuration.features.website.enabled && configuration.features.core.appointments) {
        app.post("/api/public/appointments", async (request, response) => {
            const identity = await hospital.getActiveHospital();
            const key = request.header("Idempotency-Key");
            if (!key)
                throw new input_js_1.HttpError(400, "Idempotency-Key is required");
            response.status(201).json(await appointments.createPublic(identity.id, request.body, key));
        });
    }
    if (configuration.features.website.enabled && configuration.features.core.schedules) {
        app.get("/api/public/doctors/:slug/availability", async (request, response) => {
            const identity = await hospital.getActiveHospital();
            const availability = await schedules.availability(identity.id, (0, input_js_1.slugField)(String(request.params.slug)), (0, input_js_1.dateField)(request.query.date));
            response.json({ ...availability, timezone: identity.timezone });
        });
    }
    app.use("/api/staff", (0, routes_js_1.createStaffRouter)(configuration, new security_service_js_1.SecurityService(pool), hospital, departments, doctors, schedules, new patients_service_js_1.PatientService(pool, configuration.features.core.patients), appointments));
    app.use((error, _request, response, _next) => {
        if (error instanceof input_js_1.HttpError) {
            response.status(error.status).json({ error: error.message });
            return;
        }
        const status = typeof error === "object" && error !== null && "status" in error &&
            typeof error.status === "number" && error.status >= 400 && error.status < 500 ? 400 : 500;
        response.status(status).json({ error: status === 400 ? "Invalid request" : "Internal server error" });
    });
    return app;
}
