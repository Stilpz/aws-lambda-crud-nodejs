import AWS from "aws-sdk";

const FIELD_VALIDATORS = {
    done: (value) => typeof value === 'boolean',
    title: (value) => typeof value === 'string' && value.trim().length > 0,
    description: (value) => typeof value === 'string',
};

const updateTask = async (event) => {
    const { id } = event.pathParameters;

    let body;
    try {
        body = JSON.parse(event.body);
    } catch (error) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'Request body must be valid JSON' }),
        };
    }

    const fields = Object.keys(FIELD_VALIDATORS).filter((key) => body[key] !== undefined);

    if (fields.length === 0) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: 'No updatable fields provided (expected done, title and/or description)' }),
        };
    }

    const invalidField = fields.find((key) => !FIELD_VALIDATORS[key](body[key]));
    if (invalidField) {
        return {
            statusCode: 400,
            body: JSON.stringify({ message: `Invalid value for field "${invalidField}"` }),
        };
    }

    const updateExpression = 'set ' + fields.map((key) => `#${key} = :${key}`).join(', ');
    const expressionAttributeNames = Object.fromEntries(fields.map((key) => [`#${key}`, key]));
    const expressionAttributeValues = Object.fromEntries(fields.map((key) => [`:${key}`, body[key]]));

    const dynamoDb = new AWS.DynamoDB.DocumentClient();

    try {
        await dynamoDb.update({
            TableName: 'TaskTable',
            Key: { id },
            UpdateExpression: updateExpression,
            ExpressionAttributeNames: expressionAttributeNames,
            ExpressionAttributeValues: expressionAttributeValues,
            ConditionExpression: 'attribute_exists(id)',
            ReturnValues: 'ALL_NEW',
        }).promise();

        return {
            statusCode: 200,
            body: JSON.stringify({ message: 'Task updated successfully' }),
        };
    } catch (error) {
        if (error.code === 'ConditionalCheckFailedException') {
            return {
                statusCode: 404,
                body: JSON.stringify({ message: 'Task not found' }),
            };
        }

        console.error('Error updating task:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ message: 'Could not update task' }),
        };
    }
};

export {
    updateTask,
};
