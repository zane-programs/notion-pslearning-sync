import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { config as dotenvConfig } from "dotenv";

// logging
import logger from "./utils/logger";

// utils
import { runLearningGoogleLogin } from "./utils/browser/google";
import {
  getAssignmentsForWeek,
  getClasses,
  getCSRFToken,
  getUserInfo,
  waitForLearningPortal,
} from "./utils/browser/learning";

// get env variables from .env
dotenvConfig();

// add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());

// are we in development? true or false
const isDev = process.env.NODE_ENV === "development";

(async function main() {
  try {
    // create puppeteer browser
    const browser = await puppeteer.launch({
      headless: !isDev,
      devtools: isDev,
    });

    // sign in with google, then save the resulting
    // page (redirects to Learning Portal at the end)
    const learningPage = await runLearningGoogleLogin(browser);

    // wait for Learning portal to load
    await waitForLearningPortal(learningPage);

    // get classes from portal
    const classes = await getClasses(learningPage);

    // spit it out into console (this is temporary)
    logger.info("Class IDs: " + JSON.stringify(classes, null, 2));

    const csrfToken = await getCSRFToken(learningPage); // csrf token for api requests
    const userInfo = await getUserInfo(learningPage); // user info, also for api requests

    logger.info(
      "ASSIGNMENTS NOW\n" +
        JSON.stringify(
          await getAssignmentsForWeek(
            learningPage,
            csrfToken,
            userInfo.login,
            classes
          ),
          null,
          2
        )
    );

    logger.info(
      "ASSIGNMENTS DEC 11 2021 \n\n" +
        JSON.stringify(
          await getAssignmentsForWeek(
            learningPage,
            csrfToken,
            userInfo.login,
            classes,
            new Date("December 11, 2021")
          ),
          null,
          2
        )
    );

    // in production, close browser once information is retrieved
    if (process.env.NODE_ENV !== "development") {
      await browser.close();
    }
  } catch (e) {
    // log error and end process
    logger.error(e?.message || e || "Unknown error");
    // TODO: make error exit codes more specific (?)
    process.exit(1);
  }
})();
