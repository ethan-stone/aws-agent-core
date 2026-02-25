import { CfnOutput, Duration, Stack, StackProps } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import path from "path";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cr from "aws-cdk-lib/custom-resources";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as bedrockAgentCore from "@aws-cdk/aws-bedrock-agentcore-alpha";
import * as kms from "aws-cdk-lib/aws-kms";

export class AgentCoreStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- Bedrock AgentCore Runtime ---

    const helloWorldAgentRuntimeArtifact =
      bedrockAgentCore.AgentRuntimeArtifact.fromAsset(
        path.join(__dirname, ".."),
        { file: "apps/hello-world/Dockerfile" }
      );

    const memoryKmsKey = new kms.Key(this, "MemoryKmsKey", {
      alias: "hello_world_memory_kms_key",
    });

    const memory = new bedrockAgentCore.Memory(this, "Memory", {
      memoryName: "hello_world_memory",
      expirationDuration: Duration.days(7),
      kmsKey: memoryKmsKey,
    });

    // --- Cognito User Pool (inbound auth + outbound identity provider) ---

    const userPool = new cognito.UserPool(this, "AgentCoreIdentityPool", {
      userPoolName: "AgentCoreIdentityPool",
      selfSignUpEnabled: false,
      signInAliases: { email: true },
    });

    userPool.addDomain("AgentCoreIdentityDomain", {
      cognitoDomain: {
        domainPrefix: `agentcore-identity-${this.account}-${this.region}`,
      },
    });

    const userPoolClient = userPool.addClient("AgentCoreIdentityClient", {
      generateSecret: true,
      authFlows: {
        adminUserPassword: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
          cognito.OAuthScope.EMAIL,
        ],
        callbackUrls: [
          "http://localhost:9090/oauth2/callback",
          "https://bedrock-agentcore.us-east-1.amazonaws.com/identities/oauth2/callback/144dd2d5-2417-4996-9ce0-41fdcc92ec7f",
        ],
      },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
    });

    // --- Bedrock AgentCore Runtime (Cognito inbound auth) ---

    const helloWorldRuntime = new bedrockAgentCore.Runtime(
      this,
      "HelloWorldAgentRuntime",
      {
        runtimeName: "hello_world_agent",
        agentRuntimeArtifact: helloWorldAgentRuntimeArtifact,
        authorizerConfiguration:
          bedrockAgentCore.RuntimeAuthorizerConfiguration.usingCognito(
            userPool,
            [userPoolClient]
          ),
        environmentVariables: {
          MEMORY_ID: memory.memoryId,
        },
      }
    );

    helloWorldRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream",
        ],
        resources: [
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
          "arn:aws:bedrock:*::foundation-model/*",
        ],
      })
    );

    helloWorldRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:ListEvents",
        ],
        resources: [memory.memoryArn],
      })
    );

    helloWorldRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:GetResourceOauth2Token",
          "bedrock-agentcore:GetWorkloadAccessToken",
          "bedrock-agentcore:GetWorkloadAccessTokenForJWT",
          "secretsmanager:GetSecretValue",
        ],
        resources: ["*"],
      })
    );

    memoryKmsKey.grantEncryptDecrypt(helloWorldRuntime.role);

    // --- X-Ray / Transaction Search Observability ---

    // 1. CloudWatch Logs resource policy allowing X-Ray to write spans
    const xrayLogsPolicy = new logs.ResourcePolicy(
      this,
      "XRaySpansResourcePolicy",
      {
        resourcePolicyName: "XRayTransactionSearchAccess",
        policyStatements: [
          new iam.PolicyStatement({
            sid: "TransactionSearchXRayAccess",
            effect: iam.Effect.ALLOW,
            principals: [new iam.ServicePrincipal("xray.amazonaws.com")],
            actions: ["logs:PutLogEvents"],
            resources: [
              `arn:aws:logs:${this.region}:${this.account}:log-group:aws/spans:*`,
              `arn:aws:logs:${this.region}:${this.account}:log-group:/aws/application-signals/data:*`,
            ],
            conditions: {
              ArnLike: {
                "aws:SourceArn": `arn:aws:xray:${this.region}:${this.account}:*`,
              },
              StringEquals: {
                "aws:SourceAccount": this.account,
              },
            },
          }),
        ],
      }
    );

    // 2. Set trace segment destination to CloudWatch Logs
    const traceDestination = new cr.AwsCustomResource(
      this,
      "TraceSegmentDestination",
      {
        onCreate: {
          service: "XRay",
          action: "UpdateTraceSegmentDestination",
          parameters: { Destination: "CloudWatchLogs" },
          physicalResourceId: cr.PhysicalResourceId.of(
            "trace-segment-destination"
          ),
          ignoreErrorCodesMatching: ".*",
        },
        onUpdate: {
          service: "XRay",
          action: "UpdateTraceSegmentDestination",
          parameters: { Destination: "CloudWatchLogs" },
          physicalResourceId: cr.PhysicalResourceId.of(
            "trace-segment-destination"
          ),
          ignoreErrorCodesMatching: ".*",
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: [
              "xray:UpdateTraceSegmentDestination",
              "application-signals:StartDiscovery",
            ],
            resources: ["*"],
          }),
        ]),
      }
    );
    traceDestination.node.addDependency(xrayLogsPolicy);

    // 3. Configure transaction search indexing percentage
    const indexingRule = new cr.AwsCustomResource(this, "IndexingRule", {
      onCreate: {
        service: "XRay",
        action: "UpdateIndexingRule",
        parameters: {
          Name: "Default",
          Rule: { Probabilistic: { DesiredSamplingPercentage: 100 } },
        },
        physicalResourceId: cr.PhysicalResourceId.of("xray-indexing-rule"),
      },
      onUpdate: {
        service: "XRay",
        action: "UpdateIndexingRule",
        parameters: {
          Name: "Default",
          Rule: { Probabilistic: { DesiredSamplingPercentage: 100 } },
        },
        physicalResourceId: cr.PhysicalResourceId.of("xray-indexing-rule"),
      },
      policy: cr.AwsCustomResourcePolicy.fromStatements([
        new iam.PolicyStatement({
          actions: ["xray:UpdateIndexingRule"],
          resources: ["*"],
        }),
      ]),
    });
    indexingRule.node.addDependency(xrayLogsPolicy);
    indexingRule.node.addDependency(traceDestination);

    // --- Outputs ---

    new CfnOutput(this, "UserPoolId", {
      value: userPool.userPoolId,
    });

    new CfnOutput(this, "UserPoolClientId", {
      value: userPoolClient.userPoolClientId,
    });
  }
}
