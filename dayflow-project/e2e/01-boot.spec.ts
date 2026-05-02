import { test, expect } from "@playwright/test";

test.describe("Boot & splash", () => {
  test("renders splash and proceeds to auth screen", async ({ page }) => {
    await page.goto("/");

    // Splash shows the wordmark "day" + "flow"
    await expect(page.locator('text=Your daily money, simplified')).toBeVisible({ timeout: 5_000 });

    // Auth screen eventually appears (splash auto-dismisses ~2.2s)
    await expect(
      page.getByRole("button", { name: /Continue with Google/i })
    ).toBeVisible({ timeout: 10_000 });
  });

  test("auth screen exposes login, signup, forgot, and guest paths", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible({ timeout: 10_000 });

    await expect(page.getByPlaceholder(/Email address/i)).toBeVisible();
    await expect(page.getByPlaceholder(/Password/i)).toBeVisible();

    // Sign-up swap
    await page.getByRole("button", { name: /New here\? Sign up/i }).click();
    await expect(page.getByText(/Create your account/i)).toBeVisible();
    await page.getByRole("button", { name: /Already have an account/i }).click();
    await expect(page.getByText(/Welcome back/i)).toBeVisible();

    // Forgot password
    await page.getByRole("button", { name: /Forgot password/i }).click();
    await expect(page.getByRole("button", { name: /Send reset email/i })).toBeVisible();
    await page.getByRole("button", { name: /Back to login/i }).click();
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible();

    // Guest path is offered
    await expect(page.getByRole("button", { name: /Explore without an account/i })).toBeVisible();
  });

  test("login form validates empty submit", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /^Sign in$/ }).click();
    await expect(page.getByText(/Please fill in all fields/i)).toBeVisible();
  });

  test("signup form rejects short passwords", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("button", { name: /Continue with Google/i })).toBeVisible({ timeout: 10_000 });
    await page.getByRole("button", { name: /New here\? Sign up/i }).click();
    await page.getByPlaceholder(/Email address/i).fill("user@example.com");
    await page.getByPlaceholder(/Password/i).fill("123");
    await page.getByRole("button", { name: /Create account/i }).click();
    await expect(page.getByText(/at least 6 characters/i)).toBeVisible();
  });
});
