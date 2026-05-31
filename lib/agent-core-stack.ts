import { CfnOutput, Duration, Fn, Stack, StackProps } from "aws-cdk-lib/core";
import { Construct } from "constructs";
import path from "path";
import * as iam from "aws-cdk-lib/aws-iam";
import * as apigateway from "aws-cdk-lib/aws-apigateway";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as eventTargets from "aws-cdk-lib/aws-events-targets";
import * as cr from "aws-cdk-lib/custom-resources";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as bedrockAgentCore from "aws-cdk-lib/aws-bedrockagentcore";
import * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

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

    const userPoolDomain = userPool.addDomain("PulseForgeUserPoolDomain", {
      cognitoDomain: {
        domainPrefix: Fn.join("-", ["pulseforge", this.account, this.region]),
      },
    });

    const pulseForgeBackendScopeDefinitions = [
      ["read:devices", "Read PulseForge device records"],
      ["read:incidents", "Read PulseForge incidents"],
      ["read:telemetry", "Read PulseForge telemetry"],
      ["write:incident_events", "Create PulseForge incident activity"],
      ["write:tickets", "Create PulseForge tickets"],
      ["write:remediation_actions", "Create PulseForge remediation proposals"],
      ["write:device_commands", "Execute approved PulseForge device commands"],
    ] as const;
    const pulseForgeBackendScopes = pulseForgeBackendScopeDefinitions.map(
      ([scopeName, scopeDescription]) =>
        new cognito.ResourceServerScope({ scopeName, scopeDescription })
    );

    const pulseForgeBackendResourceServerIdentifier = "pulseforge-backend";
    const pulseForgeBackendResourceServer = userPool.addResourceServer(
      "PulseForgeBackendResourceServer",
      {
        identifier: pulseForgeBackendResourceServerIdentifier,
        userPoolResourceServerName: "PulseForge Backend",
        scopes: pulseForgeBackendScopes,
      }
    );

    const toolsOauthScopes = pulseForgeBackendScopeDefinitions.map(
      ([scopeName]) => `${pulseForgeBackendResourceServerIdentifier}/${scopeName}`
    );
    const toolsResourceServerOauthScopes = pulseForgeBackendScopes.map((scope) =>
      cognito.OAuthScope.resourceServer(pulseForgeBackendResourceServer, scope)
    );

    const pulseForgeToolsUserPoolClient = userPool.addClient(
      "PulseForgeToolsClient",
      {
        generateSecret: true,
        oAuth: {
          flows: {
            authorizationCodeGrant: true,
          },
          scopes: [
            cognito.OAuthScope.OPENID,
            cognito.OAuthScope.EMAIL,
            cognito.OAuthScope.PROFILE,
            ...toolsResourceServerOauthScopes,
          ],
          callbackUrls: ["http://localhost:5173/oauth2/callback"],
          logoutUrls: ["http://localhost:5173/logout"],
        },
        preventUserExistenceErrors: true,
      }
    );

    const pulseForgeToolsProviderName = "pulseforge-backend-user-federation";
    const pulseForgeToolsAuthReturnUrl =
      this.node.tryGetContext("pulseForgeToolsAuthReturnUrl") ??
      "http://localhost:5173/oauth2/callback";
    const pulseForgeToolsOauthProvider =
      new bedrockAgentCore.CfnOAuth2CredentialProvider(
        this,
        "PulseForgeToolsOauthProvider",
        {
          name: pulseForgeToolsProviderName,
          credentialProviderVendor: "CustomOauth2",
          oauth2ProviderConfigInput: {
            customOauth2ProviderConfig: {
              clientId: pulseForgeToolsUserPoolClient.userPoolClientId,
              clientSecret:
                pulseForgeToolsUserPoolClient.userPoolClientSecret.unsafeUnwrap(),
              oauthDiscovery: {
                discoveryUrl: Fn.join("", [
                  "https://cognito-idp.",
                  this.region,
                  ".",
                  this.urlSuffix,
                  "/",
                  userPool.userPoolId,
                  "/.well-known/openid-configuration",
                ]),
              },
            },
          },
        }
      );
    pulseForgeToolsOauthProvider.node.addDependency(
      pulseForgeToolsUserPoolClient
    );
    pulseForgeToolsOauthProvider.node.addDependency(userPoolDomain);

    // AgentCore Identity generates its OAuth callback URL only after the
    // credential provider exists, while Cognito needs that URL on the app
    // client. This custom resource resolves that circular dependency by
    // patching the already-created tools client with the AgentCore callback.
    const updateToolsClientCallback = new cr.AwsCustomResource(
      this,
      "PulseForgeToolsClientCallback",
      {
        onCreate: {
          service: "CognitoIdentityServiceProvider",
          action: "updateUserPoolClient",
          parameters: {
            UserPoolId: userPool.userPoolId,
            ClientId: pulseForgeToolsUserPoolClient.userPoolClientId,
            ClientName: "PulseForgeToolsClient",
            AllowedOAuthFlows: ["code"],
            AllowedOAuthScopes: [
              "openid",
              "email",
              "profile",
              ...toolsOauthScopes,
            ],
            AllowedOAuthFlowsUserPoolClient: true,
            CallbackURLs: [
              pulseForgeToolsAuthReturnUrl,
              pulseForgeToolsOauthProvider.attrCallbackUrl,
            ],
            LogoutURLs: ["http://localhost:5173/logout"],
            SupportedIdentityProviders: ["COGNITO"],
            PreventUserExistenceErrors: "ENABLED",
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            "pulseforge-tools-client-callback"
          ),
        },
        onUpdate: {
          service: "CognitoIdentityServiceProvider",
          action: "updateUserPoolClient",
          parameters: {
            UserPoolId: userPool.userPoolId,
            ClientId: pulseForgeToolsUserPoolClient.userPoolClientId,
            ClientName: "PulseForgeToolsClient",
            AllowedOAuthFlows: ["code"],
            AllowedOAuthScopes: [
              "openid",
              "email",
              "profile",
              ...toolsOauthScopes,
            ],
            AllowedOAuthFlowsUserPoolClient: true,
            CallbackURLs: [
              pulseForgeToolsAuthReturnUrl,
              pulseForgeToolsOauthProvider.attrCallbackUrl,
            ],
            LogoutURLs: ["http://localhost:5173/logout"],
            SupportedIdentityProviders: ["COGNITO"],
            PreventUserExistenceErrors: "ENABLED",
          },
          physicalResourceId: cr.PhysicalResourceId.of(
            "pulseforge-tools-client-callback"
          ),
        },
        policy: cr.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ["cognito-idp:UpdateUserPoolClient"],
            resources: [userPool.userPoolArn],
          }),
        ]),
      }
    );
    updateToolsClientCallback.node.addDependency(pulseForgeToolsOauthProvider);

    const apiStageName = "prod";
    const commonBackendEnvironment: Record<string, string> = {
      API_LOG_LEVEL: "info",
      MONGODB_DB_NAME: "pulseforge",
      COGNITO_REGION: this.region,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_USER_POOL_CLIENT_ID: pulseForgeUserPoolClient.userPoolClientId,
      COGNITO_AGENT_IDENTITY_CLIENT_IDS:
        pulseForgeToolsUserPoolClient.userPoolClientId,
      COGNITO_RESOURCE_SERVER_IDENTIFIER:
        pulseForgeBackendResourceServerIdentifier,
    };
    const pulseForgeSecrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      "PulseForgeSecrets",
      "pulseforge-secrets"
    );

    commonBackendEnvironment.PULSEFORGE_SECRETS_ARN =
      pulseForgeSecrets.secretArn;


    // --- PulseForge Agent Tools API ---
    const pulseForgeToolsApi = new apigateway.RestApi(
      this,
      "PulseForgeToolsApi",
      {
        restApiName: "pulseforge-tools-api",
        deployOptions: {
          stageName: apiStageName,
        },
      }
    );
    const pulseForgeToolsApiUrl = Fn.join("", [
      "https://",
      pulseForgeToolsApi.restApiId,
      ".execute-api.",
      this.region,
      ".",
      this.urlSuffix,
      "/",
      apiStageName,
      "/",
    ]);

    const pulseForgeToolsFunction = new nodejs.NodejsFunction(
      this,
      "PulseForgeToolsFunction",
      {
        entry: path.join(__dirname, "../apps/tools-api/src/index.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: Duration.seconds(30),
        memorySize: 512,
        environment: commonBackendEnvironment,
        bundling: {
          bundleAwsSDK: true,
          target: "node22",
          sourceMap: true,
        },
      }
    );
    pulseForgeSecrets?.grantRead(pulseForgeToolsFunction);

    const toolsIntegration = new apigateway.LambdaIntegration(
      pulseForgeToolsFunction,
      { proxy: true }
    );
    pulseForgeToolsApi.root.addMethod("ANY", toolsIntegration);
    pulseForgeToolsApi.root
      .addResource("{proxy+}")
      .addMethod("ANY", toolsIntegration);

    // --- PulseForge Device Simulator ---
    const pulseForgeSimulatorTickFunction = new nodejs.NodejsFunction(
      this,
      "PulseForgeSimulatorTickFunction",
      {
        entry: path.join(__dirname, "../apps/device-simulator/src/tick-handler.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: Duration.seconds(30),
        memorySize: 512,
        environment: commonBackendEnvironment,
        bundling: {
          bundleAwsSDK: true,
          target: "node22",
          sourceMap: true,
        },
      }
    );
    pulseForgeSecrets.grantRead(pulseForgeSimulatorTickFunction);

    const pulseForgeSimulatorQueueScenarioFunction = new nodejs.NodejsFunction(
      this,
      "PulseForgeSimulatorQueueScenarioFunction",
      {
        entry: path.join(
          __dirname,
          "../apps/device-simulator/src/queue-scenario-handler.ts"
        ),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: Duration.seconds(30),
        memorySize: 512,
        environment: commonBackendEnvironment,
        bundling: {
          bundleAwsSDK: true,
          target: "node22",
          sourceMap: true,
        },
      }
    );
    pulseForgeSecrets.grantRead(pulseForgeSimulatorQueueScenarioFunction);

    new events.Rule(this, "PulseForgeSimulatorTickSchedule", {
      schedule: events.Schedule.rate(Duration.minutes(1)),
      targets: [new eventTargets.LambdaFunction(pulseForgeSimulatorTickFunction)],
    });

    // --- Bedrock AgentCore Runtime ---
    const pulseForgeRuntimeEnvironment: Record<string, string> = {
      PULSEFORGE_RUNTIME_ENV: "aws",
      MEMORY_ID: memory.memoryId,
      MONGODB_DB_NAME: commonBackendEnvironment.MONGODB_DB_NAME,
      PULSEFORGE_SECRETS_ARN: pulseForgeSecrets.secretArn,
      ENABLE_AGENTCORE_LONG_TERM_MEMORY: "false",
      PULSEFORGE_REQUIRE_TOOLS: "true",
      PULSEFORGE_TOOLS_API_URL: pulseForgeToolsApiUrl,
      PULSEFORGE_TOOL_AUTH_MODE: "agentcore-runtime",
      PULSEFORGE_TOOLS_PROVIDER_NAME: pulseForgeToolsProviderName,
      PULSEFORGE_TOOLS_RESOURCE_SERVER_IDENTIFIER:
        pulseForgeBackendResourceServerIdentifier,
      OAUTH_CALLBACK_URL: pulseForgeToolsAuthReturnUrl,
      OTEL_SEMCONV_STABILITY_OPT_IN:
        "gen_ai_latest_experimental,gen_ai_tool_definitions",
      OTEL_TRACES_EXPORTER: "otlp",
      OTEL_TRACES_SAMPLER: "always_on",
      OTEL_SERVICE_NAME: "pulseforge_ops_agent",
      OTEL_BSP_SCHEDULE_DELAY: "100",
    };
    const pulseForgeRuntime = new bedrockAgentCore.Runtime(
      this,
      "PulseForgeAgentRuntime",
      {
        runtimeName: "pulseforge_ops_agent",
        agentRuntimeArtifact: pulseForgeAgentRuntimeArtifact,
        authorizerConfiguration:
          bedrockAgentCore.RuntimeAuthorizerConfiguration.usingIAM(),
        environmentVariables: pulseForgeRuntimeEnvironment,
        tracingEnabled: true,
      }
    );

    pulseForgeSecrets.grantRead(pulseForgeRuntime.role);

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
          "bedrock-agentcore:DeleteEvent",
          "bedrock-agentcore:ListEvents",
          "bedrock-agentcore:RetrieveMemoryRecords",
        ],
        resources: [memory.memoryArn],
      })
    );

    const runtimeWorkloadIdentityArn = Stack.of(this).formatArn({
      service: "bedrock-agentcore",
      resource: "workload-identity-directory/default/workload-identity",
      resourceName: pulseForgeRuntime.agentRuntimeId,
    });

    pulseForgeRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["bedrock-agentcore:GetResourceOauth2Token"],
        resources: [
          `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default/workload-identity/*`,
          pulseForgeToolsOauthProvider.attrCredentialProviderArn,
          `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:workload-identity-directory/default`,
          `arn:${this.partition}:bedrock-agentcore:${this.region}:${this.account}:token-vault/default`,
        ],
      })
    );
    pulseForgeRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/oauth2/${pulseForgeToolsProviderName}*`,
        ],
      })
    );
    memoryKmsKey.grantEncryptDecrypt(pulseForgeRuntime.role);
    pulseForgeRuntime.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "kms:CreateGrant",
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:GenerateDataKey",
          "kms:GenerateDataKeyWithoutPlaintext",
          "kms:ReEncrypt*",
        ],
        resources: [memoryKmsKey.keyArn],
        conditions: {
          StringEquals: {
            "kms:ViaService": `bedrock-agentcore.${this.region}.amazonaws.com`,
          },
        },
      })
    );

    // --- PulseForge Web Backend API ---
    const pulseForgeWebBackendApi = new apigateway.RestApi(
      this,
      "PulseForgeWebBackendApi",
      {
        restApiName: "pulseforge-webbackend",
        endpointTypes: [apigateway.EndpointType.REGIONAL],
        deployOptions: {
          stageName: apiStageName,
        },
      }
    );
    const pulseForgeWebBackendUrl = Fn.join("", [
      "https://",
      pulseForgeWebBackendApi.restApiId,
      ".execute-api.",
      this.region,
      ".",
      this.urlSuffix,
      "/",
      apiStageName,
      "/",
    ]);

    const webBackendEnvironment: Record<string, string> = {
      ...commonBackendEnvironment,
      AGENT_RUNTIME_ARN: pulseForgeRuntime.agentRuntimeArn,
      AGENT_RUNTIME_QUALIFIER: "DEFAULT",
    };

    const pulseForgeWebBackendFunction = new nodejs.NodejsFunction(
      this,
      "PulseForgeWebBackendFunction",
      {
        entry: path.join(__dirname, "../apps/webbackend/src/index.ts"),
        handler: "handler",
        runtime: lambda.Runtime.NODEJS_22_X,
        timeout: Duration.minutes(15),
        memorySize: 512,
        environment: webBackendEnvironment,
        bundling: {
          bundleAwsSDK: true,
          target: "node22",
          sourceMap: true,
        },
      }
    );
    pulseForgeSecrets?.grantRead(pulseForgeWebBackendFunction);
    pulseForgeWebBackendFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "bedrock-agentcore:InvokeAgentRuntime",
          "bedrock-agentcore:InvokeAgentRuntimeForUser",
          "bedrock-agentcore:CompleteResourceTokenAuth",
        ],
        resources: ["*"],
      })
    );
    pulseForgeWebBackendFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [
          `arn:${this.partition}:secretsmanager:${this.region}:${this.account}:secret:bedrock-agentcore-identity!default/oauth2/${pulseForgeToolsProviderName}*`,
        ],
      })
    );

    const webBackendIntegration = new apigateway.LambdaIntegration(
      pulseForgeWebBackendFunction,
      {
        proxy: true,
        responseTransferMode: apigateway.ResponseTransferMode.STREAM,
        timeout: Duration.minutes(15),
      }
    );
    pulseForgeWebBackendApi.root.addMethod("ANY", webBackendIntegration);
    pulseForgeWebBackendApi.root
      .addResource("{proxy+}")
      .addMethod("ANY", webBackendIntegration);

    // --- AgentCore Log Delivery ---
    // Runtime logs and WorkloadIdentity logs are configured as distinct delivery
    // sources because the identity tab is backed by the WorkloadIdentity ARN.
    // We derive short, replacement-safe names from the generated runtime/memory
    // suffixes so a future replacement of those resources can also replace the
    // delivery resources without colliding on fixed custom names.
    const runtimeSuffix = Fn.select(1, Fn.split("-", pulseForgeRuntime.agentRuntimeId));
    const memorySuffix = Fn.select(1, Fn.split("-", memory.memoryId));

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

    // --- Outputs ---

    new CfnOutput(this, "PulseForgeUserPoolId", {
      value: userPool.userPoolId,
    });

    new CfnOutput(this, "PulseForgeUserPoolClientId", {
      value: pulseForgeUserPoolClient.userPoolClientId,
    });

    new CfnOutput(this, "PulseForgeUserPoolDomain", {
      value: userPoolDomain.domainName,
    });

    new CfnOutput(this, "PulseForgeToolsUserPoolClientId", {
      value: pulseForgeToolsUserPoolClient.userPoolClientId,
    });

    new CfnOutput(this, "PulseForgeToolsOauthProviderArn", {
      value: pulseForgeToolsOauthProvider.attrCredentialProviderArn,
    });

    new CfnOutput(this, "PulseForgeBackendResourceServerIdentifier", {
      value: pulseForgeBackendResourceServerIdentifier,
    });

    new CfnOutput(this, "PulseForgeToolsApiUrl", {
      value: pulseForgeToolsApiUrl,
    });

    new CfnOutput(this, "PulseForgeWebBackendApiUrl", {
      value: pulseForgeWebBackendUrl,
    });

    new CfnOutput(this, "PulseForgeSimulatorQueueScenarioFunctionName", {
      value: pulseForgeSimulatorQueueScenarioFunction.functionName,
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
