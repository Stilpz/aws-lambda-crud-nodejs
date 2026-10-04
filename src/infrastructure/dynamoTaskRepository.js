import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { InvalidCursorError, TaskNotFoundError } from "../domain/errors.js";
import { UPDATABLE_FIELDS } from "../domain/task.js";

const OWNER_INDEX = "ownerId-createdAt-index";
const OWNED_TASK_EXISTS = "attribute_exists(id) AND ownerId = :ownerId";

const isNonEmptyString = (value) => typeof value === "string" && value !== "";

// The cursor holds only the table and index key attributes of the last item read. The owner is
// never part of it: it is added back from the caller's identity, so a forged cursor cannot page
// through another user's tasks.
const encodeCursor = (lastEvaluatedKey) =>
    lastEvaluatedKey
        ? Buffer.from(JSON.stringify({ id: lastEvaluatedKey.id, createdAt: lastEvaluatedKey.createdAt })).toString("base64url")
        : null;

const decodeCursor = (cursor, ownerId) => {
    let key;

    try {
        key = JSON.parse(Buffer.from(cursor, "base64url").toString());
    } catch {
        throw new InvalidCursorError();
    }

    if (!isNonEmptyString(key?.id) || !isNonEmptyString(key?.createdAt)) {
        throw new InvalidCursorError();
    }

    return { id: key.id, createdAt: key.createdAt, ownerId };
};

const isConditionalCheckFailure = (error) => error.name === "ConditionalCheckFailedException";

/** @implements {import("../domain/taskRepository.js").TaskRepository} */
export class DynamoTaskRepository {
    #client;
    #tableName;

    constructor({ client, tableName }) {
        this.#client = client;
        this.#tableName = tableName;
    }

    async create(task) {
        await this.#client.send(new PutCommand({
            TableName: this.#tableName,
            Item: task,
            ConditionExpression: "attribute_not_exists(id)",
        }));
    }

    async findById(ownerId, id) {
        const { Item } = await this.#client.send(new GetCommand({
            TableName: this.#tableName,
            Key: { id },
            ConsistentRead: true,
        }));

        return Item?.ownerId === ownerId ? Item : null;
    }

    async listByOwner(ownerId, { limit, cursor }) {
        const exclusiveStartKey = cursor === undefined ? undefined : decodeCursor(cursor, ownerId);

        const result = await this.#client.send(new QueryCommand({
            TableName: this.#tableName,
            IndexName: OWNER_INDEX,
            KeyConditionExpression: "ownerId = :ownerId",
            ExpressionAttributeValues: { ":ownerId": ownerId },
            Limit: limit,
            ExclusiveStartKey: exclusiveStartKey,
        }));

        return { items: result.Items, nextCursor: encodeCursor(result.LastEvaluatedKey) };
    }

    async update(ownerId, id, changes) {
        const fields = UPDATABLE_FIELDS.filter((field) => changes[field] !== undefined);

        try {
            await this.#client.send(new UpdateCommand({
                TableName: this.#tableName,
                Key: { id },
                UpdateExpression: "set " + fields.map((field) => `#${field} = :${field}`).join(", "),
                ExpressionAttributeNames: Object.fromEntries(fields.map((field) => [`#${field}`, field])),
                ExpressionAttributeValues: {
                    ...Object.fromEntries(fields.map((field) => [`:${field}`, changes[field]])),
                    ":ownerId": ownerId,
                },
                ConditionExpression: OWNED_TASK_EXISTS,
                ReturnValues: "ALL_NEW",
            }));
        } catch (error) {
            throw isConditionalCheckFailure(error) ? new TaskNotFoundError() : error;
        }
    }

    async delete(ownerId, id) {
        try {
            await this.#client.send(new DeleteCommand({
                TableName: this.#tableName,
                Key: { id },
                ConditionExpression: OWNED_TASK_EXISTS,
                ExpressionAttributeValues: { ":ownerId": ownerId },
            }));
        } catch (error) {
            throw isConditionalCheckFailure(error) ? new TaskNotFoundError() : error;
        }
    }
}
