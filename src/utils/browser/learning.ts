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
    async (requestBody: string, learningUrlBase: string, username: string) => {
      // make sure we're on a valid page for making requests
      if (window.location.origin !== learningUrlBase) {
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

      // returning raw HTML for now
      return await req.text();
    },
    requestBody,
    process.env.LEARNING_URL_BASE,
    username
  );

  return _parseWeekAssignmentsResponse(assignmentsHtml);
}

// CSRF tokens are necessary for making API requests
export async function getCSRFToken(page: Page) {
  const csrfToken: string = await page.evaluate(
    async (learningUrlBase: string) => {
      const token = (window as any).CSRFTOK;

      // make sure we're on a valid page for making requests
      if (
        window.location.origin !== learningUrlBase || // page is not on proper learning host
        !token // csrf token missing
      ) {
        throw new Error(
          "Cannot fetch CSRF token - not on a proper Learning page with token"
        );
      }

      return token;
    },
    process.env.LEARNING_URL_BASE
  );

  // for debugging
  logger.debug("Got CSRF token: " + csrfToken);

  return csrfToken;
}

export async function getFullAssignmentInfo(
  page: Page,
  portalAssignmentInfo: PortalAssignmentInfo
) {
  const fullAssignmentHtml = await page.evaluate(
    async (learningUrlBase: string, assignmentInfo: PortalAssignmentInfo) => {
      // make sure we're on a Learning page for requests
      if (window.location.origin !== learningUrlBase) {
        throw new Error(
          "Cannot fetch assignment - not on a proper Learning page"
        );
      }

      const req = await fetch(assignmentInfo.link, {
        method: "GET",
        headers: {
          "x-requested-with": "XMLHttpRequest",
        },
      });

      // returns plain html
      return await req.text();
    },
    process.env.LEARNING_URL_BASE,
    portalAssignmentInfo as any // wouldn't accept PortalAssignmentInfo type, so had to cast to any
  );

  // load html into cheerio for parsing
  const $ = cheerioLoad(fullAssignmentHtml);

  // find element of the specific info table
  const tableElement = $(`td.label.right:contains("Posted:")`).parents("table");

  // total points element (used later)
  const totalPointsText = tableElement
    .find(`td.label.right:contains("Total Points:")`)
    .siblings("td")
    .text();

  // sections (class sections, string)
  const sectionsElement = tableElement
    .find(`td.label.right:contains("Sections:")`)
    .siblings("td"); // save for later use
  const sections = sectionsElement.text();

  // description
  const descriptionElement = tableElement.find("tr").last().prev().find("td"); // found in second to last row
  const description = descriptionElement.html(); // full html of description

  // combine new info with portalAssignmentInfo
  // and cast it all as FullAssignmentInfo
  return {
    ...portalAssignmentInfo,
    description,
    ...(sections && { sections }), // add sections if present
    ...(totalPointsText && { totalPoints: parseFloat(totalPointsText) }), // add total points if present
  } as FullAssignmentInfo;
}

// User information (also necessary for making some API requests)
export async function getUserInfo(page: Page): Promise<{
  last_name: string;
  first_name: string;
  import_id: string;
  login: string; // Learning username
  source_system_id: string;
}> {
  const userInfo = await page.evaluate(async (learningUrlBase: string) => {
    const haikuContext = (window as any).HaikuContext;

    // make sure we're on a valid page for making requests
    if (
      window.location.origin !== learningUrlBase || // page is not on proper learning host
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

function _parseWeekAssignmentsResponse(html: string): PortalAssignmentInfo[] {
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
    const listItemElements = $(this).find(".list_item");

    // e.g. 2022-01-07
    const dayString = $(this)
      .attr("id")
      .replace("portlet_calendar_agenda_", "");

    // get assignment details from each link via map
    const assignments = listItemElements.map(
      _handleMapListItemElements($, dayString)
    );

    return assignments.toArray();
  };
}

function _handleMapListItemElements($: CheerioAPI, dayString: string) {
  return function (this: CheerioElement) {
    // e.g. 11:59pm
    const timeString = $(this)
      .find(".item_description span.b.detail.small")
      .text();

    // name of the class that the assignment is for
    const className = $(this).find(".left a.filter").attr("atitle");

    // element containing assignment link
    const linkElement = $(this).find(".item_description a");

    const link = linkElement.attr("href"); // e.g. /zneufeld/apmusictheoryzach21-22/assignment/view/28692071
    const name = linkElement.attr("title"); // e.g. TEST 4
    // e.g. 2022-01-07 11:59pm (parsed as a Date object)

    // get due date from dayString and timeString
    const dueDate = _parseDueDate(dayString, timeString);

    return {
      name,
      className,
      link,
      dueDate,
    } as PortalAssignmentInfo;
  };
}

function _parseDueDate(dayString: string, timeString: string) {
  // concatenate dayString and timeString for parsing
  const dueDateString = dayString + " " + timeString;

  // try parsing with first format
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

  return dueDate;
}

// type for Learning assignments from /u/{username}/portal/portlet_calendar_week
export interface PortalAssignmentInfo {
  name: string; // assignment name
  className: string; // name of the class that the assignment is for
  link: string; // assignment link
  dueDate: Date; // when assignment is due
}

export interface FullAssignmentInfo extends PortalAssignmentInfo {
  description: string; // html of assignment (e.g. "<p>Description here</p>")
  sections?: string; //    class sections assigned (e.g. "All")
  totalPoints?: number; // total number of points (e.g. 100)
}
