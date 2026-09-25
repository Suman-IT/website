"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseConfiguration = parseConfiguration;
exports.loadConfiguration = loadConfiguration;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const yaml_1 = require("yaml");
const featureSchema = {
    product: { name: "string", deploymentMode: "string", version: "string" },
    core: {
        hospital: "boolean", authentication: "boolean", authorization: "boolean",
        audit: "boolean", doctors: "boolean", departments: "boolean",
        schedules: "boolean", patients: "boolean", appointments: "boolean",
        reception: "boolean",
    },
    website: {
        enabled: "boolean",
        pages: {
            home: "boolean", about: "boolean", doctors: "boolean",
            departments: "boolean", services: "boolean", diagnostics: "boolean",
            facilities: "boolean", contact: "boolean",
        },
        doctorProfiles: "boolean", consultationInformation: "boolean",
        emergencyContact: "boolean", googleMaps: "boolean",
        whatsappContact: "boolean", enquiryForm: "boolean", gallery: "boolean",
        testimonials: "boolean", seo: "boolean",
    },
    diagnostics: { directory: "boolean", pricing: "boolean", booking: "boolean" },
    optional: {
        patientPortal: "boolean",
        notifications: { email: "boolean", sms: "boolean", whatsapp: "boolean" },
        payments: "boolean",
        queue: { display: "boolean", patientLiveStatus: "boolean" },
        reports: "boolean", pharmacy: "boolean",
        clinical: { records: "boolean", prescriptions: "boolean" },
        integrations: { abha: "boolean" },
        organization: { multiBranch: "boolean" },
    },
    operations: {
        hospitalTimezone: "string",
        backup: { enabled: "boolean" },
        portability: { providerNeutral: "boolean", dataExport: "boolean" },
    },
};
const hospitalSchema = { hospital: { displayName: "string" } };
function validate(value, schema, path) {
    if (schema === "string") {
        if (typeof value !== "string" || value.trim().length === 0) {
            throw new Error(`${path} must be a non-empty string`);
        }
        return value;
    }
    if (schema === "boolean") {
        if (typeof value !== "boolean")
            throw new Error(`${path} must be a boolean`);
        return value;
    }
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${path} must be an object`);
    }
    const record = value;
    for (const key of Object.keys(record)) {
        if (!(key in schema))
            throw new Error(`${path}.${key} is not recognized`);
    }
    for (const [key, child] of Object.entries(schema)) {
        validate(record[key], child, `${path}.${key}`);
    }
    return value;
}
function parseYaml(contents, fileName) {
    const document = (0, yaml_1.parseDocument)(contents, { uniqueKeys: true });
    if (document.errors.length > 0) {
        throw new Error(`${fileName}: ${document.errors[0]?.message}`);
    }
    return document.toJS();
}
function parseConfiguration(featureYaml, hospitalYaml) {
    const features = validate(parseYaml(featureYaml, "FEATURES.yaml"), featureSchema, "features");
    const hospital = validate(parseYaml(hospitalYaml, "HOSPITAL_CONFIG.yaml"), hospitalSchema, "hospitalConfig").hospital;
    if (features.product.deploymentMode !== "demo_website") {
        throw new Error("Only demo_website mode is supported by this skeleton");
    }
    if (!features.core.hospital || !features.operations.portability.providerNeutral) {
        throw new Error("Hospital ownership and provider-neutral operation must remain enabled");
    }
    if (!features.core.authentication || !features.core.authorization || !features.core.audit) {
        throw new Error("Authentication, authorization and audit are required core foundations");
    }
    if (features.core.schedules && !features.core.doctors) {
        throw new Error("Schedules require doctors");
    }
    if (features.core.appointments && (!features.core.patients || !features.core.schedules)) {
        throw new Error("Appointments require patients and schedules");
    }
    if (features.diagnostics.booking)
        throw new Error("Diagnostic booking is not implemented yet");
    if (Object.values(features.optional.notifications).some(Boolean) || features.optional.payments || features.optional.patientPortal) {
        throw new Error("Notification delivery, payments and patient login are not implemented yet");
    }
    if (features.diagnostics.pricing && !features.diagnostics.directory) {
        throw new Error("Diagnostics pricing requires the directory");
    }
    if (features.website.doctorProfiles && !features.core.doctors) {
        throw new Error("Doctor profiles require the doctors module");
    }
    try {
        // ICU's list may contain Asia/Calcutta while accepting the Asia/Kolkata alias.
        if (/^[+-]/.test(features.operations.hospitalTimezone))
            throw new Error();
        new Intl.DateTimeFormat("en", { timeZone: features.operations.hospitalTimezone }).format();
    }
    catch {
        throw new Error("operations.hospitalTimezone must be a valid IANA time zone");
    }
    return { features, hospital };
}
function loadConfiguration(environment = process.env) {
    const configDir = (0, node_path_1.resolve)(environment.CONFIG_DIR ?? process.cwd());
    const portText = environment.PORT ?? "3000";
    if (!/^[0-9]+$/.test(portText))
        throw new Error("PORT must be an integer from 1 to 65535");
    const port = Number(portText);
    if (port < 1 || port > 65535)
        throw new Error("PORT must be an integer from 1 to 65535");
    const nodeEnv = environment.NODE_ENV ?? "development";
    if (!["development", "test", "production"].includes(nodeEnv)) {
        throw new Error("NODE_ENV must be development, test or production");
    }
    const config = parseConfiguration((0, node_fs_1.readFileSync)((0, node_path_1.resolve)(configDir, "FEATURES.yaml"), "utf8"), (0, node_fs_1.readFileSync)((0, node_path_1.resolve)(configDir, "HOSPITAL_CONFIG.yaml"), "utf8"));
    const originText = environment.APP_ORIGIN ?? (nodeEnv === "development" ? `http://localhost:${port}` : "");
    let appOrigin;
    try {
        const parsed = new URL(originText);
        if (parsed.origin !== originText || !["http:", "https:"].includes(parsed.protocol))
            throw new Error();
        if (nodeEnv === "production" && parsed.protocol !== "https:")
            throw new Error();
        appOrigin = parsed.origin;
    }
    catch {
        throw new Error("APP_ORIGIN must be one exact origin, using HTTPS in production");
    }
    return { ...config, port, nodeEnv, appOrigin };
}
