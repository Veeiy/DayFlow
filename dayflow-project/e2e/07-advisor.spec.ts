import { test, expect } from "@playwright/test";
import { enterGuestMode } from "./helpers";

test.describe("AI Advisor tab", () => {
  test.beforeEach(async ({ page }) => {
    // Stub the Anthropic streaming endpoint so the UI gets a deterministic reply.
    await page.route(/api\.anthropic\.com\/v1\/messages/, async route => {
      const body =
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello "}}\n\n' +
        'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"world"}}\n\n' +
        "data: [DONE]\n\n";
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    });

    await enterGuestMode(page);
    await page.locator(".nav-btn", { hasText: "Advisor" }).first().click();
  });

  test("renders the advisor chat shell", async ({ page }) => {
    await expect(page.getByText("DayFlow Advisor")).toBeVisible();
    await expect(page.getByText(/Online — ask me anything/i)).toBeVisible();
  });

  test("suggested categories are present", async ({ page }) => {
    for (const cat of [/My Money/i, /401k/i, /IRA/i, /Investing/i, /Debt/i, /Taxes/i]) {
      await expect(page.getByText(cat).first()).toBeVisible();
    }
  });

  test("category chips switch the suggested questions list", async ({ page }) => {
    await page.getByText(/401k/i).first().click();
    await expect(page.getByText(/How does a 401k work/i)).toBeVisible();

    await page.getByText(/IRA/i).first().click();
    await expect(page.getByText(/What is a Roth IRA/i)).toBeVisible();
  });

  test("typing a message and pressing Enter streams the stubbed reply", async ({ page }) => {
    const inputBox = page.getByPlaceholder(/Ask anything/i);
    await expect(inputBox).toBeVisible();
    await inputBox.fill("Hi");
    await inputBox.press("Enter");

    await expect(page.getByText("Hello world")).toBeVisible({ timeout: 10_000 });
  });
});
