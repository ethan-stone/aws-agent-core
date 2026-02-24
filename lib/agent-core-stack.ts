import { Stack, StackProps } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import path from "path";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as cr from "aws-cdk-lib/custom-resources";
import * as bedrockAgentCore from "@aws-cdk/aws-bedrock-agentcore-alpha";

export class AgentCoreStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    // --- Bedrock AgentCore Runtime ---

    const helloWorldAgentRuntimeArtifact =
      bedrockAgentCore.AgentRuntimeArtifact.fromAsset(
        path.join(__dirname, ".."),
        { file: "apps/hello-world/Dockerfile" }
      );

    const helloWorldRuntime = new bedrockAgentCore.Runtime(
      this,
      "HelloWorldAgentRuntime",
      {
        runtimeName: "hello_world_agent",
        agentRuntimeArtifact: helloWorldAgentRuntimeArtifact,
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
  }
}
