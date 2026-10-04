import { getOwnerId } from "./auth.js";
import { withErrorMapping } from "./errorBoundary.js";
import { withObservability } from "./withObservability.js";
import { parsePagination } from "./pagination.js";
import { listTasks } from "../container.js";

export const getTasks = withObservability(
    withErrorMapping(
        async (event) => {
            const { limit, cursor } = parsePagination(event.queryStringParameters);

            const { items, nextCursor } = await listTasks({ ownerId: getOwnerId(event), limit, cursor });

            return {
                statusCode: 200,
                body: JSON.stringify({
                    items,
                    nextToken: nextCursor,
                }),
            };
        },
        { logLabel: "Error retrieving tasks:", failureMessage: "Could not retrieve tasks" },
    ),
);
