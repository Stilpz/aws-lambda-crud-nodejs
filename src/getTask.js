import { getOwnerId } from "./auth.js";
import { taskRepository } from "./infrastructure/taskRepository.js";

const getTask = async (event) => {
    const { id } = event.pathParameters;

    try {
        const task = await taskRepository.findById(getOwnerId(event), id);

        if (!task) {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: "Task not found" }),
            };
        }

        return {
            statusCode: 200,
            body: JSON.stringify(task),
        };
    } catch (error) {
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
