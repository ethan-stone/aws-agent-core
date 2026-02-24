import { Stack, StackProps } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import path from "path";
import * as iam from "aws-cdk-lib/aws-iam";
import * as bedrockAgentCore from "@aws-cdk/aws-bedrock-agentcore-alpha";

export class AgentCoreStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

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
  }
}
