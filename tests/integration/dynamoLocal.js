import { randomUUID } from "node:crypto";
import {
    CreateTableCommand,
    DeleteTableCommand,
    DescribeTableCommand,
    DynamoDBClient,
    waitUntilTableExists,
} from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Dummy credentials: DynamoDB Local needs some but does not check them, and from version 2.0.0
// it accepts only letters and digits in the access key id.
const DUMMY_CREDENTIALS = { accessKeyId: "localtest", secretAccessKey: "localtest" };

export const createLocalClients = () => {
    const lowLevel = new DynamoDBClient({
        endpoint: process.env.DYNAMODB_ENDPOINT,
        region: "us-west-2",
        credentials: DUMMY_CREDENTIALS,
    });

    return { lowLevel, documents: DynamoDBDocumentClient.from(lowLevel) };
};

export const uniqueTableName = () => `Tasks-it-${randomUUID()}`;

// Mirrors the table of serverless.yml (resources.Resources.TaskTable): partition key ownerId, sort
// key id, on-demand billing, no secondary index. Keep the two in step.
export const TASK_TABLE_KEY_SCHEMA = [
    { AttributeName: "ownerId", KeyType: "HASH" },
    { AttributeName: "id", KeyType: "RANGE" },
];

export const createTaskTable = async (lowLevel, tableName) => {
    await lowLevel.send(new CreateTableCommand({
        TableName: tableName,
        BillingMode: "PAY_PER_REQUEST",
        AttributeDefinitions: [
            { AttributeName: "ownerId", AttributeType: "S" },
            { AttributeName: "id", AttributeType: "S" },
        ],
        KeySchema: TASK_TABLE_KEY_SCHEMA,
    }));
    await waitUntilTableExists({ client: lowLevel, maxWaitTime: 20 }, { TableName: tableName });
};

export const deleteTaskTable = (lowLevel, tableName) =>
    lowLevel.send(new DeleteTableCommand({ TableName: tableName }));

export const describeTable = async (lowLevel, tableName) =>
    (await lowLevel.send(new DescribeTableCommand({ TableName: tableName }))).Table;
