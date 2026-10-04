import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The CloudFormation short forms (!Sub, !Ref) are tags this test does not need to resolve.
const readYaml = (path) => parse(readFileSync(path, "utf8"), { logLevel: "error" });

const template = readYaml("infra/github-oidc.yml");
const role = template.Resources.DeployRole.Properties;
const statements = role.Policies[0].PolicyDocument.Statement;
const grantedActions = new Set(statements.flatMap(({ Action }) => [Action].flat()));

// CloudFormation creates every resource with the caller's own permissions, so the deploy role needs
// the create action for each resource type the stack declares. A type that is not listed here makes
// the test fail on purpose: grant its actions in infra/github-oidc.yml and list it below.
const CREATE_ACTION_BY_TYPE = {
    "AWS::DynamoDB::Table": "dynamodb:CreateTable",
    "AWS::Cognito::UserPool": "cognito-idp:CreateUserPool",
    "AWS::Cognito::UserPoolClient": "cognito-idp:CreateUserPoolClient",
    "AWS::SNS::Topic": "sns:CreateTopic",
    "AWS::SNS::Subscription": "sns:Subscribe",
    "AWS::CloudWatch::Alarm": "cloudwatch:PutMetricAlarm",
};

const declaredResourceTypes = () =>
    readdirSync("resources")
        .flatMap((file) => Object.values(readYaml(`resources/${file}`).Resources ?? {}))
        .map(({ Type }) => Type);

// Statements that may use Resource "*" because IAM cannot scope the action to a name.
const UNSCOPED_ALLOWED = ["CloudFormationValidation", "UserPoolCreation", "LogGroupListing", "AlarmListing"];

describe("the deploy role of infra/github-oidc.yml", () => {
    it("can create every type of resource the stack declares", () => {
        for (const type of new Set(declaredResourceTypes())) {
            const action = CREATE_ACTION_BY_TYPE[type];

            expect(action, `${type} has no entry in CREATE_ACTION_BY_TYPE`).toBeDefined();
            expect(grantedActions.has(action), `${type} needs ${action} in the deploy role`).toBe(true);
        }
    });

    it("can configure what the smoke test and the user pool settings call", () => {
        for (const action of ["cognito-idp:AdminInitiateAuth", "cognito-idp:SetUserPoolMfaConfig", "cloudwatch:DeleteAlarms", "sns:DeleteTopic"]) {
            expect(grantedActions.has(action), `${action} is missing`).toBe(true);
        }
    });

    it("never uses a wildcard action", () => {
        for (const action of grantedActions) {
            expect(action, "wildcard action").not.toContain("*");
        }
    });

    it("cannot escalate: no managed policies, IAM users, access keys or OIDC provider changes", () => {
        // Only IAM actions can grant permissions. The Cognito users the smoke test creates are not IAM users.
        const forbidden = [/AttachRolePolicy/, /CreateUser$/, /CreateAccessKey/, /OpenIDConnectProvider/, /PutUserPolicy/, /CreatePolicy/];

        for (const action of [...grantedActions].filter((granted) => granted.startsWith("iam:"))) {
            expect(forbidden.some((pattern) => pattern.test(action)), `${action} would let a deploy grant itself more`).toBe(false);
        }
    });

    it("scopes every statement to the service and stage except the few actions IAM cannot scope", () => {
        for (const { Sid, Resource } of statements) {
            const resources = [Resource].flat();

            if (UNSCOPED_ALLOWED.includes(Sid)) {
                continue;
            }

            expect(resources, `${Sid} must not use a bare wildcard`).not.toContain("*");
        }
    });

    it("can be assumed only by this repository, through the GitHub Environment named after the stage", () => {
        const condition = role.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals;

        expect(condition["token.actions.githubusercontent.com:aud"]).toBe("sts.amazonaws.com");
        expect(condition["token.actions.githubusercontent.com:sub"]).toBe("repo:${GitHubRepository}:environment:${Stage}");
        expect(role.AssumeRolePolicyDocument.Statement[0].Principal.Federated).toContain("oidc-provider/token.actions.githubusercontent.com");
    });
});
