import { Client } from "@notionhq/client";
import { formatISO } from "date-fns";
import { convert as convertHtmlToText } from "html-to-text";

// types
import { FullAssignmentInfo } from "./browser/learning";
// import {
//   CreatePageParameters,
//   UpdatePageParameters,
// } from "@notionhq/client/build/src/api-endpoints";
// type NotionCreatePagePropertiesType = CreatePageParameters["properties"];
// type NotionUpdatePagePropertiesType = UpdatePageParameters["properties"];

// util
import { checkEnvironmentVariableExistences } from "./errors";
import logger from "./logger";

export async function writeAssignmentsToNotion(
  notion: Client,
  assignments: FullAssignmentInfo[]
) {
  // make sure NOTION_CALENDAR_DATABASE_ID env variable is set
  checkEnvironmentVariableExistences("NOTION_CALENDAR_DATABASE_ID");

  // get database content
  const dbContent = await notion.databases.query({
    database_id: process.env.NOTION_CALENDAR_DATABASE_ID,
  });

  // get some info for assignments that already exist in notion
  const existingAssignmentInfo: PageIdAndAssignmentLink[] =
    dbContent.results.map((item) => ({
      pageId: item.id,
      assignmentLink: _getFullPathFromUrl(
        (item as any).properties.Link.rich_text[0].href
      ),
    }));

  // sort assignments by create and update
  const { assignmentsToCreate, assignmentsToUpdate } = _processAssignmentInfo(
    assignments,
    existingAssignmentInfo
  );

  await _createAndUpdateAssignments(
    notion,
    assignmentsToCreate,
    assignmentsToUpdate
  );
}

async function _createAndUpdateAssignments(
  notion: Client,
  assignmentsToCreate: NotionAssignmentOperation[],
  assignmentsToUpdate: NotionAssignmentOperation[]
) {
  // get list of current class name tags (we'll add here later)
  let classTags = await _getClassTags(notion);

  // create and update assignments
  await Promise.all([
    ...assignmentsToCreate.map(async ({ assignment }) => {
      const page = await _createAssignment(notion, assignment, classTags);
      const pageTag = (page as any).properties.Class.multi_select[0];

      // add tag for this page to the list if it's not already there
      if (!classTags.find((tag) => tag.id === pageTag.id)) {
        classTags.push(pageTag);
      }
    }),
    ...assignmentsToUpdate.map(async ({ assignment, pageId }) => {
      const page = await _updateAssignment(
        notion,
        pageId,
        assignment,
        classTags
      );
      const pageTag = (page as any).properties.Class.multi_select[0];

      // add tag for this page to the list if it's not already there
      if (!classTags.find((tag) => tag.id === pageTag.id)) {
        classTags.push(pageTag);
      }
    }),
  ]);
}

async function _createAssignment(
  notion: Client,
  assignment: FullAssignmentInfo,
  classTags: any[] // TODO: specify type
) {
  logger.debug(`Creating assignment "${assignment.name}" (${assignment.link})`);

  // create page in notion calendar database with properties and children
  const page = await notion.pages.create({
    parent: { database_id: process.env.NOTION_CALENDAR_DATABASE_ID },
    properties: _generatePropertiesFromAssignmentInfo(assignment, classTags),
    children: [
      {
        paragraph: _formatAssignmentDescriptionForNotion(
          assignment.description
        ),
      },
    ],
  });

  logger.debug(`Created assignment "${assignment.name}" (${assignment.link})`);

  return page;
}

async function _updateAssignment(
  notion: Client,
  pageId: string,
  assignment: FullAssignmentInfo,
  classTags: any[]
) {
  logger.debug(`Updating assignment "${assignment.name}" (${assignment.link})`);

  // update page in notion calendar database (using given pageId)
  const page = await notion.pages.update({
    page_id: pageId,
    properties: _generatePropertiesFromAssignmentInfo(assignment, classTags),
  });

  // get block id for description
  const descriptionBlockId = (
    await notion.blocks.children.list({ block_id: pageId })
  ).results[0].id;

  // update description
  await notion.blocks.update({
    block_id: descriptionBlockId,
    paragraph: _formatAssignmentDescriptionForNotion(assignment.description),
  });

  logger.debug(`Updated assignment "${assignment.name}" (${assignment.link})`);

  return page;
}

