"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HttpError = void 0;
exports.bodyObject = bodyObject;
exports.textField = textField;
exports.slugField = slugField;
exports.boolField = boolField;
exports.idField = idField;
exports.dateField = dateField;
exports.timeField = timeField;
exports.intField = intField;
exports.optionalField = optionalField;
exports.idList = idList;
exports.isDuplicateKey = isDuplicateKey;
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
exports.HttpError = HttpError;
function bodyObject(raw, allowed, required = []) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw))
        throw new HttpError(400, "Expected an object");
    const body = raw;
    if (Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowed.includes(key)) ||
        required.some((key) => !(key in body)))
        throw new HttpError(400, "Invalid fields");
    return body;
}
function textField(value, field, max = 150) {
    if (typeof value !== "string")
        throw new HttpError(400, `${field} must be text`);
    const text = value.trim();
    if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) {
        throw new HttpError(400, `${field} is invalid`);
    }
    return text;
}
function slugField(value) {
    const slug = textField(value, "slug");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
        throw new HttpError(400, "slug is invalid");
    return slug;
}
function boolField(value, field) {
    if (typeof value !== "boolean")
        throw new HttpError(400, `${field} must be a boolean`);
    return value;
}
function idField(value, field = "id") {
    if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value) ||
        BigInt(value) > 18446744073709551615n)
        throw new HttpError(400, `${field} is invalid`);
    return value;
}
function dateField(value, field = "date") {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new HttpError(400, `${field} must be YYYY-MM-DD`);
    }
    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
        throw new HttpError(400, `${field} is not a valid date`);
    }
    return value;
}
function timeField(value, field) {
    if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value)) {
        throw new HttpError(400, `${field} must be HH:MM`);
    }
    return `${value.slice(0, 5)}:00`;
}
function intField(value, field, min, max) {
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
        throw new HttpError(400, `${field} must be an integer from ${min} to ${max}`);
    }
    return value;
}
function optionalField(value, parse) {
    return value === null || value === undefined ? null : parse(value);
}
function idList(value, field) {
    if (!Array.isArray(value) || value.length > 20)
        throw new HttpError(400, `${field} must be an array of up to 20 IDs`);
    const ids = value.map((item) => idField(item, field));
    if (new Set(ids).size !== ids.length)
        throw new HttpError(400, `${field} has duplicates`);
    return ids;
}
function isDuplicateKey(error) {
    return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}
