import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GetCommand } from "@aws-sdk/lib-dynamodb";
import { InvalidCursorError } from "../../src/domain/errors.js";
import { DynamoTaskRepository } from "../../src/infrastructure/dynamoTaskRepository.js";
import { describeTaskRepositoryContract } from "../taskRepositoryContract.js";
import {
    TASK_TABLE_KEY_SCHEMA,
    createLocalClients,
    createTaskTable,
    deleteTaskTable,
    describeTable,
    uniqueTableName,
} from "./dynamoLocal.js";

const { lowLevel, documents } = createLocalClients();
const tableName = uniqueTableName();
const repository = new DynamoTaskRepository({ client: documents, tableName });

const task = (ownerId, id) => ({
    id,
    ownerId,
    title: "title",
    description: "description",
    createdAt: "2026-01-01T00:00:00.000Z",
    done: false,
});

const cursorFor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

beforeAll(() => createTaskTable(lowLevel, tableName));
afterAll(() => deleteTaskTable(lowLevel, tableName));

describeTaskRepositoryContract("DynamoTaskRepository on DynamoDB Local", () => repository);

describe("DynamoTaskRepository on DynamoDB Local, what the contract cannot show", () => {
    it("works against a table keyed by ownerId and id with no secondary index", async () => {
        const table = await describeTable(lowLevel, tableName);

        expect(table.KeySchema).toEqual(TASK_TABLE_KEY_SCHEMA);
        expect(table.GlobalSecondaryIndexes).toBeUndefined();
    });

    it("stores the task under the key { ownerId, id }", async () => {
        await repository.create(task("owner-keys", "id-keys"));

        const { Item } = await documents.send(new GetCommand({
            TableName: tableName,
            Key: { ownerId: "owner-keys", id: "id-keys" },
            ConsistentRead: true,
        }));

        expect(Item).toEqual(task("owner-keys", "id-keys"));
    });

    it("lists a task straight after creating it", async () => {
        await repository.create(task("owner-fresh", "id-fresh"));

        const { items } = await repository.listByOwner("owner-fresh", { limit: 10 });

        expect(items.map((item) => item.id)).toEqual(["id-fresh"]);
    });

    it("rejects a duplicate create with the conditional check failure and keeps the first item", async () => {
        await repository.create(task("owner-dup", "id-dup"));

        await expect(repository.create({ ...task("owner-dup", "id-dup"), title: "second" }))
            .rejects.toMatchObject({ name: "ConditionalCheckFailedException" });

        expect((await repository.findById("owner-dup", "id-dup")).title).toBe("title");
    });

    it("rejects a cursor that carries an owner, so it cannot be forged to page through another partition", async () => {
        await repository.create(task("owner-victim", "id-victim"));

        await expect(repository.listByOwner("owner-attacker", {
            limit: 10,
            cursor: cursorFor({ ownerId: "owner-victim", id: "id-victim" }),
        })).rejects.toBeInstanceOf(InvalidCursorError);
    });
});
