import { expect, test } from "bun:test";
import {
  createProviderHttp,
  createStockImages,
  StockImageError,
  type StockImageProvider,
} from "../src/index.js";
import { z } from "zod";
const empty = { images: [], page: 1, nextPage: null, total: 0 };
const provider = (
  id: string,
  search: StockImageProvider["search"],
): StockImageProvider => ({
  id,
  name: id,
  search,
  get: async () => {
    throw new Error("unused");
  },
  select: async () => {
    throw new Error("unused");
  },
});
test("partial failure is distinct from no results and missing configuration", async () => {
  const service = createStockImages([
    provider("ok", async () => empty),
    provider("limited", async () => {
      throw new StockImageError("limited", "rate_limited", 60);
    }),
  ]);
  const data = await service.search({ query: "Pilates" });
  expect(data.results[0]).toMatchObject({ ok: true, images: [] });
  expect(data.results[1]).toMatchObject({
    ok: false,
    code: "rate_limited",
    retryAfterSeconds: 60,
  });
  expect(await createStockImages([]).search({ query: "Pilates" })).toEqual({
    configured: false,
    results: [],
  });
});
test("invalid inputs make no provider calls and duplicate registrations fail", async () => {
  let calls = 0;
  const p = provider("p", async () => {
    calls++;
    return empty;
  });
  await expect(
    createStockImages([p]).search({ query: " ", perPage: 100 }),
  ).rejects.toThrow("invalid_input");
  expect(calls).toBe(0);
  expect(() => createStockImages([p, p])).toThrow("Duplicate");
});
test("transport cannot follow redirects or leak credentials in errors", async () => {
  const request = createProviderHttp(
    "test",
    "https://example.com",
    {
      apiKey: "secret",
      transport: async (_, init) => {
        expect(init.redirect).toBe("error");
        throw new Error("secret");
      },
    },
    { Authorization: "secret" },
  );
  await expect(
    request(new URL("https://example.com/search"), z.object({})),
  ).rejects.toThrow("unavailable");
  await expect(
    request(new URL("https://evil.example/search"), z.object({})),
  ).rejects.toThrow("invalid_input");
});
test("cancellation is not silently converted into an empty result", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    createStockImages([]).search({ query: "Pilates" }, controller.signal),
  ).rejects.toThrow();
});
