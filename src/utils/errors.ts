export function checkEnvironmentVariableExistences(...variableNames: string[]) {
  let missingNames: string[] = [];

  // check for env variables and add names of missing vars to missingNames
  for (const name of variableNames) {
    if (!process.env[name]) missingNames.push(name);
  }

  // if any were missing, throw an error
  if (missingNames.length > 0) {
    throw new Error(
      "Missing environment variables: " + missingNames.join(", ")
    );
  }
}
