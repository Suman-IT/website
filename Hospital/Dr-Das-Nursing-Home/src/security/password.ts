import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const COST = 131072;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const KEY_LENGTH = 64;
const MAX_MEMORY = 256 * 1024 * 1024;
const DUMMY_HASH = `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${"00".repeat(16)}$${"00".repeat(KEY_LENGTH)}`;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH,
      { N: COST, r: BLOCK_SIZE, p: PARALLELISM, maxmem: MAX_MEMORY },
      (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 1024) {
    throw new Error("Password must contain 12 to 1024 characters");
  }
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return `scrypt$${COST}$${BLOCK_SIZE}$${PARALLELISM}$${salt.toString("hex")}$${key.toString("hex")}`;
}

export async function verifyPassword(password: string, storedHash?: string): Promise<boolean> {
  const parts = (storedHash ?? DUMMY_HASH).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt" || Number(parts[1]) !== COST ||
      Number(parts[2]) !== BLOCK_SIZE || Number(parts[3]) !== PARALLELISM ||
      !/^[0-9a-f]{32}$/.test(parts[4] ?? "") ||
      !/^[0-9a-f]{128}$/.test(parts[5] ?? "")) return false;
  const key = await derive(password, Buffer.from(parts[4]!, "hex"));
  return timingSafeEqual(key, Buffer.from(parts[5]!, "hex")) && storedHash !== undefined;
}
