import { test, expect, type Page } from "@playwright/test";

const BUILTIN_TABS = ["Example 1", "Example 2", "Example 3", "Add 9"];

/** Runs `input` through the active machine and jumps playback to the final step — "Run" alone
 *  only computes the trace and leaves playback at "before any steps" (see InputRunner.tsx). */
async function runToEnd(page: Page, input: string) {
  await page.locator(".input-runner__input").fill(input);
  await page.getByRole("button", { name: "Run", exact: true }).click();
  const slider = page.locator(".input-runner__slider");
  await slider.focus();
  await slider.press("End");
}

function varsRow(page: Page, key: string) {
  return page.locator(".state-inspector__vars tr", { has: page.locator("th", { hasText: key }) });
}

test.describe("smoke: every built-in example loads and compiles cleanly", () => {
  for (const name of BUILTIN_TABS) {
    test(`"${name}" tab has no compile or type errors`, async ({ page }) => {
      await page.goto("/");
      await page.getByRole("tab", { name }).click();
      await expect(page.locator(".cm-content")).not.toBeEmpty();
      await expect(page.locator(".ts-editor__errors")).toHaveCount(0);
      await expect(page.locator(".state-inspector")).not.toContainText("No machine loaded");
    });
  }
});

test("CSV regression: Example 3 still parses quoted, comma-containing fields correctly", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Example 3" }).click();
  await runToEnd(page, 'a,"b,c"\nd');
  await expect(varsRow(page, "rows")).toContainText('[["a","b,c"],["d"]]');
  await expect(varsRow(page, "field")).toContainText('""');
});

test("numerics regression: Add 9 example produces the correct sum", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Add 9" }).click();
  await runToEnd(page, "0");
  await expect(varsRow(page, "sum")).toContainText('"9"');
});

test("playback controls: step forward/back move through a run", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("tab", { name: "Example 1" }).click();
  await page.locator(".input-runner__input").fill("a,b");
  await page.getByRole("button", { name: "Run", exact: true }).click();

  // "a,b" is 3 characters plus one synthetic end-of-input event = 4 steps (see simulate.ts).
  const stepCount = page.locator(".input-runner__step-count");
  await expect(stepCount).toHaveText("0 / 4");

  const next = page.getByRole("button", { name: "Next step" });
  const prev = page.getByRole("button", { name: "Previous step" });

  await next.click();
  await expect(stepCount).toHaveText("1 / 4");
  await expect(page.locator(".state-inspector__facts")).toContainText("'a'");

  await next.click();
  await next.click();
  await next.click();
  await expect(stepCount).toHaveText("4 / 4");
  await expect(next).toBeDisabled();

  await prev.click();
  await expect(stepCount).toHaveText("3 / 4");
});
