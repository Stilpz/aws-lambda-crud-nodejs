import AWS from "aws-sdk";

const getTasks = async (event) => {
    try {
        const dynamoDb = new AWS.DynamoDB.DocumentClient();

        const result= await dynamoDb.scan({
            TableName: process.env.TABLE_NAME
        }).promise();

        const tasks = result.Items;

        return {
            statusCode: 200,
            body: JSON.stringify(tasks),
        };
    } catch (error) {
        console.error("Error retrieving tasks:", error);

        return {
            statusCode: 500,
            body: JSON.stringify({ message: "Could not retrieve tasks" }),
        };
    }
}

export {
    getTasks,
}