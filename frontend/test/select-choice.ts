import type { Locator } from "@playwright/test";

export async function selectChoice(control: Locator, value: string) {
  await control.click();
  await control.locator("..").locator(`[role="option"][data-value=${JSON.stringify(value)}]`).click();
}