async function _getClassTags(notion: Client) {
  // get calendar database
  const db = await notion.databases.retrieve({
    database_id: process.env.NOTION_CALENDAR_DATABASE_ID,
  });

  // validate field type
  if (db.properties?.Class.type !== "multi_select")
    throw new Error("Class property type is not multi_select");

  // return multi-select options
  return db.properties.Class.multi_select.options;
}

// TODO: fix notion typing to replace "any" return type
function _generatePropertiesFromAssignmentInfo(
  assignment: FullAssignmentInfo,
  classTags: any[]
): any {
  const fullAssignmentLink = process.env.LEARNING_URL_BASE + assignment.link;
  const assignmentSections = assignment.sections || "";

  // find tag for class if available
  const classTag = classTags.find((tag) => tag.name === assignment.className);

  return {
    // title of document
    Name: {
      title: _generateBasicRichTextInfo(assignment.name, fullAssignmentLink),
    },
    // link to assignment
    Link: {
      type: "rich_text",
      rich_text: _generateBasicRichTextInfo(
        fullAssignmentLink,
        fullAssignmentLink
      ),
    },
    // due date
    Due: {
      type: "date",
      date: _generateBasicDateInfo(assignment.dueDate),
    },
    // tag representing the name of the class
    Class: {
      type: "multi_select",
      multi_select: [
        {
          name: assignment.className,
          color: classTag?.color || "default",
        },
      ],
    },
    // total number of points for assignment
    Points: {
      type: "number",
      number: assignment?.totalPoints || null,
    },
    // sections assigned to this assignment
    Sections: {
      type: "rich_text",
      rich_text: _generateBasicRichTextInfo(assignmentSections),
    },
  };
}

function _generateBasicRichTextInfo(text: string, link?: string): any {
  return [
    {
      text: {
        content: text,
        link: link ? { url: link } : null,
      },
      // annotations: {
      //   bold: false,
      //   italic: false,
      //   strikethrough: false,
      //   underline: false,
      //   code: false,
      //   color: "default",
      // },
      plain_text: text,
      href: link || null,
    },
  ];
}

function _generateBasicDateInfo(startDate: Date, endDate?: Date) {
  return {
    start: formatISO(startDate),
    end: endDate ? formatISO(endDate) : null,
    time_zone: null, // TODO: think about adding timezone?
  };
}

function _formatAssignmentDescriptionForNotion(descriptionHtml: string): any {
  return {
    text: [
      {
        type: "text",
        text: {
          content: convertHtmlToText(descriptionHtml),
        },
      },
    ],
  };
}

function _getFullPathFromUrl(url: string) {
  const parsed = new URL(url);
  return parsed.pathname + parsed.search + parsed.hash;
}

function _processAssignmentInfo(
  assignments: FullAssignmentInfo[],
  existingAssignmentInfo: PageIdAndAssignmentLink[]
) {
  let assignmentsToCreate: NotionAssignmentOperation[] = [];
  let assignmentsToUpdate: NotionAssignmentOperation[] = [];

  const existingAssignmentLinks = existingAssignmentInfo.map(
    (item) => item.assignmentLink
  );

  for (const assignment of assignments) {
    if (existingAssignmentLinks.indexOf(assignment.link) === -1) {
      // assignment does not exist - create it
      assignmentsToCreate.push({ assignment });
    } else {
      // assignment exists - update it
      assignmentsToUpdate.push({
        assignment,
        pageId: existingAssignmentInfo.find(
          (item) => item.assignmentLink === assignment.link
        ).pageId,
      });
    }
  }

  logger.debug(
    "Assignments to create:\n" + JSON.stringify(assignmentsToCreate, null, 2)
  );
  logger.debug(
    "Assignments to update:\n" + JSON.stringify(assignmentsToUpdate, null, 2)
  );

  return { assignmentsToCreate, assignmentsToUpdate };
}

interface PageIdAndAssignmentLink {
  pageId: string;
  assignmentLink: string;
}

interface NotionAssignmentOperation {
  assignment: FullAssignmentInfo;
  pageId?: string;
}
