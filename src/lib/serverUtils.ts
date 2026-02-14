import crypto from "crypto";
import { NextRequest } from "next/server";

const DEVICE_COOKIE_KEY = "device_id";

export function ensureDeviceId(existing?: string): string {
  return existing ?? crypto.randomUUID();
}

export function hashSha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function buildVoterHash(pollId: string, deviceId: string): string {
  const salt = process.env.VOTER_HASH_SALT;
  if (!salt) {
    throw new Error("Missing VOTER_HASH_SALT");
  }
  return hashSha256(`${pollId}:${deviceId}:${salt}`);
}

export function getIpAddress(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIp = req.headers.get("x-real-ip");
  return realIp?.trim() || "0.0.0.0";
}

export function buildIpHash(pollId: string, ip: string): string {
  return hashSha256(`${pollId}:${ip}`);
}

export function canonicalizeOption(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

export function normalizeOption(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

export const DEVICE_COOKIE = {
  key: DEVICE_COOKIE_KEY,
  maxAge: 60 * 60 * 24 * 365,
};
