// Structured winston logger. Socket.IO rooms carry a `rid` label so
// participant traffic can be traced per room.
import winston from "winston";

const LOG_LEVEL = process.env.LOG_LEVEL || "INFO";

const log = winston.createLogger({
  level: LOG_LEVEL,
  format: winston.format.timestamp({ format: "HH:mm:ss.SSS" }),
  defaults: winston.format.json(),
  transports: [new winston.transports.Console({ stderrLevels: ["error"] })],
});

export default log;
