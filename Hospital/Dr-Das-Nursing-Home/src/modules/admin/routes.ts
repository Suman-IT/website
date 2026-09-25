import express, { type Response } from "express";
import type { AppConfiguration } from "../../config/config.js";
import { bodyObject, boolField, dateField, HttpError, idField, idList,
  intField, optionalField, slugField, textField, timeField } from "../../http/input.js";
import type { Principal } from "../../security/security.service.js";
import { SecurityService } from "../../security/security.service.js";
import { DepartmentService, type DepartmentInput } from "../departments/departments.service.js";
import { DoctorService, type DoctorInput } from "../doctors/doctors.service.js";
import { HospitalService } from "../hospital/hospital.service.js";
import { ScheduleService, type OverrideInput, type ScheduleInput } from "../schedules/schedules.service.js";
import { DiagnosticsService, type DiagnosticInput } from "../diagnostics/diagnostics.service.js";

function principal(response: Response): Principal { return response.locals.principal as Principal; }

function departmentFields(raw: unknown, create: boolean): Partial<DepartmentInput> {
  const body = bodyObject(raw, ["name", "slug", "isPublished"], create ? ["name", "slug"] : []);
  return {
    ...(body.name !== undefined ? { name: textField(body.name, "name") } : {}),
    ...(body.slug !== undefined ? { slug: slugField(body.slug) } : {}),
    ...(body.isPublished !== undefined ? { isPublished: boolField(body.isPublished, "isPublished") } :
      create ? { isPublished: false } : {}),
  };
}

function doctorFields(raw: unknown, create: boolean) {
  const body = bodyObject(raw,
    ["displayName", "slug", "isActive", "isPublished", ...(create ? ["departmentIds"] : [])],
    create ? ["displayName", "slug"] : []);
  const fields: Partial<DoctorInput> = {
    ...(body.displayName !== undefined ? { displayName: textField(body.displayName, "displayName") } : {}),
    ...(body.slug !== undefined ? { slug: slugField(body.slug) } : {}),
    ...(body.isActive !== undefined ? { isActive: boolField(body.isActive, "isActive") } :
      create ? { isActive: true } : {}),
    ...(body.isPublished !== undefined ? { isPublished: boolField(body.isPublished, "isPublished") } :
      create ? { isPublished: false } : {}),
  };
  return { fields, departmentIds: create && body.departmentIds !== undefined ?
    idList(body.departmentIds, "departmentIds") : [] };
}

const scheduleKeys = ["dayOfWeek", "startLocal", "endLocal", "bookingMode", "capacity",
  "slotMinutes", "validFrom", "validUntil", "isActive"] as const;

function scheduleFields(raw: unknown, create: boolean): Partial<Omit<ScheduleInput, "doctorId">> {
  const body = bodyObject(raw, scheduleKeys,
    create ? ["dayOfWeek", "startLocal", "endLocal", "bookingMode", "capacity", "slotMinutes", "validFrom"] : []);
  const mode = body.bookingMode;
  if (mode !== undefined && mode !== "SERIAL" && mode !== "EXCLUSIVE") {
    throw new HttpError(400, "bookingMode must be SERIAL or EXCLUSIVE");
  }
  return {
    ...(body.dayOfWeek !== undefined ? { dayOfWeek: intField(body.dayOfWeek, "dayOfWeek", 0, 6) } : {}),
    ...(body.startLocal !== undefined ? { startLocal: timeField(body.startLocal, "startLocal") } : {}),
    ...(body.endLocal !== undefined ? { endLocal: timeField(body.endLocal, "endLocal") } : {}),
    ...(mode !== undefined ? { bookingMode: mode as "SERIAL" | "EXCLUSIVE" } : {}),
    ...(body.capacity !== undefined ? { capacity: intField(body.capacity, "capacity", 1, 1000) } : {}),
    ...(body.slotMinutes !== undefined ? { slotMinutes: intField(body.slotMinutes, "slotMinutes", 1, 240) } : {}),
    ...(body.validFrom !== undefined ? { validFrom: dateField(body.validFrom, "validFrom") } : {}),
    ...("validUntil" in body ? { validUntil: optionalField(body.validUntil, (v) => dateField(v, "validUntil")) } :
      create ? { validUntil: null } : {}),
    ...(body.isActive !== undefined ? { isActive: boolField(body.isActive, "isActive") } :
      create ? { isActive: true } : {}),
  };
}

function overrideFields(raw: unknown): OverrideInput {
  const body = bodyObject(raw, ["isAvailable", "startLocal", "endLocal", "capacity", "slotMinutes"], ["isAvailable"]);
  return {
    isAvailable: boolField(body.isAvailable, "isAvailable"),
    startLocal: optionalField(body.startLocal, (v) => timeField(v, "startLocal")),
    endLocal: optionalField(body.endLocal, (v) => timeField(v, "endLocal")),
    capacity: optionalField(body.capacity, (v) => intField(v, "capacity", 1, 1000)),
    slotMinutes: optionalField(body.slotMinutes, (v) => intField(v, "slotMinutes", 1, 240)),
  };
}

