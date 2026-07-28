import { afterEach, describe, expect, it, vi } from "vitest";

import { PublicApiClient } from "../../src/infomaniak/client.js";

describe("PublicApiClient query encoding", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("repeats array-valued query parameters instead of stringifying the array", async () => {
    let requestedUrl = "";
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      requestedUrl = String(input);
      return new Response(JSON.stringify({ result: "success", data: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    await new PublicApiClient("test-token").request("GET", "/2/example", {
      query: {
        actions: ["file_create", "file_delete"],
        files: [10, 20],
        lang: "en",
      },
    });

    const url = new URL(requestedUrl);
    expect(url.searchParams.getAll("actions")).toEqual([
      "file_create",
      "file_delete",
    ]);
    expect(url.searchParams.getAll("files")).toEqual(["10", "20"]);
    expect(url.searchParams.get("lang")).toBe("en");
  });
});
