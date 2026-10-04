import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { InvalidCursorError, TaskNotFoundError } from "../src/domain/errors.js";
import { DynamoTaskRepository } from "../src/infrastructure/dynamoTaskRepository.js";
import { conditionalCheckFailed } from "./helpers.js";

const OWNER = "user-1";
const task = { id: "task-1", ownerId: OWNER, title: "t", description: "d", createdAt: "2026-01-01T00:00:00.000Z", done: false };

const cursorFor = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");

let client;
let repository;

// The command and the input of the single request the repository sent.
const sentCommand = () => client.send.mock.calls[0][0];

beforeEach(() => {
    client = { send: vi.fn().mockResolvedValue({}) };
    repository = new DynamoTaskRepository({ client, tableName: "Tasks" });
});

describe("create", () => {
    it("puts the task, which carries the owner as its partition key, without overwriting one", async () => {
        await repository.create(task);

        expect(sentCommand()).toBeInstanceOf(PutCommand);
        expect(sentCommand().input).toEqual({
            TableName: "Tasks",
            Item: task,
            ConditionExpression: "attribute_not_exists(id)",
        });
    });

    it("propagates infrastructure errors", async () => {
        client.send.mockRejectedValue(new Error("boom"));

        await expect(repository.create(task)).rejects.toThrow("boom");
    });
});

describe("findById", () => {
    it("reads the task from the caller's own partition with a consistent read", async () => {
        client.send.mockResolvedValue({ Item: task });

        expect(await repository.findById(OWNER, "task-1")).toEqual(task);
        expect(sentCommand()).toBeInstanceOf(GetCommand);
        expect(sentCommand().input).toEqual({
            TableName: "Tasks",
            Key: { ownerId: OWNER, id: "task-1" },
            ConsistentRead: true,
        });
    });

    it("returns null when there is no such task in the caller's partition", async () => {
        expect(await repository.findById(OWNER, "missing")).toBeNull();
    });

    it("looks in the partition of whoever asks, so another user's task is never addressed", async () => {
        await repository.findById("user-2", "task-1");

        expect(sentCommand().input.Key).toEqual({ ownerId: "user-2", id: "task-1" });
    });

    it("propagates infrastructure errors", async () => {
        client.send.mockRejectedValue(new Error("boom"));

        await expect(repository.findById(OWNER, "task-1")).rejects.toThrow("boom");
    });
});

describe("listByOwner", () => {
    it("queries the caller's partition of the table with a consistent read and the limit", async () => {
        client.send.mockResolvedValue({ Items: [task] });

        const page = await repository.listByOwner(OWNER, { limit: 5 });

        expect(page).toEqual({ items: [task], nextCursor: null });
        expect(sentCommand()).toBeInstanceOf(QueryCommand);
        expect(sentCommand().input).toEqual({
            TableName: "Tasks",
            KeyConditionExpression: "ownerId = :ownerId",
            ExpressionAttributeValues: { ":ownerId": OWNER },
            ConsistentRead: true,
            Limit: 5,
        });
    });

    it("uses no secondary index", async () => {
        await repository.listByOwner(OWNER, { limit: 5 });

        expect(sentCommand().input).not.toHaveProperty("IndexName");
    });

    it("continues after the cursor, scoped to the caller", async () => {
        await repository.listByOwner(OWNER, { limit: 5, cursor: cursorFor({ id: "task-1" }) });

        expect(sentCommand().input.ExclusiveStartKey).toEqual({ ownerId: OWNER, id: "task-1" });
    });

    it("returns a cursor with only the id when there are more pages", async () => {
        client.send.mockResolvedValue({
            Items: [task],
            LastEvaluatedKey: { ownerId: OWNER, id: "task-1" },
        });

        const { nextCursor } = await repository.listByOwner(OWNER, { limit: 1 });

        expect(JSON.parse(Buffer.from(nextCursor, "base64url").toString())).toEqual({ id: "task-1" });
    });

    it("reads back a cursor it produced", async () => {
        client.send.mockResolvedValueOnce({ Items: [task], LastEvaluatedKey: { ownerId: OWNER, id: "task-1" } });
        const { nextCursor } = await repository.listByOwner(OWNER, { limit: 1 });

        client.send.mockResolvedValueOnce({ Items: [] });
        await repository.listByOwner(OWNER, { limit: 1, cursor: nextCursor });

        expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ ownerId: OWNER, id: "task-1" });
    });

    it.each([
        ["not base64 JSON", "%%%"],
        ["JSON null", cursorFor(null)],
        ["an object without id", cursorFor({ foo: "bar" })],
        ["a non-string id", cursorFor({ id: 5 })],
        ["an empty id", cursorFor({ id: "" })],
        ["an empty token", ""],
        ["one issued before the key redesign, which also carried createdAt", cursorFor({ id: "task-1", createdAt: "c" })],
        ["one that tries to smuggle in an owner", cursorFor({ id: "task-1", ownerId: "victim" })],
    ])("rejects a cursor that is %s without querying", async (_name, cursor) => {
        await expect(repository.listByOwner(OWNER, { limit: 5, cursor })).rejects.toThrow(InvalidCursorError);
        expect(client.send).not.toHaveBeenCalled();
    });

    it("propagates infrastructure errors", async () => {
        client.send.mockRejectedValue(new Error("boom"));

        await expect(repository.listByOwner(OWNER, { limit: 5 })).rejects.toThrow("boom");
    });
});

