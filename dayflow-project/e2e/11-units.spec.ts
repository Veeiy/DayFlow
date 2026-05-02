import { test, expect } from "@playwright/test";

/**
 * In-page unit tests of the extracted lib/* modules. We bring up the dev server
 * (so Vite serves the modules) and import them via dynamic import in the page
 * context. This validates that the modular split preserved behavior and that
 * the modules are wired up correctly.
 */
test.describe("Pure-utility modules (in-browser unit tests)", () => {
  test.beforeEach(async ({ page }) => {
    // Land on the app so vite is serving modules
    await page.goto("/");
  });

  test("money helpers compute totals and formatting", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const m = await import("/src/lib/money.js");
      const bills = [
        { amount: 1200, frequency: "monthly" },
        { amount: 100,  frequency: "weekly"  }, // ≈ 433/mo with 31-day month
        { amount: 1200, frequency: "yearly"  }, // 100/mo
        { amount: 10,   frequency: "daily"   }, // 10*DIM
      ];
      const total = m.totalBills(bills);
      const pool  = m.calcPool(5000, bills);
      const fmt0  = m.fmt(1234.56);
      const fmt2  = m.fmtFull(1234.5);
      return { total, pool, fmt0, fmt2 };
    });
    // Sanity bounds (DIM varies by month, but range is stable)
    expect(result.total).toBeGreaterThan(1500);
    expect(result.pool).toBeLessThan(5000);
    expect(result.fmt0).toContain("$1,235");
    expect(result.fmt2).toBe("$1,234.50");
  });

  test("date helpers return ISO-shaped strings", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const d = await import("/src/lib/dates.js");
      return {
        todayKey:  d.todayKey(),
        thisMonth: d.thisMonth(),
        DIM:       d.DIM,
      };
    });
    expect(result.todayKey).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.thisMonth).toMatch(/^\d{4}-\d{2}$/);
    expect(result.DIM).toBeGreaterThanOrEqual(28);
    expect(result.DIM).toBeLessThanOrEqual(31);
  });

  test("storage round-trips to localStorage", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const s = await import("/src/lib/storage.js");
      const sample = { ...s.DEFAULTS, monthlyIncome: 5000 };
      s.persist(sample);
      const back = s.load();
      return { income: back.monthlyIncome, key: s.STORE_KEY };
    });
    expect(result.income).toBe(5000);
    expect(result.key).toBe("dayflow_v3");
  });

  test("constants module has tabs, banks, categories, prices", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const c = await import("/src/lib/constants.js");
      return {
        tabIds:  c.TABS.map((t: any) => t.id),
        banks:   c.BANKS,
        catIds:  c.CATS.map((x: any) => x.id),
        prices:  Object.keys(c.PRICES),
      };
    });
    expect(result.tabIds).toEqual(["today", "history", "recurring", "household", "advisor"]);
    expect(result.banks).toContain("Chase");
    expect(result.catIds).toContain("housing");
    expect(result.prices).toEqual(["pro", "business"]);
  });

  test("mockData generates today-relative Plaid transactions", async ({ page }) => {
    const result = await page.evaluate(async () => {
      const m = await import("/src/lib/mockData.js");
      return {
        count:  m.MOCK_PLAID.length,
        first:  m.MOCK_PLAID[0]?.name,
        guestIncome: m.GUEST_DATA.monthlyIncome,
      };
    });
    expect(result.count).toBe(12);
    expect(result.first).toBeTruthy();
    expect(result.guestIncome).toBe(4200);
  });
});
