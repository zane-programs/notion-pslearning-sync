import puppeteer from "puppeteer-extra";
import { Client } from "@notionhq/client";
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
  getFullAssignmentInfo,
  getUserInfo,
  waitForLearningPortal,
} from "./utils/browser/learning";
import { writeAssignmentsToNotion } from "./utils/notion";

// get env variables from .env
dotenvConfig();

// add stealth plugin to puppeteer
puppeteer.use(StealthPlugin());

// are we in development? true or false
const isDev = process.env.NODE_ENV === "development";

(async function main() {
  try {
    // init notion client
    const notion = new Client({ auth: process.env.NOTION_TOKEN });

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

    const dec11Assignments = await getAssignmentsForWeek(
      learningPage,
      csrfToken,
      userInfo.login,
      classes
      // new Date("December 11, 2021")
    );

    const dec11AssignmentsFull = await Promise.all(
      dec11Assignments.map(async (assignmentInfo) =>
        getFullAssignmentInfo(learningPage, assignmentInfo)
      )
    );

    logger.info(
      "DEC 11 FULL\n" + JSON.stringify(dec11AssignmentsFull, null, 2)
    );

    // close browser once work is done
      await browser.close();

    // write to notion
    await writeAssignmentsToNotion(notion, dec11AssignmentsFull);
  } catch (e) {
    // log error and end process
    // TEMPORARILY replacing winston w/ console.error here
    // logger.error(e?.message || e || "Unknown error");
    console.error(e);
    // TODO: make error exit codes more specific (?)
    process.exit(1);
  }
})();
