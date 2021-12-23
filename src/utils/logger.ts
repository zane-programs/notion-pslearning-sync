import { createLogger, format, transports } from "winston";

const { combine, timestamp, prettyPrint, colorize, errors } = format;

const logger = createLogger({
  level: process.env.NODE_ENV === "development" ? "debug" : "info",
  // format: format.json(),
  format: combine(
    errors({ stack: true }), // <-- use errors format
    colorize(),
    timestamp(),
    prettyPrint(),
  ),
  // defaultMeta: { service: "user-service" },
  transports: [
    // (not logging to files for the moment)
    // - Write all logs with level `error` and below to `error.log`
    // - Write all logs with level `info` and below to `combined.log`
    //
    // new winston.transports.File({ filename: "error.log", level: "error" }),
    // new winston.transports.File({ filename: "combined.log" }),
  ],
});

//
// If we're not in production then log to the `console` with the format:
// `${info.level}: ${info.message} JSON.stringify({ ...rest }) `
//
if (process.env.NODE_ENV !== "production") {
  logger.add(
    new transports.Console({
      format: format.simple(),
    })
  );
}

export default logger;
