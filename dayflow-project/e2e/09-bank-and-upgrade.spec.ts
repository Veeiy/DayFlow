import { test, expect } from "@playwright/test";
import { enterGuestMode } from "./helpers";

test.describe("Bank connections flow", () => {
  test.beforeEach(async ({ page }) => {
    await enterGuestMode(page);
    await page.locator(".nav-btn", { hasText: "More" }).click();
    await page.getByText(/Bank connections/i).click();
  });

  test("shows the empty 'Connect your bank' state", async ({ page }) => {
    await expect(page.getByText(/Connect your bank/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect with Plaid/i })).toBeVisible();
  });

  test("clicking 'Connect with Plaid' opens the Plaid modal with banks", async ({ page }) => {
    await page.getByRole("button", { name: /Connect with Plaid/i }).click();

    // The Plaid sheet renders our supported banks.
    for (const bank of ["Chase", "Bank of America", "Wells Fargo", "Citibank", "Capital One"]) {
      await expect(page.getByText(bank, { exact: false }).first()).toBeVisible();
    }
  });
});

test.describe("Upgrade modal", () => {
  test("upgrade chip is hidden in guest mode", async ({ page }) => {
    await enterGuestMode(page);
    // The header upgrade pill only appears for signed-in non-free-paywalled users.
    await expect(page.getByRole("button", { name: /Upgrade ✦/ })).toBeHidden();
  });
});
