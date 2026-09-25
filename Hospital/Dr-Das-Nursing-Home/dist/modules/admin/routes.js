"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createAdminRouter = createAdminRouter;
const express_1 = __importDefault(require("express"));
const input_js_1 = require("../../http/input.js");
function principal(response) { return response.locals.principal; }
function departmentFields(raw, create) {
    const body = (0, input_js_1.bodyObject)(raw, ["name", "slug", "isPublished"], create ? ["name", "slug"] : []);
    return {
        ...(body.name !== undefined ? { name: (0, input_js_1.textField)(body.name, "name") } : {}),
        ...(body.slug !== undefined ? { slug: (0, input_js_1.slugField)(body.slug) } : {}),
        ...(body.isPublished !== undefined ? { isPublished: (0, input_js_1.boolField)(body.isPublished, "isPublished") } :
            create ? { isPublished: false } : {}),
    };
}
function doctorFields(raw, create) {
    const body = (0, input_js_1.bodyObject)(raw, ["displayName", "slug", "isActive", "isPublished", ...(create ? ["departmentIds"] : [])], create ? ["displayName", "slug"] : []);
    const fields = {
        ...(body.displayName !== undefined ? { displayName: (0, input_js_1.textField)(body.displayName, "displayName") } : {}),
        ...(body.slug !== undefined ? { slug: (0, input_js_1.slugField)(body.slug) } : {}),
        ...(body.isActive !== undefined ? { isActive: (0, input_js_1.boolField)(body.isActive, "isActive") } :
            create ? { isActive: true } : {}),
        ...(body.isPublished !== undefined ? { isPublished: (0, input_js_1.boolField)(body.isPublished, "isPublished") } :
            create ? { isPublished: false } : {}),
    };
    return { fields, departmentIds: create && body.departmentIds !== undefined ?
            (0, input_js_1.idList)(body.departmentIds, "departmentIds") : [] };
}
const scheduleKeys = ["dayOfWeek", "startLocal", "endLocal", "bookingMode", "capacity",
    "slotMinutes", "validFrom", "validUntil", "isActive"];
