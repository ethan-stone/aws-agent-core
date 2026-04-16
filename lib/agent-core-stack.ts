import { CfnOutput, Duration, Fn, Stack, StackProps } from "aws-cdk-lib/core";
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

    const pulseForgeAgentRuntimeArtifact =
      bedrockAgentCore.AgentRuntimeArtifact.fromAsset(
        path.join(__dirname, ".."),
        { file: "apps/pulseforge-agent-runtime/Dockerfile" }
      );

    const memoryKmsKey = new kms.Key(this, "MemoryKmsKey", {
      alias: "pulseforge_memory_kms_key",
    });

    const memory = new bedrockAgentCore.Memory(this, "Memory", {
      memoryName: "pulseforge_memory",
      expirationDuration: Duration.days(7),
      kmsKey: memoryKmsKey,
    });

    // --- Cognito User Pool (inbound auth + outbound identity provider) ---

    const userPool = new cognito.UserPool(this, "AgentCoreIdentityPool", {
      userPoolName: "AgentCoreIdentityPool",
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: {
        email: {
          required: true,
          mutable: true,
        },
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });

    const pulseForgeUserPoolClient = userPool.addClient(
      "PulseForgeWebClient",
      {
        generateSecret: false,
        authFlows: {
          userPassword: true,
          userSrp: true,
        },
        preventUserExistenceErrors: true,
      }
    );

    // --- Bedrock AgentCore Runtime ---

    const pulseForgeRuntime = new bedrockAgentCore.Runtime(
      this,
      "PulseForgeAgentRuntime",
      {
        runtimeName: "pulseforge_ops_agent",
        agentRuntimeArtifact: pulseForgeAgentRuntimeArtifact,
        authorizerConfiguration:
          bedrockAgentCore.RuntimeAuthorizerConfiguration.usingIAM(),
        environmentVariables: {
          MEMORY_ID: memory.memoryId,
        },
      }
    );

    pulseForgeRuntime.addToRolePolicy(
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

    pulseForgeRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:CreateEvent",
          "bedrock-agentcore:ListEvents",
        ],
        resources: [memory.memoryArn],
      })
    );

    memoryKmsKey.grantEncryptDecrypt(pulseForgeRuntime.role);

    // --- AgentCore Log Delivery / Tracing ---
    // Runtime logs and WorkloadIdentity logs are configured as distinct delivery
    // sources because the identity tab is backed by the WorkloadIdentity ARN.
    // We derive short, replacement-safe names from the generated runtime/memory
    // suffixes so a future replacement of those resources can also replace the
    // delivery resources without colliding on fixed custom names.
    const runtimeSuffix = Fn.select(1, Fn.split("-", pulseForgeRuntime.agentRuntimeId));
    const memorySuffix = Fn.select(1, Fn.split("-", memory.memoryId));

    const runtimeWorkloadIdentityArn = Stack.of(this).formatArn({
      service: "bedrock-agentcore",
      resource: "workload-identity-directory/default/workload-identity",
      resourceName: pulseForgeRuntime.agentRuntimeId,
    });

    const runtimeLogGroup = new logs.LogGroup(this, "RuntimeLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const runtimeIdentityLogGroup = new logs.LogGroup(
      this,
      "RuntimeIdentityLogGroup",
      {
        retention: logs.RetentionDays.ONE_WEEK,
      }
    );

    const memoryLogGroup = new logs.LogGroup(this, "MemoryLogGroup", {
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const runtimeLogDestination = new logs.CfnDeliveryDestination(
      this,
      "RuntimeLogDestination",
      {
        name: Fn.join("", ["pf-rtd-", runtimeSuffix]),
        deliveryDestinationType: "CWL",
        destinationResourceArn: runtimeLogGroup.logGroupArn,
      }
    );

    const runtimeIdentityLogDestination = new logs.CfnDeliveryDestination(
      this,
      "RuntimeIdentityLogDestination",
      {
        name: Fn.join("", ["pf-rid-", runtimeSuffix]),
        deliveryDestinationType: "CWL",
        destinationResourceArn: runtimeIdentityLogGroup.logGroupArn,
      }
    );

    const memoryLogDestination = new logs.CfnDeliveryDestination(
      this,
      "MemoryLogDestination",
      {
        name: Fn.join("", ["pf-md-", memorySuffix]),
        deliveryDestinationType: "CWL",
        destinationResourceArn: memoryLogGroup.logGroupArn,
      }
    );

    const xrayDestination = new logs.CfnDeliveryDestination(
      this,
      "XRayDeliveryDestination",
      {
        name: Fn.join("", ["pf-xd-", memorySuffix]),
        deliveryDestinationType: "XRAY",
      }
    );

    const runtimeLogSource = new logs.CfnDeliverySource(
      this,
      "RuntimeLogSource",
      {
        name: Fn.join("", ["pf-rts-", runtimeSuffix]),
        resourceArn: pulseForgeRuntime.agentRuntimeArn,
        logType: "APPLICATION_LOGS",
      }
    );

    const runtimeIdentityLogSource = new logs.CfnDeliverySource(
      this,
      "RuntimeIdentityLogSource",
      {
        name: Fn.join("", ["pf-ris-", runtimeSuffix]),
        resourceArn: runtimeWorkloadIdentityArn,
        logType: "APPLICATION_LOGS",
      }
    );

    const memoryLogSource = new logs.CfnDeliverySource(
      this,
      "MemoryLogSource",
      {
        name: Fn.join("", ["pf-mls-", memorySuffix]),
        resourceArn: memory.memoryArn,
        logType: "APPLICATION_LOGS",
      }
    );

    const memoryTraceSource = new logs.CfnDeliverySource(
      this,
      "MemoryTraceSource",
      {
        name: Fn.join("", ["pf-mts-", memorySuffix]),
        resourceArn: memory.memoryArn,
        logType: "TRACES",
      }
    );

    const runtimeLogDelivery = new logs.CfnDelivery(this, "RuntimeLogDelivery", {
      deliverySourceName: runtimeLogSource.name,
      deliveryDestinationArn: runtimeLogDestination.attrArn,
    });
    runtimeLogDelivery.addDependency(runtimeLogSource);
    runtimeLogDelivery.addDependency(runtimeLogDestination);

    const runtimeIdentityLogDelivery = new logs.CfnDelivery(
      this,
      "RuntimeIdentityLogDelivery",
      {
        deliverySourceName: runtimeIdentityLogSource.name,
        deliveryDestinationArn: runtimeIdentityLogDestination.attrArn,
      }
    );
    runtimeIdentityLogDelivery.addDependency(runtimeIdentityLogSource);
    runtimeIdentityLogDelivery.addDependency(runtimeIdentityLogDestination);

    const memoryLogDelivery = new logs.CfnDelivery(this, "MemoryLogDelivery", {
      deliverySourceName: memoryLogSource.name,
      deliveryDestinationArn: memoryLogDestination.attrArn,
    });
    memoryLogDelivery.addDependency(memoryLogSource);
    memoryLogDelivery.addDependency(memoryLogDestination);

    const memoryTraceDelivery = new logs.CfnDelivery(
      this,
      "MemoryTraceDelivery",
      {
        deliverySourceName: memoryTraceSource.name,
        deliveryDestinationArn: xrayDestination.attrArn,
      }
    );
    memoryTraceDelivery.addDependency(memoryTraceSource);
    memoryTraceDelivery.addDependency(xrayDestination);

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

    new CfnOutput(this, "PulseForgeUserPoolId", {
      value: userPool.userPoolId,
    });

    new CfnOutput(this, "PulseForgeUserPoolClientId", {
      value: pulseForgeUserPoolClient.userPoolClientId,
    });

    new CfnOutput(this, "RuntimeLogGroupName", {
      value: runtimeLogGroup.logGroupName,
    });

    new CfnOutput(this, "RuntimeIdentityLogGroupName", {
      value: runtimeIdentityLogGroup.logGroupName,
    });

    new CfnOutput(this, "MemoryLogGroupName", {
      value: memoryLogGroup.logGroupName,
    });

  }
}
