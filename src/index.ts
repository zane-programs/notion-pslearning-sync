import puppeteer from "puppeteer";
import { config as dotenvConfig } from "dotenv";

// logging
import logger from "./utils/logger";

// utils
import { runLearningGoogleLogin } from "./utils/browser/google";
import { getClasses, waitForLearningPortal } from "./utils/browser/learning";

// get env variables from .env
dotenvConfig();

(async function main() {
  try {
    // create puppeteer browser
    const browser = await puppeteer.launch({ headless: false });

    // sign in with google, then save the resulting
    // page (redirects to Learning Portal at the end)
    const learningPage = await runLearningGoogleLogin(browser);

    // wait for Learning portal to load
    await waitForLearningPortal(learningPage);

    // get classes from portal
    const classes = await getClasses(learningPage);

    // spit it out into console (this is temporary)
    logger.info("Class IDs: " + JSON.stringify(classes, null, 2));
  } catch (e) {
    // log error and end process
    logger.error(e?.message || e || "Unknown error");
    // TODO: make error exit codes more specific (?)
    process.exit(1);
  }
})();
