import { dynamoDb } from "./dynamoClient.js";
import { DynamoTaskRepository } from "./dynamoTaskRepository.js";

// Composition root: the one place that decides which TaskRepository implementation is used.
export const taskRepository = new DynamoTaskRepository({
    client: dynamoDb,
    tableName: process.env.TABLE_NAME,
});
