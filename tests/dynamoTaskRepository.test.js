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
    it("puts the task without overwriting an existing one", async () => {
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
    it("reads the task with a consistent read and returns it to its owner", async () => {
        client.send.mockResolvedValue({ Item: task });

        expect(await repository.findById(OWNER, "task-1")).toEqual(task);
        expect(sentCommand()).toBeInstanceOf(GetCommand);
        expect(sentCommand().input).toEqual({ TableName: "Tasks", Key: { id: "task-1" }, ConsistentRead: true });
    });

    it("returns null when the task does not exist", async () => {
        expect(await repository.findById(OWNER, "missing")).toBeNull();
    });

    it("returns null when the task belongs to another user", async () => {
        client.send.mockResolvedValue({ Item: { ...task, ownerId: "someone-else" } });

        expect(await repository.findById(OWNER, "task-1")).toBeNull();
    });

    it("propagates infrastructure errors", async () => {
        client.send.mockRejectedValue(new Error("boom"));

        await expect(repository.findById(OWNER, "task-1")).rejects.toThrow("boom");
    });
});

describe("listByOwner", () => {
    it("queries the owner's index with the limit", async () => {
        client.send.mockResolvedValue({ Items: [task] });

        const page = await repository.listByOwner(OWNER, { limit: 5 });

        expect(page).toEqual({ items: [task], nextCursor: null });
        expect(sentCommand()).toBeInstanceOf(QueryCommand);
        expect(sentCommand().input).toEqual({
            TableName: "Tasks",
            IndexName: "ownerId-createdAt-index",
            KeyConditionExpression: "ownerId = :ownerId",
            ExpressionAttributeValues: { ":ownerId": OWNER },
            Limit: 5,
        });
    });

    it("continues after the cursor, scoped to the caller", async () => {
        await repository.listByOwner(OWNER, { limit: 5, cursor: cursorFor({ id: "task-1", createdAt: "c" }) });

        expect(sentCommand().input.ExclusiveStartKey).toEqual({ id: "task-1", createdAt: "c", ownerId: OWNER });
    });

    it("ignores an owner smuggled inside the cursor", async () => {
        await repository.listByOwner(OWNER, {
            limit: 5,
            cursor: cursorFor({ id: "task-1", createdAt: "c", ownerId: "victim" }),
        });

        expect(sentCommand().input.ExclusiveStartKey.ownerId).toBe(OWNER);
    });

    it("returns a cursor without the owner when there are more pages", async () => {
        client.send.mockResolvedValue({
            Items: [task],
            LastEvaluatedKey: { id: "task-1", createdAt: "c", ownerId: OWNER },
        });

        const { nextCursor } = await repository.listByOwner(OWNER, { limit: 1 });

        expect(JSON.parse(Buffer.from(nextCursor, "base64url").toString())).toEqual({ id: "task-1", createdAt: "c" });
    });

    it("reads back a cursor it produced", async () => {
        client.send.mockResolvedValueOnce({ Items: [task], LastEvaluatedKey: { id: "task-1", createdAt: "c", ownerId: OWNER } });
        const { nextCursor } = await repository.listByOwner(OWNER, { limit: 1 });

        client.send.mockResolvedValueOnce({ Items: [] });
        await repository.listByOwner(OWNER, { limit: 1, cursor: nextCursor });

        expect(client.send.mock.calls[1][0].input.ExclusiveStartKey).toEqual({ id: "task-1", createdAt: "c", ownerId: OWNER });
    });

    it.each([
        ["not base64 JSON", "%%%"],
        ["JSON null", cursorFor(null)],
        ["an object without id", cursorFor({ createdAt: "c" })],
        ["an object without createdAt", cursorFor({ id: "1" })],
        ["a non-string id", cursorFor({ id: 5, createdAt: "c" })],
        ["a non-string createdAt", cursorFor({ id: "1", createdAt: 5 })],
        ["an empty id", cursorFor({ id: "", createdAt: "c" })],
        ["an empty cursor", ""],
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
    it("updates only the fields that were sent, if the owner's task exists", async () => {
        await repository.update(OWNER, "task-1", { done: true });

        expect(sentCommand()).toBeInstanceOf(UpdateCommand);
        expect(sentCommand().input).toEqual({
            TableName: "Tasks",
            Key: { id: "task-1" },
            UpdateExpression: "set #done = :done",
            ExpressionAttributeNames: { "#done": "done" },
            ExpressionAttributeValues: { ":done": true, ":ownerId": OWNER },
            ConditionExpression: "attribute_exists(id) AND ownerId = :ownerId",
            ReturnValues: "ALL_NEW",
        });
    });

    it("ignores fields that cannot be updated", async () => {
        await repository.update(OWNER, "task-1", { title: "New", done: false, id: "hacked", ownerId: "victim", createdAt: "x" });

        const { input } = sentCommand();
        expect(input.UpdateExpression).toBe("set #done = :done, #title = :title");
        expect(input.ExpressionAttributeValues).toEqual({ ":done": false, ":title": "New", ":ownerId": OWNER });
    });

    it("keeps an empty description, which is a valid value", async () => {
        await repository.update(OWNER, "task-1", { description: "" });

        expect(sentCommand().input.ExpressionAttributeValues).toEqual({ ":description": "", ":ownerId": OWNER });
    });

    it("rejects with TaskNotFoundError when the condition fails", async () => {
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
    it("deletes the task if it exists and belongs to the owner", async () => {
        await repository.delete(OWNER, "task-1");

        expect(sentCommand()).toBeInstanceOf(DeleteCommand);
        expect(sentCommand().input).toEqual({
            TableName: "Tasks",
            Key: { id: "task-1" },
            ConditionExpression: "attribute_exists(id) AND ownerId = :ownerId",
            ExpressionAttributeValues: { ":ownerId": OWNER },
        });
    });

    it("rejects with TaskNotFoundError when the condition fails", async () => {
        client.send.mockRejectedValue(conditionalCheckFailed());

        await expect(repository.delete(OWNER, "task-1")).rejects.toThrow(TaskNotFoundError);
    });

    it("propagates any other error unchanged", async () => {
        const failure = new Error("boom");
        client.send.mockRejectedValue(failure);

        await expect(repository.delete(OWNER, "task-1")).rejects.toBe(failure);
    });
});
