import puppeteer from "puppeteer";
import { config as dotenvConfig } from "dotenv";

import { runLearningGoogleLogin } from "./utils/browser/google";
import logger from "./utils/logger";

// get env variables from .env
dotenvConfig();

(async function main() {
  try {
    // create puppeteer browser
    const browser = await puppeteer.launch({ headless: false });

    // open login page
    await runLearningGoogleLogin(browser);
  } catch (e) {
    // log error and end process
    logger.error(e?.message || e || "Unknown error");
    // TODO: make error exit codes more specific (?)
    process.exit(1);
  }
})();
