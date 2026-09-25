export class HttpError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export function bodyObject(raw: unknown, allowed: readonly string[], required: readonly string[] = []): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new HttpError(400, "Expected an object");
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).length === 0 || Object.keys(body).some((key) => !allowed.includes(key)) ||
      required.some((key) => !(key in body))) throw new HttpError(400, "Invalid fields");
  return body;
}

export function textField(value: unknown, field: string, max = 150): string {
  if (typeof value !== "string") throw new HttpError(400, `${field} must be text`);
  const text = value.trim();
  if (!text || text.length > max || /[\u0000-\u001f\u007f]/.test(text)) {
    throw new HttpError(400, `${field} is invalid`);
  }
  return text;
}

export function slugField(value: unknown): string {
  const slug = textField(value, "slug");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(400, "slug is invalid");
  return slug;
}

export function boolField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new HttpError(400, `${field} must be a boolean`);
  return value;
}

export function idField(value: unknown, field = "id"): string {
  if (typeof value !== "string" || !/^[1-9]\d{0,19}$/.test(value) ||
      BigInt(value) > 18446744073709551615n) throw new HttpError(400, `${field} is invalid`);
  return value;
}

export function dateField(value: unknown, field = "date"): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpError(400, `${field} must be YYYY-MM-DD`);
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new HttpError(400, `${field} is not a valid date`);
  }
  return value;
}

export function timeField(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::00)?$/.test(value)) {
    throw new HttpError(400, `${field} must be HH:MM`);
  }
  return `${value.slice(0, 5)}:00`;
}

export function intField(value: unknown, field: string, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    throw new HttpError(400, `${field} must be an integer from ${min} to ${max}`);
  }
  return value;
}

export function optionalField<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null || value === undefined ? null : parse(value);
}

export function idList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length > 20) throw new HttpError(400, `${field} must be an array of up to 20 IDs`);
  const ids = value.map((item) => idField(item, field));
  if (new Set(ids).size !== ids.length) throw new HttpError(400, `${field} has duplicates`);
  return ids;
}

export function isDuplicateKey(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY";
}
