import { Page } from "puppeteer";

// logging
import logger from "../logger";

export async function waitForLearningPortal(page: Page) {
  // wait for /u/{username}/portal by splitting & comparing
  await page.waitForFunction(
    `window.location.pathname.split("/")[3] === "portal"`
  );
  logger.debug("Learning portal ready");
}

export async function getClasses(page: Page) {
  const classes = await page.evaluate(async () => {
    function extractClassesFromPortal() {
      return new Promise(
        (resolve: (arr: number[]) => void, reject: (error: Error) => void) => {
          document.addEventListener("DOMContentLoaded", () => {
            const portalData = (window as any).PortalData;

            // make sure that portal data is loaded
            // if it's not, reject with an error
            if (!portalData) {
              reject(
                new Error(
                  "PortalData variable missing from page; we might not be on the portal page"
                )
              );
            }

            // cast class IDs array as number[] and return
            resolve(portalData.currentClasses as number[]);
          });
        }
      );
    }

    // run extraction function above
    return await extractClassesFromPortal();
  });

  return classes;
}
