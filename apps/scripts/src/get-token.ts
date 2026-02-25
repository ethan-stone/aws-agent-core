import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  DescribeUserPoolClientCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { fromIni } from "@aws-sdk/credential-providers";
import { createHmac } from "crypto";
import { parseArgs } from "util";

const { values } = parseArgs({
  options: {
    "user-pool-id": { type: "string" },
    "client-id": { type: "string" },
    username: { type: "string" },
    password: { type: "string" },
    profile: { type: "string" },
  },
  strict: true,
});

const userPoolId = values["user-pool-id"];
const clientId = values["client-id"];
const username = values.username;
const password = values.password;

if (!userPoolId || !clientId || !username || !password) {
  console.error(
    "Usage: get-token --user-pool-id <id> --client-id <id> --username <user> --password <pass> [--profile <aws-profile>]"
  );
  process.exit(1);
}

const client = new CognitoIdentityProviderClient({
  region: "us-east-1",
  ...(values.profile && {
    credentials: fromIni({ profile: values.profile }),
  }),
});

// Fetch the client secret (required for SECRET_HASH when generateSecret is true)
const describeResponse = await client.send(
  new DescribeUserPoolClientCommand({ UserPoolId: userPoolId, ClientId: clientId })
);
const clientSecret = describeResponse.UserPoolClient?.ClientSecret;
if (!clientSecret) {
  console.error("Error: could not retrieve client secret for the user pool client");
  process.exit(1);
}

const secretHash = createHmac("sha256", clientSecret)
  .update(username + clientId)
  .digest("base64");

try {
  const response = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: "ADMIN_USER_PASSWORD_AUTH",
      AuthParameters: {
        USERNAME: username,
        PASSWORD: password,
        SECRET_HASH: secretHash,
      },
    })
  );

  const result = response.AuthenticationResult;
  if (!result) {
    console.error("Error: no authentication result (challenge may be required)");
    process.exit(1);
  }

  console.log("Access Token:", result.AccessToken);
  console.log("ID Token:", result.IdToken);
  console.log("Expires In:", result.ExpiresIn, "seconds");
} catch (error) {
  if (error instanceof Error) {
    console.error(`Error: ${error.name}: ${error.message}`);
  } else {
    console.error("Error:", error);
  }
  process.exit(1);
}
