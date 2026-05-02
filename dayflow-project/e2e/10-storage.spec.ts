import { test, expect } from "@playwright/test";
import { enterGuestMode } from "./helpers";

test.describe("LocalStorage persistence", () => {
  test("guest mode does not persist data to dayflow_v3 storage", async ({ page }) => {
    await enterGuestMode(page);
    // GUEST_DATA is computed at render-time and never persisted.
    const stored = await page.evaluate(() => localStorage.getItem("dayflow_v3"));
    // Either null or default (income 0) since guest data isn't written through.
    if (stored) {
      const parsed = JSON.parse(stored);
      expect(parsed.monthlyIncome ?? 0).toBe(0);
    }
  });

  test("signing-out from guest is the same as a fresh visit", async ({ page }) => {
    await enterGuestMode(page);
    await page.reload();
    // After reload we should land back on the auth screen, not directly in the app
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible({ timeout: 10_000 });
  });
});
