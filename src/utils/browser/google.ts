import { Browser, Page } from "puppeteer";

// logging
import logger from "../logger";

// utils
import { checkEnvironmentVariableExistences } from "../errors";
import { fillTextInput } from "./shared";

export async function runLearningGoogleLogin(browser: Browser) {
  // check that the following env variables are set
  checkEnvironmentVariableExistences(
    "LEARNING_URL_BASE",
    "GOOGLE_EMAIL",
    "GOOGLE_PASSWORD"
  );

  // create page in browser
  const loginPage = await browser.newPage();

  // initialize google login with powerschool
  const organizationDomainInfo = process.env.GOOGLE_ORGANIZATION_DOMAIN
    ? "?google_domain=" + process.env.GOOGLE_ORGANIZATION_DOMAIN
    : "";
  const googleBeginUrl =
    process.env.LEARNING_URL_BASE +
    "/do/authentication/google/google_begin" +
    organizationDomainInfo;
  logger.debug("Google Begin URL: " + googleBeginUrl);

  // go to login page
  await loginPage.goto(googleBeginUrl);

  // check for accounts.google.com login page
  const currentUrl = await loginPage.url();
  if (new URL(currentUrl).hostname !== "accounts.google.com") {
    throw new Error("Google Begin URL did not redirect to Google Login");
  }

  // type in email
  await fillTextInput(
    loginPage,
    `input[type="email"]`,
    process.env.GOOGLE_EMAIL
  );
  logger.debug("Typed in email: " + process.env.GOOGLE_EMAIL);

  // click "next" button
  await _clickGoogleLoginNextButton(loginPage);

  // wait for password page to appear
  await loginPage.waitForNavigation();

  // wait for password input to appear
  await loginPage.waitForSelector(`input[type="password"]`, { visible: true });
  logger.debug("Found password input");

  // type in password
  await fillTextInput(
    loginPage,
    `input[type="password"]`,
    process.env.GOOGLE_PASSWORD
  );
  logger.debug("Typed in password");

  // click "next" button for the last time
  await _clickGoogleLoginNextButton(loginPage);

  // wait for learning portal to load
  await loginPage.waitForFunction(
    `(window.location.protocol + "//" + window.location.hostname) === "${process.env.LEARNING_URL_BASE}"`
  );
  logger.debug("Logged in successfully!");

  // return authed portal page for use by other utilities
  return loginPage;
}

async function _clickGoogleLoginNextButton(page: Page) {
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button"))
      .find((button) => button.innerText === "Next")
      .click();
  });
  logger.debug(`Clicked "next" button`);
}
