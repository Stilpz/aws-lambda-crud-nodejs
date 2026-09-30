import AWS from "aws-sdk";

// Created once per Lambda container and reused by every invocation it serves.
export const dynamoDb = new AWS.DynamoDB.DocumentClient();
