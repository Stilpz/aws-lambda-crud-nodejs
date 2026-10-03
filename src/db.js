import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";

// Created once per Lambda container and reused by every invocation it serves.
export const dynamoDb = DynamoDBDocumentClient.from(new DynamoDBClient());
