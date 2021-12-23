import { Page } from "puppeteer";
import { stringify as convertToQueryString } from "qs";
import {
  format as formatDate,
  isValid as isValidDate,
  parse as parseDate,
} from "date-fns";
import {
  load as cheerioLoad,
  Element as CheerioElement,
  CheerioAPI,
} from "cheerio";

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

export async function getAssignmentsForWeek(
  page: Page,
  csrfToken: string,
  username: string, // can be gotten from await getUserInfo(page).login
  classes: number[], // array of class IDs (use getClasses method to obtain if you need them)
  startDate?: Date // optionally, a start date for assignments
) {
  let bodyJson: { id: string; csrf_token: string; start_date?: string } = {
    id: classes.join(" "), // class IDs (can be found using getClasses)
    csrf_token: csrfToken, // CSRF token (can be found using getCSRFToken)
  };

  // add formatted start date if applicable
  if (startDate) {
    bodyJson.start_date = formatDate(startDate, "yyyy-MM-dd HH:mm:ss");
  }

  const requestBody: string = convertToQueryString(bodyJson);

  const assignmentsHtml = await page.evaluate(
    async (requestBody, learningUrlBase, username) => {
      // make sure we're on a valid page for making requests
      if (
        window.location.protocol + "//" + window.location.hostname !==
        learningUrlBase
      ) {
        throw new Error(
          "Cannot fetch assignments - not on a proper Learning page"
        );
      }

      // fetch from API
      const req = await fetch(`/u/${username}/portal/portlet_calendar_week`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
          "x-requested-with": "XMLHttpRequest",
        },
        body: requestBody,
      });

      const res = await req.text();

      // returning raw HTML for now
      return res;
    },
    requestBody,
    process.env.LEARNING_URL_BASE,
    username
  );

  return _parseWeekAssignmentsResponse(assignmentsHtml);
}

// CSRF tokens are necessary for making API requests
export async function getCSRFToken(page: Page) {
  const csrfToken: string = await page.evaluate(async (learningUrlBase) => {
    const token = (window as any).CSRFTOK;

    // make sure we're on a valid page for making requests
    if (
      window.location.protocol + "//" + window.location.hostname !==
        learningUrlBase || // page is not on proper learning host
      !token // csrf token missing
    ) {
      throw new Error(
        "Cannot fetch CSRF token - not on a proper Learning page with token"
      );
    }

    return token;
  }, process.env.LEARNING_URL_BASE);

  // for debugging
  logger.debug("Got CSRF token: " + csrfToken);

  return csrfToken;
}

// User information (also necessary for making some API requests)
export async function getUserInfo(page: Page): Promise<{
  last_name: string;
  first_name: string;
  import_id: string;
  login: string; // Learning username
  source_system_id: string;
}> {
  const userInfo = await page.evaluate(async (learningUrlBase) => {
    const haikuContext = (window as any).HaikuContext;

    // make sure we're on a valid page for making requests
    if (
      window.location.protocol + "//" + window.location.hostname !==
        learningUrlBase || // page is not on proper learning host
      !haikuContext?.user // user info missing
    ) {
      throw new Error(
        "Cannot fetch user info - not on a proper Learning page with HaikuContext.user"
      );
    }

    return haikuContext.user;
  }, process.env.LEARNING_URL_BASE);

  return userInfo;
}

function _parseWeekAssignmentsResponse(html: string): WeekAssignmentInfo[] {
  // load html into parser
  const $ = cheerioLoad(html);

  if (
    // there is at least one
    $(".empty_column").length > 0 &&
    // safeguard (has "You have nothing between" text)
    $(".empty_column").first().text().indexOf("You have nothing between") !== -1
  ) {
    // no assignments, so return an empty array
    return [];
  }

  // convert html tags into json via cheerio map
  const parsedAssignments = $(".calendar_day").map(_handleMapCalendarDay($));

  // convert cheerio map to array
  return parsedAssignments.toArray();
}

function _handleMapCalendarDay($: CheerioAPI) {
  // returns function using the $ (Cheerio) API provided above
  return function (this: CheerioElement) {
    const linkElements = $(this).find(".item_description a");

    // e.g. 2022-01-07
    const dayString = $(this)
      .attr("id")
      .replace("portlet_calendar_agenda_", "");

    // get assignment details from each link via map
    const assignments = linkElements.map(_handleMapLinkElements($, dayString));

    return assignments.toArray();
  };
}

function _handleMapLinkElements($: CheerioAPI, dayString: string) {
  return function (this: CheerioElement) {
    // e.g. 11:59pm
    const timeString = $(this)
      .parent()
      .find(".item_description span.b.detail.small")
      .text();

    const link = $(this).attr("href"); // e.g. /zneufeld/apmusictheoryzach21-22/assignment/view/28692071
    const name = $(this).attr("title"); // e.g. TEST 4
    // e.g. 2022-01-07 11:59pm (parsed as a Date object)

    // get due date from given info
    // TODO: cleanup!
    const dueDateString = dayString + " " + timeString;
    let dueDate = parseDate(dueDateString, "yyyy-MM-dd hh:mmaa", new Date());
    // if date is invalid, try the other format
    if (!isValidDate(dueDate)) {
      dueDate = parseDate(dueDateString, "yyyy-MM-dd hhaa", new Date());
      // check again -- if it could not be parsed, throw an error
      if (!isValidDate(dueDate)) {
        throw new Error(
          "Assignment due date could not be parsed according to either format"
        );
      }
    }

    return {
      name,
      link,
      dueDate,
    } as WeekAssignmentInfo;
  };
}

// type for Learning assignments from /u/{username}/portal/portlet_calendar_week
export interface WeekAssignmentInfo {
  name: string; // assignment name
  link: string; // assignment link
  dueDate: Date; // when assignment is due
}
