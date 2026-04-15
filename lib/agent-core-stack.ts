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

    // --- Bedrock AgentCore Runtime (Cognito inbound auth) ---

    const helloWorldRuntime = new bedrockAgentCore.Runtime(
      this,
      "HelloWorldAgentRuntime",
      {
        runtimeName: "hello_world_agent",
        agentRuntimeArtifact: helloWorldAgentRuntimeArtifact,
        authorizerConfiguration:
          bedrockAgentCore.RuntimeAuthorizerConfiguration.usingIAM(),
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

    memoryKmsKey.grantEncryptDecrypt(helloWorldRuntime.role);

    // --- AgentCore Log Delivery / Tracing ---
    // Runtime resources expose observability in two console tabs:
    // - Runtime: runtime application logs
    // - Identity: WorkloadIdentity application logs
    //
    // The Identity tab is backed by a distinct WorkloadIdentity resource ARN, not the
    // runtime ARN itself. The ARN format was verified against the CloudWatch Logs
    // delivery source created by the AgentCore console:
    // arn:aws:bedrock-agentcore:${region}:${account}:workload-identity-directory/default/workload-identity/${agentRuntimeId}
    //
    // Note: Memory tracing uses CloudWatch delivery resources. Runtime tracing is
    // enabled through AgentCore's tracing control plane and publishes spans to
    // aws/spans once Transaction Search is enabled.
    const runtimeWorkloadIdentityArn = Stack.of(this).formatArn({
      service: "bedrock-agentcore",
      resource: "workload-identity-directory/default/workload-identity",
      resourceName: helloWorldRuntime.agentRuntimeId,
    });

    const runtimeLogGroup = new logs.LogGroup(this, "RuntimeLogGroup", {
      logGroupName: `/aws/bedrock-agentcore/runtime/${helloWorldRuntime.agentRuntimeId}`,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const memoryLogGroup = new logs.LogGroup(this, "MemoryLogGroup", {
      logGroupName: `/aws/bedrock-agentcore/memory/${memory.memoryId}`,
      retention: logs.RetentionDays.ONE_WEEK,
    });

    const runtimeIdentityLogGroup = new logs.LogGroup(
      this,
      "RuntimeIdentityLogGroup",
      {
        logGroupName: `/aws/bedrock-agentcore/workload-identity/${helloWorldRuntime.agentRuntimeId}`,
        retention: logs.RetentionDays.ONE_WEEK,
      }
    );

    const runtimeLogDestination = new logs.CfnDeliveryDestination(
      this,
      "RuntimeLogDestination",
      {
        name: `runtime-log-destination-${this.region}`,
        deliveryDestinationType: "CWL",
        destinationResourceArn: runtimeLogGroup.logGroupArn,
      }
    );

    const memoryLogDestination = new logs.CfnDeliveryDestination(
      this,
      "MemoryLogDestination",
      {
        name: `memory-log-destination-${this.region}`,
        deliveryDestinationType: "CWL",
        destinationResourceArn: memoryLogGroup.logGroupArn,
      }
    );

    const runtimeIdentityLogDestination = new logs.CfnDeliveryDestination(
      this,
      "RuntimeIdentityLogDestination",
      {
        name: `runtime-identity-log-destination-${this.region}`,
        deliveryDestinationType: "CWL",
        destinationResourceArn: runtimeIdentityLogGroup.logGroupArn,
      }
    );

    const xrayDestination = new logs.CfnDeliveryDestination(
      this,
      "XRayDeliveryDestination",
      {
        name: `agentcore-xray-destination-${this.region}`,
        deliveryDestinationType: "XRAY",
      }
    );

    const runtimeLogSource = new logs.CfnDeliverySource(
      this,
      "RuntimeLogSource",
      {
        name: `runtime-log-source-${helloWorldRuntime.agentRuntimeId}`,
        resourceArn: helloWorldRuntime.agentRuntimeArn,
        logType: "APPLICATION_LOGS",
      }
    );

    const runtimeIdentityLogSource = new logs.CfnDeliverySource(
      this,
      "RuntimeIdentityLogSource",
      {
        name: `runtime-identity-log-source-${helloWorldRuntime.agentRuntimeId}`,
        resourceArn: runtimeWorkloadIdentityArn,
        logType: "APPLICATION_LOGS",
      }
    );

    const memoryLogSource = new logs.CfnDeliverySource(
      this,
      "MemoryLogSource",
      {
        name: `memory-log-source-${memory.memoryId}`,
        resourceArn: memory.memoryArn,
        logType: "APPLICATION_LOGS",
      }
    );

    const memoryTraceSource = new logs.CfnDeliverySource(
      this,
      "MemoryTraceSource",
      {
        name: `memory-trace-source-${memory.memoryId}`,
        resourceArn: memory.memoryArn,
        logType: "TRACES",
      }
    );

    new logs.CfnDelivery(this, "RuntimeLogDelivery", {
      deliverySourceName: runtimeLogSource.name!,
      deliveryDestinationArn: runtimeLogDestination.attrArn,
    });

    new logs.CfnDelivery(this, "RuntimeIdentityLogDelivery", {
      deliverySourceName: runtimeIdentityLogSource.name!,
      deliveryDestinationArn: runtimeIdentityLogDestination.attrArn,
    });

    new logs.CfnDelivery(this, "MemoryLogDelivery", {
      deliverySourceName: memoryLogSource.name!,
      deliveryDestinationArn: memoryLogDestination.attrArn,
    });

    new logs.CfnDelivery(this, "MemoryTraceDelivery", {
      deliverySourceName: memoryTraceSource.name!,
      deliveryDestinationArn: xrayDestination.attrArn,
    });

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

    new CfnOutput(this, "MemoryLogGroupName", {
      value: memoryLogGroup.logGroupName,
    });

    new CfnOutput(this, "RuntimeIdentityLogGroupName", {
      value: runtimeIdentityLogGroup.logGroupName,
    });
  }
}
