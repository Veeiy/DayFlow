import { test, expect } from "@playwright/test";
import { enterGuestMode } from "./helpers";

test.describe("Spending history tab", () => {
  test.beforeEach(async ({ page }) => {
    await enterGuestMode(page);
    await page.locator(".nav-btn", { hasText: "Spending" }).first().click();
  });

  test("renders the Pool/Spent/Left summary", async ({ page }) => {
    await expect(page.getByText("Pool", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Spent", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Left", { exact: true }).first()).toBeVisible();
  });

  test("renders a calendar grid of days", async ({ page }) => {
    // The calendar uses .cal-cell class for each day cell
    const cells = page.locator(".cal-cell");
    await expect(cells.first()).toBeVisible();
    // Should have at least 28 day cells (smallest month) up to 42 (calendar grid)
    expect(await cells.count()).toBeGreaterThanOrEqual(28);
  });

  test("renders DOW headers Su Mo Tu We Th Fr Sa", async ({ page }) => {
    for (const dow of ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"]) {
      await expect(page.getByText(dow, { exact: true }).first()).toBeVisible();
    }
  });
});
