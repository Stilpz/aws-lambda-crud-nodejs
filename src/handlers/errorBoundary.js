import { InvalidCursorError, TaskNotFoundError } from "../domain/errors.js";
import { InvalidPaginationError } from "./pagination.js";
import { logger } from "../infrastructure/observability.js";

// The one place that turns errors into HTTP responses. Each known error carries a message that is
// safe to show, so it is returned as is. A new error type is one line here and no handler changes.
const STATUS_BY_ERROR = [
    [TaskNotFoundError, 404],
    [InvalidCursorError, 400],
    [InvalidPaginationError, 400],
];

const respond = (statusCode, message) => ({
    statusCode,
    body: JSON.stringify({ message }),
});

// Anything that is not a known error is logged and answered with a fixed message, so internal
// details never reach the client.
export const withErrorMapping = (handler, { logLabel, failureMessage }) =>
    async (event, context) => {
        try {
            return await handler(event, context);
        } catch (error) {
            const known = STATUS_BY_ERROR.find(([ErrorType]) => error instanceof ErrorType);

            if (known) {
                return respond(known[1], error.message);
            }

            logger.error(logLabel, error);

            return respond(500, failureMessage);
        }
    };
