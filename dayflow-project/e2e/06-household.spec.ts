import { test, expect } from "@playwright/test";
import { enterGuestMode } from "./helpers";

test.describe("Household tab", () => {
  test.beforeEach(async ({ page }) => {
    await enterGuestMode(page);
    await page.locator(".nav-btn", { hasText: "Household" }).first().click();
  });

  test("renders the household header", async ({ page }) => {
    await expect(page.getByText("Household").first()).toBeVisible();
    await expect(page.getByText(/combined view/i)).toBeVisible();
  });

  test("shows the Combined pool toggle", async ({ page }) => {
    await expect(page.getByText(/Combined pool/i)).toBeVisible();
  });

  test("guest sees a single 'You' member by default", async ({ page }) => {
    await expect(page.getByText("You").first()).toBeVisible();
  });
});
