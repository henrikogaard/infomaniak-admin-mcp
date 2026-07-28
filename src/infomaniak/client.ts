import { randomUUID } from "node:crypto";

import { type ManagerSession, loadManagerSession } from "./manager-session.js";
import { loadConfig } from "../config.js";
import {
  type RateLimiter,
  createInfomaniakRateLimiter,
} from "../runtime/rate-limit.js";
import { childLogger } from "../runtime/logger.js";

import { mapHttpError, InfomaniakError } from "./errors.js";

const log = childLogger({ module: "infomaniak/client" });

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type QueryValue =
  | string
  | number
  | boolean
  | ReadonlyArray<string | number | boolean>;

export interface RequestOptions {
  query?: Record<string, QueryValue | undefined>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

interface SuccessEnvelope<T> {
  result: "success";
  data: T;
}

const PUBLIC_BASE_URL = "https://api.infomaniak.com";
const MANAGER_BASE_URL = "https://manager.infomaniak.com";

const sharedRateLimiter = createInfomaniakRateLimiter(
  runningUnderTest() ? 10_000 : loadConfig().RATE_LIMIT_PER_MINUTE,
);

export class PublicApiClient {
  private readonly token: string;
  private readonly rateLimiter: RateLimiter;

  constructor(
    token: string = loadConfig().INFOMANIAK_API_TOKEN,
    rateLimiter: RateLimiter = sharedRateLimiter,
  ) {
    this.token = token;
    this.rateLimiter = rateLimiter;
  }

  public async request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const url = buildUrl(PUBLIC_BASE_URL, path, options.query);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: "application/json",
      ...(options.headers ?? {}),
    };
    return sendRequest<T>(this.rateLimiter, method, url, headers, options);
  }
}

export class ManagerApiClient {
  private readonly rateLimiter: RateLimiter;
  private session: ManagerSession | null;

  constructor(rateLimiter: RateLimiter = sharedRateLimiter) {
    this.rateLimiter = rateLimiter;
    this.session = null;
  }

  private async ensureSession(): Promise<ManagerSession> {
    if (this.session === null) {
      this.session = await loadManagerSession();
    }
    return this.session;
  }

  public async refreshSession(): Promise<void> {
    this.session = await loadManagerSession();
  }

  public async request<T>(
    method: HttpMethod,
    path: string,
    options: RequestOptions = {},
  ): Promise<T> {
    const session = await this.ensureSession();
    const url = buildUrl(MANAGER_BASE_URL, path, options.query);
    const headers: Record<string, string> = {
      Cookie: `SASESSION=${session.sasession}`,
      Accept: "application/json",
      "X-Requested-With": "XMLHttpRequest",
      Referer: "https://manager.infomaniak.com/",
      ...(options.headers ?? {}),
    };
    if (method !== "GET") {
      headers["X-XSRF-TOKEN"] = session.xsrfToken;
    }
    return sendRequest<T>(this.rateLimiter, method, url, headers, options);
  }
}

async function sendRequest<T>(
  rateLimiter: RateLimiter,
  method: HttpMethod,
  url: string,
  headers: Record<string, string>,
  options: RequestOptions,
): Promise<T> {
  await rateLimiter.acquire();
  const requestId = randomUUID();
  const correlatedLog = log.child({ requestId, method, url });
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30_000;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const init: RequestInit = {
    method,
    headers,
    signal: controller.signal,
  };
  if (options.body !== undefined) {
    init.body = JSON.stringify(options.body);
    headers["Content-Type"] = headers["Content-Type"] ?? "application/json";
  }

  try {
    const response = await fetch(url, init);
    const text = await response.text();
    let parsed: unknown = null;
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }
    if (!response.ok) {
      throw mapHttpError(response.status, parsed, { method, path: url });
    }
    correlatedLog.debug({ status: response.status }, "API call success");
    return readPayload<T>(parsed);
  } catch (err) {
    if (err instanceof InfomaniakError) {
      throw err;
    }
    if (err instanceof Error && err.name === "AbortError") {
      throw new InfomaniakError({
        message: `Request timed out after ${timeoutMs}ms`,
        actionable:
          "Increase timeoutMs in the call options or check Infomaniak status.",
        cause: err,
      });
    }
    throw new InfomaniakError({
      message: "Network or unknown error",
      actionable:
        "Check your internet connection. Logs contain the underlying error.",
      cause: err,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function buildUrl(
  base: string,
  path: string,
  query?: Record<string, QueryValue | undefined>,
): string {
  const url = new URL(path, base);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) {
        if (Array.isArray(value)) {
          for (const item of value) {
            url.searchParams.append(key, String(item));
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
  }
  return url.toString();
}

function readPayload<T>(parsed: unknown): T {
  if (
    typeof parsed === "object" &&
    parsed !== null &&
    "result" in parsed &&
    (parsed as { result?: unknown }).result === "success" &&
    "data" in parsed
  ) {
    return (parsed as SuccessEnvelope<T>).data;
  }

  return parsed as T;
}

function runningUnderTest(): boolean {
  return process.env["NODE_ENV"] === "test" || process.env["VITEST"] === "true";
}
