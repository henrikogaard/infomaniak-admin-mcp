import { PublicApiClient } from "../infomaniak/client.js";

let cached: number[] | null = null;
let cachedAt = 0;
const TTL_MS = 5 * 60 * 1000;

export async function listAccountIds(): Promise<number[]> {
  if (cached && Date.now() - cachedAt < TTL_MS) return cached;
  const client = new PublicApiClient();

  try {
    const accounts = await client.request<Array<{ id: number; name?: string }>>(
      "GET",
      "/1/account",
    );
    cached = accounts
      .map((a) => a.id)
      .filter((id): id is number => typeof id === "number");
  } catch {
    cached = [];
  }
  cachedAt = Date.now();
  return cached;
}

export async function defaultAccountId(): Promise<number | null> {
  const ids = await listAccountIds();
  return ids[0] ?? null;
}
