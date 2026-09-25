import express from "express";
import { join } from "node:path";
import type { Pool } from "mysql2/promise";
import type { AppConfiguration } from "./config/config.js";
import { dateField, HttpError, slugField } from "./http/input.js";
import { DepartmentService } from "./modules/departments/departments.service.js";
import { DoctorService } from "./modules/doctors/doctors.service.js";
import { HospitalService } from "./modules/hospital/hospital.service.js";
import { ScheduleService } from "./modules/schedules/schedules.service.js";
import { PatientService } from "./modules/patients/patients.service.js";
import { AppointmentService } from "./modules/appointments/appointments.service.js";
import { createStaffRouter } from "./security/routes.js";
import { SecurityService } from "./security/security.service.js";

export function createApp(configuration: AppConfiguration, pool: Pool) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "16kb" }));
  const hospital = new HospitalService(pool);
  const departments = new DepartmentService(pool);
  const doctors = new DoctorService(pool);
  const schedules = new ScheduleService(pool);
  const appointments = new AppointmentService(pool, configuration.features.core.appointments);

  app.use((_request, response, next) => {
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  app.get("/health", (_request, response) => {
    response.json({ status: "ok" });
  });

  if (configuration.features.website.enabled) {
    app.use(express.static(join(process.cwd(), "public"), { index: "index.html" }));
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
      if (!key) throw new HttpError(400, "Idempotency-Key is required");
      response.status(201).json(await appointments.createPublic(identity.id, request.body, key));
    });
  }
  if (configuration.features.website.enabled && configuration.features.core.schedules) {
    app.get("/api/public/doctors/:slug/availability", async (request, response) => {
      const identity = await hospital.getActiveHospital();
      const availability = await schedules.availability(identity.id, slugField(String(request.params.slug)),
        dateField(request.query.date));
      response.json({ ...availability, timezone: identity.timezone });
    });
  }

  app.use("/api/staff", createStaffRouter(configuration, new SecurityService(pool),
    hospital, departments, doctors, schedules,
    new PatientService(pool, configuration.features.core.patients),
    appointments));

  app.use((error: unknown, _request: express.Request, response: express.Response,
    _next: express.NextFunction) => {
    if (error instanceof HttpError) {
      response.status(error.status).json({ error: error.message });
      return;
    }
    const status = typeof error === "object" && error !== null && "status" in error &&
      typeof error.status === "number" && error.status >= 400 && error.status < 500 ? 400 : 500;
    response.status(status).json({ error: status === 400 ? "Invalid request" : "Internal server error" });
  });

  return app;
}
