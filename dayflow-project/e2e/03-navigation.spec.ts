import { test, expect } from "@playwright/test";
import { enterGuestMode } from "./helpers";

test.describe("Tab navigation", () => {
  test.beforeEach(async ({ page }) => {
    await enterGuestMode(page);
  });

  test("Today tab is the default and shows the spending hero", async ({ page }) => {
    await expect(page.getByText("LEFT TODAY")).toBeVisible();
    await expect(page.getByText("MONTH POOL")).toBeVisible();
  });

  test("Spending tab shows the monthly summary", async ({ page }) => {
    await page.locator(".nav-btn", { hasText: "Spending" }).first().click();
    // The summary card has Pool / Spent / Left labels
    await expect(page.getByText("Pool", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Spent", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Left", { exact: true }).first()).toBeVisible();
  });

  test("Bills tab shows the recurring-expense form", async ({ page }) => {
    await page.locator(".nav-btn", { hasText: "Bills" }).first().click();
    await expect(page.getByText(/Recurring expenses/i).first()).toBeVisible();
    await expect(page.getByText(/Add recurring expense/i)).toBeVisible();
  });

  test("Household tab shows the household header", async ({ page }) => {
    await page.locator(".nav-btn", { hasText: "Household" }).first().click();
    await expect(page.getByText(/combined view/i)).toBeVisible();
  });

  test("Advisor tab shows the chat shell", async ({ page }) => {
    await page.locator(".nav-btn", { hasText: "Advisor" }).first().click();
    await expect(page.getByText("DayFlow Advisor")).toBeVisible();
    await expect(page.getByText(/Online — ask me anything/i)).toBeVisible();
  });

  test("More menu toggles open/closed and exposes its items", async ({ page }) => {
    await page.locator(".nav-btn", { hasText: "More" }).click();
    await expect(page.getByText(/Bank connections/i)).toBeVisible();
    await expect(page.getByText(/Financial Education/i)).toBeVisible();
    await expect(page.getByText(/^Setup$/)).toBeVisible();

    // Tap backdrop to close
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await expect(page.getByText(/Bank connections/i)).toBeHidden();
  });

  test("More → Financial Education shows learn sections", async ({ page }) => {
    await page.locator(".nav-btn", { hasText: "More" }).click();
    await page.getByText(/Financial Education/i).click();
    // Education sections render emojis/titles. Look for any expand toggle.
    const plusToggles = page.getByRole("button").filter({ hasText: "+" });
    await expect(plusToggles.first()).toBeVisible();
  });

  test("More → Setup shows the setup screen", async ({ page }) => {
    await page.locator(".nav-btn", { hasText: "More" }).click();
    await page.getByText(/^Setup$/).click();
    // Setup screen mentions Income.
    await expect(page.getByText(/Income/i).first()).toBeVisible();
  });

  test("More → Bank connections opens the bank tab", async ({ page }) => {
    await page.locator(".nav-btn", { hasText: "More" }).click();
    await page.getByText(/Bank connections/i).click();
    await expect(page.getByText(/Connect your bank/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /Connect with Plaid/i })).toBeVisible();
  });
});