function scheduleFields(raw, create) {
    const body = (0, input_js_1.bodyObject)(raw, scheduleKeys, create ? ["dayOfWeek", "startLocal", "endLocal", "bookingMode", "capacity", "slotMinutes", "validFrom"] : []);
    const mode = body.bookingMode;
    if (mode !== undefined && mode !== "SERIAL" && mode !== "EXCLUSIVE") {
        throw new input_js_1.HttpError(400, "bookingMode must be SERIAL or EXCLUSIVE");
    }
    return {
        ...(body.dayOfWeek !== undefined ? { dayOfWeek: (0, input_js_1.intField)(body.dayOfWeek, "dayOfWeek", 0, 6) } : {}),
        ...(body.startLocal !== undefined ? { startLocal: (0, input_js_1.timeField)(body.startLocal, "startLocal") } : {}),
        ...(body.endLocal !== undefined ? { endLocal: (0, input_js_1.timeField)(body.endLocal, "endLocal") } : {}),
        ...(mode !== undefined ? { bookingMode: mode } : {}),
        ...(body.capacity !== undefined ? { capacity: (0, input_js_1.intField)(body.capacity, "capacity", 1, 1000) } : {}),
        ...(body.slotMinutes !== undefined ? { slotMinutes: (0, input_js_1.intField)(body.slotMinutes, "slotMinutes", 1, 240) } : {}),
        ...(body.validFrom !== undefined ? { validFrom: (0, input_js_1.dateField)(body.validFrom, "validFrom") } : {}),
        ...("validUntil" in body ? { validUntil: (0, input_js_1.optionalField)(body.validUntil, (v) => (0, input_js_1.dateField)(v, "validUntil")) } :
            create ? { validUntil: null } : {}),
        ...(body.isActive !== undefined ? { isActive: (0, input_js_1.boolField)(body.isActive, "isActive") } :
            create ? { isActive: true } : {}),
    };
}
function overrideFields(raw) {
    const body = (0, input_js_1.bodyObject)(raw, ["isAvailable", "startLocal", "endLocal", "capacity", "slotMinutes"], ["isAvailable"]);
    return {
        isAvailable: (0, input_js_1.boolField)(body.isAvailable, "isAvailable"),
        startLocal: (0, input_js_1.optionalField)(body.startLocal, (v) => (0, input_js_1.timeField)(v, "startLocal")),
        endLocal: (0, input_js_1.optionalField)(body.endLocal, (v) => (0, input_js_1.timeField)(v, "endLocal")),
        capacity: (0, input_js_1.optionalField)(body.capacity, (v) => (0, input_js_1.intField)(v, "capacity", 1, 1000)),
        slotMinutes: (0, input_js_1.optionalField)(body.slotMinutes, (v) => (0, input_js_1.intField)(v, "slotMinutes", 1, 240)),
    };
}
function createAdminRouter(configuration, security, hospital, departments, doctors, schedules) {
    const router = express_1.default.Router();
    router.use((request, response, next) => {
        if (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
            request.get("Origin") !== configuration.appOrigin) {
            response.status(403).json({ error: "Forbidden" });
            return;
        }
        next();
    });
    const permit = (code) => async (_request, response, next) => {
        if (!await security.hasPermission(principal(response), code)) {
            response.status(403).json({ error: "Forbidden" });
            return;
        }
        next();
    };
    router.get("/hospital", permit("hospital.manage"), async (_request, response) => {
        response.json(await hospital.getForStaff(principal(response).hospitalId));
    });
    router.patch("/hospital", permit("hospital.manage"), async (request, response) => {
        const body = (0, input_js_1.bodyObject)(request.body, ["displayName"], ["displayName"]);
        response.json(await hospital.updateDisplayName(principal(response), (0, input_js_1.textField)(body.displayName, "displayName", 255)));
    });
    if (configuration.features.core.departments) {
        router.get("/departments", permit("department.read"), async (_request, response) => {
            response.json(await departments.list(principal(response).hospitalId));
        });
        router.post("/departments", permit("department.manage"), async (request, response) => {
            response.status(201).json(await departments.create(principal(response), departmentFields(request.body, true)));
        });
        router.patch("/departments/:id", permit("department.manage"), async (request, response) => {
            response.json(await departments.update(principal(response), (0, input_js_1.idField)(String(request.params.id)), departmentFields(request.body, false)));
        });
    }
    if (configuration.features.core.doctors) {
        router.get("/doctors", permit("doctor.read"), async (_request, response) => {
            response.json(await doctors.list(principal(response).hospitalId));
        });
        router.post("/doctors", permit("doctor.manage"), async (request, response) => {
            const { fields, departmentIds } = doctorFields(request.body, true);
            response.status(201).json(await doctors.create(principal(response), fields, departmentIds));
        });
        router.patch("/doctors/:id", permit("doctor.manage"), async (request, response) => {
            const { fields } = doctorFields(request.body, false);
            response.json(await doctors.update(principal(response), (0, input_js_1.idField)(String(request.params.id)), fields));
        });
        router.put("/doctors/:id/departments", permit("doctor.manage"), async (request, response) => {
            const body = (0, input_js_1.bodyObject)(request.body, ["departmentIds"], ["departmentIds"]);
            response.json(await doctors.setDepartments(principal(response), (0, input_js_1.idField)(String(request.params.id)), (0, input_js_1.idList)(body.departmentIds, "departmentIds")));
        });
    }
    if (configuration.features.core.schedules) {
        router.get("/doctors/:doctorId/schedules", permit("schedule.read"), async (request, response) => {
            response.json(await schedules.listForStaff(principal(response).hospitalId, (0, input_js_1.idField)(String(request.params.doctorId), "doctorId")));
        });
        router.post("/doctors/:doctorId/schedules", permit("schedule.manage"), async (request, response) => {
            const doctorId = (0, input_js_1.idField)(String(request.params.doctorId), "doctorId");
            response.status(201).json(await schedules.create(principal(response), { doctorId, ...scheduleFields(request.body, true) }));
        });
        router.patch("/schedules/:id", permit("schedule.manage"), async (request, response) => {
            response.json(await schedules.update(principal(response), (0, input_js_1.idField)(String(request.params.id)), scheduleFields(request.body, false)));
        });
        router.get("/schedules/:id/overrides", permit("schedule.read"), async (request, response) => {
            const from = (0, input_js_1.dateField)(request.query.from, "from");
            const to = (0, input_js_1.dateField)(request.query.to, "to");
            const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
            if (days < 0 || days > 90)
                throw new input_js_1.HttpError(400, "Date range must be 0 to 90 days");
            response.json(await schedules.listOverrides(principal(response).hospitalId, (0, input_js_1.idField)(String(request.params.id)), from, to));
        });
        router.put("/schedules/:id/overrides/:date", permit("schedule.manage"), async (request, response) => {
            response.json(await schedules.upsertOverride(principal(response), (0, input_js_1.idField)(String(request.params.id)), (0, input_js_1.dateField)(String(request.params.date)), overrideFields(request.body)));
        });
        router.delete("/schedules/:id/overrides/:date", permit("schedule.manage"), async (request, response) => {
            await schedules.deleteOverride(principal(response), (0, input_js_1.idField)(String(request.params.id)), (0, input_js_1.dateField)(String(request.params.date)));
            response.status(204).end();
        });
    }
    return router;
}
