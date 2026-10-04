import { getOwnerId } from "./auth.js";
import { InvalidCursorError } from "./domain/errors.js";
import { taskRepository } from "./infrastructure/taskRepository.js";
import { InvalidPaginationError, parsePagination } from "./pagination.js";

const getTasks = async (event) => {
    try {
        const { limit, cursor } = parsePagination(event.queryStringParameters);

        const { items, nextCursor } = await taskRepository.listByOwner(getOwnerId(event), { limit, cursor });

        return {
            statusCode: 200,
            body: JSON.stringify({
                items,
                nextToken: nextCursor,
            }),
        };
    } catch (error) {
        if (error instanceof InvalidPaginationError || error instanceof InvalidCursorError) {
            return {
                statusCode: 400,
                body: JSON.stringify({ message: error.message }),
            };
        }

        console.error("Error retrieving tasks:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Could not retrieve tasks" }),
        };
    }
}

export {
    getTasks,
}
