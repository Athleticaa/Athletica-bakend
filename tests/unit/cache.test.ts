describe("CacheService Unit Tests", () => {
  const OLD_REDIS = process.env.REDIS_URL;
  const OLD_CACHE = process.env.CACHE_ENABLED;

  afterEach(() => {
    if (OLD_REDIS === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = OLD_REDIS;
    if (OLD_CACHE === undefined) delete process.env.CACHE_ENABLED;
    else process.env.CACHE_ENABLED = OLD_CACHE;
    const store = globalThis as unknown as { __athleticaRedis?: { disconnect: () => void } };
    try {
      store.__athleticaRedis?.disconnect();
    } catch {
      /* ignore */
    }
    delete store.__athleticaRedis;
    jest.resetModules();
  });

  function freshCache() {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../../src/lib/cache") as typeof import("../../src/lib/cache");
  }

  describe("hashQuery + cacheKeys", () => {
    it("hashes equal queries to equal keys regardless of key order", () => {
      const { hashQuery } = freshCache();
      const a = hashQuery({ filters: { search: "push", equipment: "dumbbell" }, page: 1, pageSize: 20 });
      const b = hashQuery({ page: 1, pageSize: 20, filters: { equipment: "dumbbell", search: "push" } });
      expect(a).toBe(b);
    });

    it("hashes different queries to different keys", () => {
      const { hashQuery } = freshCache();
      expect(hashQuery({ page: 1 })).not.toBe(hashQuery({ page: 2 }));
    });

    it("builds namespaced exercise keys", () => {
      const { cacheKeys } = freshCache();
      expect(cacheKeys.exerciseList("abc123")).toContain(":ex:list:abc123");
      expect(cacheKeys.exerciseItem("id-1")).toContain(":ex:item:id-1");
      expect(cacheKeys.exerciseList("x").startsWith("athletica:")).toBe(true);
    });
  });

  describe("disabled-clean (no REDIS_URL)", () => {
    it("cacheHeader returns DISABLED and getOrSet runs the loader with hit=false", async () => {
      delete process.env.REDIS_URL;
      const { CacheService, cacheHeader } = freshCache();
      expect(CacheService.isEnabled()).toBe(false);
      expect(cacheHeader(false)).toBe("DISABLED");

      const loader = jest.fn().mockResolvedValue({ items: [1], pagination: {} });
      const res = await CacheService.getOrSet("any:key", 60, loader);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(res).toEqual({ value: { items: [1], pagination: {} }, hit: false });
    });

    it("refresh/del/delByPrefix resolve without throwing when disabled", async () => {
      delete process.env.REDIS_URL;
      const { CacheService } = freshCache();
      await expect(CacheService.refresh("k", 60, async () => 1)).resolves.toBeUndefined();
      await expect(CacheService.del("k")).resolves.toBeUndefined();
      await expect(CacheService.delByPrefix("p:")).resolves.toBeUndefined();
      await expect(CacheService.ping()).resolves.toBe("disabled");
    });
  });

  describe("fail-open (Redis unreachable)", () => {
    it("getOrSet falls back to the loader with hit=false and never throws", async () => {
      process.env.REDIS_URL = "redis://127.0.0.1:6399";
      const { CacheService } = freshCache();
      expect(CacheService.isEnabled()).toBe(true);

      const loader = jest.fn().mockResolvedValue([1, 2]);
      const res = await CacheService.getOrSet("some:key", 60, loader);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(res.hit).toBe(false);
      expect(res.value).toEqual([1, 2]);
    }, 15000);

    it("loader errors propagate (DB errors are not swallowed)", async () => {
      process.env.REDIS_URL = "redis://127.0.0.1:6399";
      const { CacheService } = freshCache();
      await expect(CacheService.getOrSet("k", 60, async () => {
        throw new Error("db down");
      })).rejects.toThrow("db down");
    }, 15000);

    it("refresh with a failing loader resolves and drops the key instead of throwing", async () => {
      process.env.REDIS_URL = "redis://127.0.0.1:6399";
      const { CacheService } = freshCache();
      await expect(CacheService.refresh("k", 60, async () => {
        throw new Error("db blip after write");
      })).resolves.toBeUndefined();
    }, 15000);

    it("ping reports down when Redis is unreachable", async () => {
      process.env.REDIS_URL = "redis://127.0.0.1:6399";
      const { CacheService } = freshCache();
      await expect(CacheService.ping()).resolves.toBe("down");
    }, 15000);
  });
});
