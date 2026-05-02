import { Page, expect } from "@playwright/test";

/**
 * Skip the splash screen and enter guest mode so the main app is visible.
 *
 * Splash auto-dismisses after ~2.2s; auth screen requires choosing
 * "Explore without an account" since Supabase isn't configured in CI.
 */
export async function enterGuestMode(page: Page) {
  await page.goto("/");

  // Splash → wait for the auth screen to appear
  const guestBtn = page.getByRole("button", { name: /Explore without an account/i });
  await expect(guestBtn).toBeVisible({ timeout: 10_000 });
  await guestBtn.click();

  // Guest banner indicates we're in.
  await expect(
    page.getByText(/exploring in guest mode/i)
  ).toBeVisible();
}

/** Click a bottom-nav tab by its visible label. */
export async function gotoTab(page: Page, label: "Today" | "Spending" | "Bills" | "Household" | "Advisor" | "More") {
  // Bottom nav buttons render the label inside .nav-lbl
  const btn = page.locator(".nav-btn", { hasText: label });
  await btn.first().click();
}

/** Stub Supabase auth + REST so the auth listener resolves cleanly without network. */
export async function stubSupabase(page: Page) {
  await page.route("**/auth/v1/**", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) })
  );
  await page.route("**/rest/v1/**", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" })
  );
}
