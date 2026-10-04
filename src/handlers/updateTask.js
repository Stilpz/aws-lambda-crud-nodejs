import { withJsonBody } from "./middleware.js";
import { withObservability } from "./withObservability.js";
import { withErrorMapping } from "./errorBoundary.js";
import { withDeprecation } from "./deprecation.js";
import { updateTaskSchema } from "./schemas.js";
import { getOwnerId } from "./auth.js";
import { updateTask as changeTask } from "../container.js";

const updateTaskHandler = async (event) => {
    const { id } = event.pathParameters;

    await changeTask({ ownerId: getOwnerId(event), id, changes: event.body });

    return {
        statusCode: 200,
        body: JSON.stringify({ message: 'Task updated successfully' }),
    };
};

// PUT is deprecated in favor of PATCH. The sunset date is at least 90 days after the release that
// announces it; move both dates in the release pull request if the release slips by months.
const DEPRECATION = {
    deprecatedAt: new Date("2026-10-03T00:00:00Z"),
    sunsetAt: new Date("2027-04-03T00:00:00Z"),
    noticeUrl: "https://github.com/Stilpz/aws-lambda-crud-nodejs/blob/main/CHANGELOG.md",
};

// Observability is the outermost layer of every handler. The deprecation headers are added to the
// finished response, so they also reach the 400, 415 and 422 answers built by the middleware.
export const updateTask = withObservability(
    withDeprecation(
        withJsonBody(
            withErrorMapping(updateTaskHandler, { logLabel: "Error updating task:", failureMessage: "Could not update task" }),
            updateTaskSchema,
        ),
        DEPRECATION,
    ),
);
