import { InfomaniakAuthError } from "./errors.js";
import { loadConfig } from "../config.js";
import { childLogger } from "../runtime/logger.js";

const log = childLogger({ module: "infomaniak/manager-session" });

export interface ManagerSession {
  sasession: string;
  xsrfToken: string;
  source: "auto" | "manual";
  acquiredAt: Date;
}

export async function loadManagerSession(): Promise<ManagerSession> {
  const config = loadConfig();

  if (config.INFOMANIAK_AUTH_MODE === "disabled") {
    throw new InfomaniakAuthError({
      message: "Manager-private operations are disabled",
      actionable:
        "Set INFOMANIAK_AUTH_MODE=auto (or manual) in your MCP client env block or shell environment.",
    });
  }

  if (config.INFOMANIAK_AUTH_MODE === "manual") {
    if (!config.INFOMANIAK_SASESSION || !config.INFOMANIAK_XSRF_TOKEN) {
      throw new InfomaniakAuthError({
        message: "Manual auth selected but credentials are missing",
        actionable:
          "Set both INFOMANIAK_SASESSION and INFOMANIAK_XSRF_TOKEN in your environment, " +
          "or switch to INFOMANIAK_AUTH_MODE=auto for automatic Chrome extraction.",
      });
    }
    return {
      sasession: config.INFOMANIAK_SASESSION,
      xsrfToken: decodeURIComponent(config.INFOMANIAK_XSRF_TOKEN),
      source: "manual",
      acquiredAt: new Date(),
    };
  }

  return loadSessionFromChrome();
}

async function loadSessionFromChrome(): Promise<ManagerSession> {
  const { default: chrome } = await import("chrome-cookies-secure");

  const profileOverride =
    process.env["CHROME_COOKIES_PATH"] || process.env["CHROME_PROFILE"];
  const cookieJar = await new Promise<Record<string, string>>(
    (resolve, reject) => {
      const cb = (err: Error | null, cookies: Record<string, string>): void => {
        if (err) {
          reject(err);
          return;
        }
        resolve(cookies);
      };
      if (profileOverride) {
        chrome.getCookies(
          "https://manager.infomaniak.com/",
          "object",
          cb,
          profileOverride,
        );
      } else {
        chrome.getCookies("https://manager.infomaniak.com/", "object", cb);
      }
    },
  ).catch((err: unknown) => {
    log.error({ err }, "Failed to read Chrome cookies");
    throw new InfomaniakAuthError({
      message: "Could not read Chrome cookies",
      actionable:
        "Make sure Chrome is installed and you have at least once opened https://manager.infomaniak.com. " +
        "On macOS, you may need to grant Keychain access. " +
        "Alternatively, switch to INFOMANIAK_AUTH_MODE=manual and set the manager cookies as environment variables.",
      cause: err,
    });
  });

  const sasession = cookieJar["SASESSION"];
  const xsrfRaw = cookieJar["MANAGER-XSRF-TOKEN"];

  if (!sasession || !xsrfRaw) {
    throw new InfomaniakAuthError({
      message: "Required Infomaniak cookies not found in Chrome",
      actionable:
        "Open https://manager.infomaniak.com in Chrome and log in. Then retry. " +
        "If the problem persists, switch to INFOMANIAK_AUTH_MODE=manual.",
    });
  }

  log.debug(
    { source: "chrome", hasSasession: true, hasXsrf: true },
    "Manager session loaded",
  );

  return {
    sasession,
    xsrfToken: decodeURIComponent(xsrfRaw),
    source: "auto",
    acquiredAt: new Date(),
  };
}
