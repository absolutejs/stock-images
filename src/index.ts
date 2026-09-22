import { z } from "zod";

export const searchInputSchema = z
  .object({
    query: z.string().trim().min(1).max(200),
    page: z.number().int().min(1).max(1000).default(1),
    perPage: z.number().int().min(1).max(30).default(12),
    orientation: z.enum(["landscape", "portrait", "square"]).optional(),
  })
  .strict();
export type StockImageSearch = z.input<typeof searchInputSchema>;
export type StockImageRequest = z.output<typeof searchInputSchema>;
export interface StockImage {
  provider: string;
  id: string;
  /** Provider-supplied description, not a verified visual classification. */
  description: string | null;
  width: number;
  height: number;
  urls: { thumbnail: string; display: string; original: string };
  sourceUrl: string;
  photographer: { name: string; url: string };
  attribution: {
    text: string;
    providerName: string;
    providerUrl: string;
    required: boolean;
  };
  license: { name: string; url: string };
  usage: { hotlinkRequired: boolean; selectionNotificationRequired: boolean };
}
export interface StockImagePage {
  images: StockImage[];
  page: number;
  nextPage: number | null;
  total: number;
}
export interface StockImageProvider {
  id: string;
  name: string;
  search(
    input: StockImageSearch,
    signal?: AbortSignal,
  ): Promise<StockImagePage>;
  get(id: string, signal?: AbortSignal): Promise<StockImage>;
  /** Call on actual insertion/selection, not search or hover. Resolves fresh metadata. */
  select(id: string, signal?: AbortSignal): Promise<StockImage>;
}
export type StockImageErrorCode =
  | "invalid_input"
  | "unauthorized"
  | "rate_limited"
  | "not_found"
  | "unavailable"
  | "invalid_response";
export class StockImageError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: StockImageErrorCode,
    public readonly retryAfterSeconds?: number,
  ) {
    super(`Stock image provider ${provider}: ${code}`);
    this.name = "StockImageError";
  }
}
export const parseSearch = (input: StockImageSearch): StockImageRequest => {
  const result = searchInputSchema.safeParse(input);
  if (!result.success) throw new StockImageError("search", "invalid_input");
  return result.data;
};
export const parseImageId = (
  provider: string,
  id: string,
  pattern: RegExp,
): string => {
  if (!pattern.test(id) || id.length > 100)
    throw new StockImageError(provider, "invalid_input");
  return id;
};
export const httpsUrl = (hosts: readonly string[]) =>
  z
    .string()
    .url()
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        hosts.includes(url.hostname) &&
        !url.username &&
        !url.password &&
        !url.port
      );
    });
export interface ProviderOptions {
  apiKey: string;
  /** Server-side transport injection for tests or controlled egress. */
  transport?: (url: URL, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
}
export const createProviderHttp = (
  provider: string,
  origin: string,
  options: ProviderOptions,
  headers: Record<string, string>,
) => {
  if (!options.apiKey.trim())
    throw new StockImageError(provider, "unauthorized");
  const timeoutMs = options.timeoutMs ?? 10000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
    throw new StockImageError(provider, "invalid_input");
  return async <T>(
    url: URL,
    schema: z.ZodType<T>,
    signal?: AbortSignal,
  ): Promise<T> => {
    if (url.origin !== origin || url.username || url.password)
      throw new StockImageError(provider, "invalid_input");
    signal?.throwIfAborted();
    const deadline = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, deadline]) : deadline;
    try {
      const response = await (options.transport ?? fetch)(url, {
        headers,
        redirect: "error",
        signal: combined,
      });
      if (!response.ok) {
        const retry = Number(response.headers.get("retry-after"));
        throw new StockImageError(
          provider,
          response.status === 429
            ? "rate_limited"
            : response.status === 401 || response.status === 403
              ? "unauthorized"
              : response.status === 404
                ? "not_found"
                : "unavailable",
          Number.isFinite(retry) && retry > 0 ? retry : undefined,
        );
      }
      const result = schema.safeParse(await response.json());
      if (!result.success)
        throw new StockImageError(provider, "invalid_response");
      return result.data;
    } catch (error) {
      signal?.throwIfAborted();
      if (error instanceof StockImageError) throw error;
      // Never return provider bodies, request headers or transport error messages (keys may be present).
      throw new StockImageError(provider, "unavailable");
    }
  };
};

export const createStockImages = (providers: readonly StockImageProvider[]) => {
  const registry = new Map(
    providers.map((provider) => [provider.id, provider]),
  );
  if (registry.size !== providers.length)
    throw new Error("Duplicate stock image provider");
  const resolve = (id: string) => {
    const provider = registry.get(id);
    if (!provider) throw new StockImageError(id, "unavailable");
    return provider;
  };
  return {
    providers: providers.map(({ id, name }) => ({ id, name })),
    async search(input: StockImageSearch, signal?: AbortSignal) {
      const parsed = parseSearch(input);
      signal?.throwIfAborted();
      const results = await Promise.all(
        providers.map(async (provider) => {
          try {
            return {
              provider: provider.id,
              ok: true as const,
              ...(await provider.search(parsed, signal)),
            };
          } catch (error) {
            signal?.throwIfAborted();
            return {
              provider: provider.id,
              ok: false as const,
              code:
                error instanceof StockImageError
                  ? error.code
                  : ("unavailable" as const),
              retryAfterSeconds:
                error instanceof StockImageError
                  ? error.retryAfterSeconds
                  : undefined,
            };
          }
        }),
      );
      return { configured: providers.length > 0, results };
    },
    get: (provider: string, id: string, signal?: AbortSignal) =>
      resolve(provider).get(id, signal),
    select: (provider: string, id: string, signal?: AbortSignal) =>
      resolve(provider).select(id, signal),
  };
};
