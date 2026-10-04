import { getOwnerId } from "./auth.js";
import { withErrorMapping } from "./errorBoundary.js";
import { getTask as findTask } from "../container.js";

export const getTask = withErrorMapping(
    async (event) => {
        const { id } = event.pathParameters;

        const task = await findTask({ ownerId: getOwnerId(event), id });

        return {
            statusCode: 200,
            body: JSON.stringify(task),
        };
    },
    { logLabel: "Error retrieving task:", failureMessage: "Could not retrieve task" },
);
