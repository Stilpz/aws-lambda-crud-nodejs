import { randomUUID } from "crypto";

import { makeCreateTask } from "./application/createTask.js";
import { makeDeleteTask } from "./application/deleteTask.js";
import { makeGetTask } from "./application/getTask.js";
import { makeListTasks } from "./application/listTasks.js";
import { makeUpdateTask } from "./application/updateTask.js";
import { dynamoDb } from "./infrastructure/dynamoClient.js";
import { DynamoTaskRepository } from "./infrastructure/dynamoTaskRepository.js";

// Composition root: the only module that knows both the use cases and the infrastructure.
// It decides which implementation of each dependency the Lambda functions run with.
const taskRepository = new DynamoTaskRepository({
    client: dynamoDb,
    tableName: process.env.TABLE_NAME,
});

export const createTask = makeCreateTask({ taskRepository, generateId: randomUUID, now: () => new Date() });
export const getTask = makeGetTask({ taskRepository });
export const listTasks = makeListTasks({ taskRepository });
export const updateTask = makeUpdateTask({ taskRepository });
export const deleteTask = makeDeleteTask({ taskRepository });
