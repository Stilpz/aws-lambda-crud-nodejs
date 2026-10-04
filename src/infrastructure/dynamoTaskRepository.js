import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";

import { InvalidCursorError, TaskNotFoundError } from "../domain/errors.js";
import { UPDATABLE_FIELDS } from "../domain/task.js";

// The table is keyed by owner (partition) and task id (sort). Every request addresses the caller's
// own partition, so ownership is part of the key and one user's request can never match another
// user's task. Ids are time-sortable, so a query returns the owner's tasks oldest first.
const TASK_EXISTS = "attribute_exists(id)";

const isNonEmptyString = (value) => typeof value === "string" && value !== "";

// The cursor holds exactly the sort key of the last item read. The owner is never part of it: it is
// added back from the caller's identity, so a forged cursor cannot page through another user's
// tasks. A cursor with anything else in it, such as one issued before the key redesign, is
// rejected instead of being guessed at.
const encodeCursor = (lastEvaluatedKey) =>
    lastEvaluatedKey ? Buffer.from(JSON.stringify({ id: lastEvaluatedKey.id })).toString("base64url") : null;

const decodeCursor = (cursor, ownerId) => {
    let key;

    try {
        key = JSON.parse(Buffer.from(cursor, "base64url").toString());
    } catch {
        throw new InvalidCursorError();
    }

    const isExactlyAnId = key !== null && typeof key === "object"
        && Object.keys(key).length === 1 && isNonEmptyString(key.id);

    if (!isExactlyAnId) {
        throw new InvalidCursorError();
    }

    return { ownerId, id: key.id };
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
            Key: { ownerId, id },
            ConsistentRead: true,
        }));

        return Item ?? null;
    }

    async listByOwner(ownerId, { limit, cursor }) {
        const exclusiveStartKey = cursor === undefined ? undefined : decodeCursor(cursor, ownerId);

        const result = await this.#client.send(new QueryCommand({
            TableName: this.#tableName,
            KeyConditionExpression: "ownerId = :ownerId",
            ExpressionAttributeValues: { ":ownerId": ownerId },
            ConsistentRead: true,
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
                Key: { ownerId, id },
                UpdateExpression: "set " + fields.map((field) => `#${field} = :${field}`).join(", "),
                ExpressionAttributeNames: Object.fromEntries(fields.map((field) => [`#${field}`, field])),
                ExpressionAttributeValues: Object.fromEntries(fields.map((field) => [`:${field}`, changes[field]])),
                ConditionExpression: TASK_EXISTS,
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
                Key: { ownerId, id },
                ConditionExpression: TASK_EXISTS,
            }));
        } catch (error) {
            throw isConditionalCheckFailure(error) ? new TaskNotFoundError() : error;
        }
    }
}
