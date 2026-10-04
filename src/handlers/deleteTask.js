import { getOwnerId } from "./auth.js";
import { withErrorMapping } from "./errorBoundary.js";
import { deleteTask as removeTask } from "../container.js";

export const deleteTask = withErrorMapping(
    async (event) => {
        const { id } = event.pathParameters;

        await removeTask({ ownerId: getOwnerId(event), id });

        return {
            statusCode: 200,
            body: JSON.stringify({ message: "Task deleted successfully" }),
        };
    },
    { logLabel: "Error deleting task:", failureMessage: "Could not delete task" },
);
