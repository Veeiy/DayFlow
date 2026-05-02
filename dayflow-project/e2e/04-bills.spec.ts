import { test, expect } from "@playwright/test";
import { enterGuestMode } from "./helpers";

test.describe("Bills tab", () => {
  test.beforeEach(async ({ page }) => {
    await enterGuestMode(page);
    await page.locator(".nav-btn", { hasText: "Bills" }).first().click();
  });

  test("renders the recurring bill form with category buttons", async ({ page }) => {
    await expect(page.getByText("Add recurring expense")).toBeVisible();
    // Category chips render as buttons with category labels
    for (const label of ["HOUSING", "TRANSPORT", "SUBSCRIPTIONS", "FOOD", "UTILITIES", "OTHER"]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
  });

  test("name + amount inputs are present", async ({ page }) => {
    await expect(page.getByPlaceholder(/Name \(e\.g\./i)).toBeVisible();
    await expect(page.getByPlaceholder(/Amount/i)).toBeVisible();
  });

  test("frequency select offers all four cadences", async ({ page }) => {
    const select = page.locator("select.sel").first();
    await expect(select).toBeVisible();
    const options = await select.locator("option").allTextContents();
    expect(options).toEqual(["Daily", "Weekly", "Monthly", "Yearly"]);
  });

  test("guest empty state is shown (Bills tab uses non-guest data)", async ({ page }) => {
    // Note: the Bills tab reads `data.recurringPayments` directly (not GUEST_DATA),
    // so a guest user sees the empty state.
    await expect(page.getByText(/No recurring expenses yet/i)).toBeVisible();
  });

  test("submitting a bill while guest gets gated", async ({ page }) => {
    await page.getByPlaceholder(/Name \(e\.g\./i).fill("Gym");
    await page.getByPlaceholder(/Amount/i).fill("39");
    // Submit by pressing Enter inside the Amount field
    await page.getByPlaceholder(/Amount/i).press("Enter");

    await expect(page.getByText(/Create a free account/i).first()).toBeVisible();
  });
});
