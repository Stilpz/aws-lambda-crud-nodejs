// The only way these tests learn where to connect is DYNAMODB_ENDPOINT, and they refuse an AWS
// endpoint, so a developer with real credentials in the shell cannot reach a real table.
const endpoint = process.env.DYNAMODB_ENDPOINT;

if (!endpoint) {
    throw new Error(
        "DYNAMODB_ENDPOINT is not set. Start DynamoDB Local (docker run -p 8000:8000 amazon/dynamodb-local) "
        + "and run: DYNAMODB_ENDPOINT=http://localhost:8000 npm run test:integration",
    );
}

if (new URL(endpoint).hostname.endsWith("amazonaws.com")) {
    throw new Error(`DYNAMODB_ENDPOINT points at AWS (${endpoint}); the integration tests only run against DynamoDB Local.`);
}