function diagnosticFields(raw: unknown, create: boolean): Partial<DiagnosticInput> {
  const body = bodyObject(raw,
    ["name", "slug", "category", "description", "price", "priceNote", "isPublished"],
    create ? ["name", "slug"] : []);
  const price = body.price === undefined || body.price === null || body.price === "" ? null :
    typeof body.price === "number" && Number.isFinite(body.price) && body.price >= 0 ? body.price : NaN;
  if (Number.isNaN(price)) throw new HttpError(400, "price must be a non-negative number");
  return {
    ...(body.name !== undefined ? { name: textField(body.name, "name", 180) } : {}),
    ...(body.slug !== undefined ? { slug: slugField(body.slug) } : {}),
    ...(body.category !== undefined ? { category: textField(body.category, "category", 100) } :
      create ? { category: "Diagnostic services" } : {}),
    ...(body.description !== undefined ? { description: optionalField(body.description, (value) => textField(value, "description", 500)) } :
      create ? { description: null } : {}),
    ...(body.price !== undefined ? { price } : create ? { price: null } : {}),
    ...(body.priceNote !== undefined ? { priceNote: optionalField(body.priceNote, (value) => textField(value, "priceNote", 120)) } :
      create ? { priceNote: null } : {}),
    ...(body.isPublished !== undefined ? { isPublished: boolField(body.isPublished, "isPublished") } :
      create ? { isPublished: false } : {}),
  };
}

export function createAdminRouter(configuration: AppConfiguration, security: SecurityService,
  hospital: HospitalService, departments: DepartmentService, doctors: DoctorService,
  schedules: ScheduleService, diagnostics: DiagnosticsService) {
  const router = express.Router();
  router.use((request, response, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        request.get("Origin") !== configuration.appOrigin) {
      response.status(403).json({ error: "Forbidden" });
      return;
    }
    next();
  });
  const permit = (code: string): express.RequestHandler => async (_request, response, next) => {
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
    const body = bodyObject(request.body, ["displayName"], ["displayName"]);
    response.json(await hospital.updateDisplayName(principal(response),
      textField(body.displayName, "displayName", 255)));
  });

  if (configuration.features.core.departments) {
    router.get("/departments", permit("department.read"), async (_request, response) => {
      response.json(await departments.list(principal(response).hospitalId));
    });
    router.post("/departments", permit("department.manage"), async (request, response) => {
      response.status(201).json(await departments.create(principal(response),
        departmentFields(request.body, true) as DepartmentInput));
    });
    router.patch("/departments/:id", permit("department.manage"), async (request, response) => {
      response.json(await departments.update(principal(response), idField(String(request.params.id)),
        departmentFields(request.body, false)));
    });
  }

  if (configuration.features.core.doctors) {
    router.get("/doctors", permit("doctor.read"), async (_request, response) => {
      response.json(await doctors.list(principal(response).hospitalId));
    });
    router.post("/doctors", permit("doctor.manage"), async (request, response) => {
      const { fields, departmentIds } = doctorFields(request.body, true);
      response.status(201).json(await doctors.create(principal(response), fields as DoctorInput, departmentIds));
    });
    router.patch("/doctors/:id", permit("doctor.manage"), async (request, response) => {
      const { fields } = doctorFields(request.body, false);
      response.json(await doctors.update(principal(response), idField(String(request.params.id)), fields));
    });
    router.put("/doctors/:id/departments", permit("doctor.manage"), async (request, response) => {
      const body = bodyObject(request.body, ["departmentIds"], ["departmentIds"]);
      response.json(await doctors.setDepartments(principal(response), idField(String(request.params.id)),
        idList(body.departmentIds, "departmentIds")));
    });
  }

  if (configuration.features.core.schedules) {
    router.get("/doctors/:doctorId/schedules", permit("schedule.read"), async (request, response) => {
      response.json(await schedules.listForStaff(principal(response).hospitalId,
        idField(String(request.params.doctorId), "doctorId")));
    });
    router.post("/doctors/:doctorId/schedules", permit("schedule.manage"), async (request, response) => {
      const doctorId = idField(String(request.params.doctorId), "doctorId");
      response.status(201).json(await schedules.create(principal(response),
        { doctorId, ...scheduleFields(request.body, true) } as ScheduleInput));
    });
    router.patch("/schedules/:id", permit("schedule.manage"), async (request, response) => {
      response.json(await schedules.update(principal(response), idField(String(request.params.id)),
        scheduleFields(request.body, false)));
    });
    router.get("/schedules/:id/overrides", permit("schedule.read"), async (request, response) => {
      const from = dateField(request.query.from, "from");
      const to = dateField(request.query.to, "to");
      const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
      if (days < 0 || days > 90) throw new HttpError(400, "Date range must be 0 to 90 days");
      response.json(await schedules.listOverrides(principal(response).hospitalId,
        idField(String(request.params.id)), from, to));
    });
    router.put("/schedules/:id/overrides/:date", permit("schedule.manage"), async (request, response) => {
      response.json(await schedules.upsertOverride(principal(response), idField(String(request.params.id)),
        dateField(String(request.params.date)), overrideFields(request.body)));
    });
    router.delete("/schedules/:id/overrides/:date", permit("schedule.manage"), async (request, response) => {
      await schedules.deleteOverride(principal(response), idField(String(request.params.id)),
        dateField(String(request.params.date)));
      response.status(204).end();
    });
  }
  if (configuration.features.diagnostics.directory) {
    router.get("/diagnostics", permit("diagnostic.read"), async (_request, response) => {
      response.json(await diagnostics.list(principal(response).hospitalId));
    });
    router.post("/diagnostics", permit("diagnostic.manage"), async (request, response) => {
      response.status(201).json(await diagnostics.create(principal(response),
        diagnosticFields(request.body, true) as DiagnosticInput));
    });
    router.patch("/diagnostics/:id", permit("diagnostic.manage"), async (request, response) => {
      response.json(await diagnostics.update(principal(response), idField(String(request.params.id)),
        diagnosticFields(request.body, false)));
    });
    router.delete("/diagnostics/:id", permit("diagnostic.manage"), async (request, response) => {
      await diagnostics.remove(principal(response), idField(String(request.params.id)));
      response.status(204).end();
    });
  }
  return router;
}