describe("update", () => {
    it("updates only the fields that were sent, in the caller's partition", async () => {
        await repository.update(OWNER, "task-1", { done: true });

        expect(sentCommand()).toBeInstanceOf(UpdateCommand);
        expect(sentCommand().input).toEqual({
            TableName: "Tasks",
            Key: { ownerId: OWNER, id: "task-1" },
            UpdateExpression: "set #done = :done",
            ExpressionAttributeNames: { "#done": "done" },
            ExpressionAttributeValues: { ":done": true },
            ConditionExpression: "attribute_exists(id)",
            ReturnValues: "ALL_NEW",
        });
    });

    it("ignores fields that cannot be updated", async () => {
        await repository.update(OWNER, "task-1", { title: "New", done: false, id: "hacked", ownerId: "victim", createdAt: "x" });

        const { input } = sentCommand();
        expect(input.UpdateExpression).toBe("set #done = :done, #title = :title");
        expect(input.ExpressionAttributeValues).toEqual({ ":done": false, ":title": "New" });
        expect(input.Key).toEqual({ ownerId: OWNER, id: "task-1" });
    });

    it("keeps an empty description, which is a valid value", async () => {
        await repository.update(OWNER, "task-1", { description: "" });

        expect(sentCommand().input.ExpressionAttributeValues).toEqual({ ":description": "" });
    });

    it("rejects with TaskNotFoundError when the task is not in the caller's partition", async () => {
        client.send.mockRejectedValue(conditionalCheckFailed());

        await expect(repository.update(OWNER, "task-1", { done: true })).rejects.toThrow(TaskNotFoundError);
    });

    it("propagates any other error unchanged", async () => {
        const failure = new Error("boom");
        client.send.mockRejectedValue(failure);

        await expect(repository.update(OWNER, "task-1", { done: true })).rejects.toBe(failure);
    });
});

describe("delete", () => {
    it("deletes the task from the caller's partition if it exists", async () => {
        await repository.delete(OWNER, "task-1");

        expect(sentCommand()).toBeInstanceOf(DeleteCommand);
        expect(sentCommand().input).toEqual({
            TableName: "Tasks",
            Key: { ownerId: OWNER, id: "task-1" },
            ConditionExpression: "attribute_exists(id)",
        });
    });

    it("rejects with TaskNotFoundError when the task is not in the caller's partition", async () => {
        client.send.mockRejectedValue(conditionalCheckFailed());

        await expect(repository.delete(OWNER, "task-1")).rejects.toThrow(TaskNotFoundError);
    });

    it("propagates any other error unchanged", async () => {
        const failure = new Error("boom");
        client.send.mockRejectedValue(failure);

        await expect(repository.delete(OWNER, "task-1")).rejects.toBe(failure);
    });
});
