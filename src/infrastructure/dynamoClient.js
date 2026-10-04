import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient } from "@aws-sdk/lib-dynamodb";
import { tracer } from "./observability.js";

// Created once per Lambda container and reused by every invocation it serves. The low-level client
// is the one that gets traced, so each DynamoDB call becomes a subsegment of the invocation.
export const dynamoDb = DynamoDBDocumentClient.from(tracer.captureAWSv3Client(new DynamoDBClient()));
