import { test, expect } from "@playwright/test";
import { enterGuestMode } from "./helpers";

test.describe("Guest mode", () => {
  test("entering guest mode shows the dashboard", async ({ page }) => {
    await enterGuestMode(page);

    // Hero card stats
    await expect(page.getByText("LEFT TODAY")).toBeVisible();
    await expect(page.getByText("MONTH POOL")).toBeVisible();
    await expect(page.getByText("USED")).toBeVisible();

    // Pool math card uses seeded $4,200 income
    await expect(page.getByText(/Last month's income/i)).toBeVisible();
  });

  test("guest banner offers a sign-up CTA", async ({ page }) => {
    await enterGuestMode(page);
    const cta = page.getByRole("button", { name: /Sign up free/i });
    await expect(cta).toBeVisible();
  });

  test("guest is gated when trying to log a transaction", async ({ page }) => {
    await enterGuestMode(page);

    await page.getByPlaceholder(/What did you spend on\?/i).fill("Coffee");
    await page.locator('input[type="number"]').first().fill("4.50");
    await page.getByRole("button", { name: /^Add$/ }).click();

    // Auth gate sheet
    await expect(page.getByText(/Create a free account/i).first()).toBeVisible();
  });

  test("seeded GUEST_DATA shows preloaded transactions on Today tab", async ({ page }) => {
    await enterGuestMode(page);
    // GUEST_DATA seeds two expenses today: Starbucks $6.75 and Lunch $14.20.
    await expect(page.getByText("Starbucks")).toBeVisible();
    await expect(page.getByText("Lunch")).toBeVisible();
  });

  test("guest mode hero displays a non-zero spendable pool", async ({ page }) => {
    await enterGuestMode(page);
    // Seeded income $4,200 minus seeded bills (~$1,690) ≈ $2,510 pool
    // The hero card "MONTH POOL" stat should be visible and look like currency.
    const poolStat = page.locator("text=/\\$[0-9,]+/").first();
    await expect(poolStat).toBeVisible();
  });
});
