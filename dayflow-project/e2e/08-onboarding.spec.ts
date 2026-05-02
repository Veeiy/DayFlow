import { test, expect } from "@playwright/test";

test.describe("Onboarding flow (guest entry)", () => {
  test("guest user can dismiss the splash and reach auth without onboarding (gated)", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible({ timeout: 10_000 });

    // Onboarding modal is only triggered for fresh signed-in users (not guest).
    await expect(page.getByText(/Welcome to DayFlow/i)).toBeHidden();
  });

  test("first-load shows splash content briefly", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText(/Your daily money, simplified/i)).toBeVisible({ timeout: 5_000 });
  });
});
