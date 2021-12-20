import { Page } from "puppeteer";

export async function fillTextInput(
  page: Page,
  selector: string,
  text: string
) {
  await page.focus(selector);
  await page.keyboard.type(text);
}
