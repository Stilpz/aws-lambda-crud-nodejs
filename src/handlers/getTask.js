import { getOwnerId } from "./auth.js";
import { getTask as findTask } from "../container.js";
import { TaskNotFoundError } from "../domain/errors.js";

const getTask = async (event) => {
    const { id } = event.pathParameters;

    try {
        const task = await findTask({ ownerId: getOwnerId(event), id });

        return {
            statusCode: 200,
            body: JSON.stringify(task),
        };
    } catch (error) {
        if (error instanceof TaskNotFoundError) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "Task not found" }),
            };
        }

        console.error("Error retrieving task:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Could not retrieve task" }),
        };
    }
}

export {
    getTask,
}
