import { execFile } from "node:child_process";
import { promisify } from "node:util";
import net from "node:net";

const execFileAsync = promisify(execFile);

export interface MongoTestProcess {
  uri: string;
  stop: () => Promise<void>;
}

export async function startMongoTestProcess(): Promise<MongoTestProcess> {
  const containerName = `pulseforge-mongo-vitest-${Date.now()}-${Math.floor(
    Math.random() * 10_000
  )}`;

  const { stdout: containerIdOutput } = await execFileAsync("docker", [
    "run",
    "-d",
    "--rm",
    "--name",
    containerName,
    "-P",
    "mongo:7.0",
  ]);

  const containerId = containerIdOutput.trim();

  try {
    const port = await waitForPublishedPort(containerName, 20_000);
    await waitForPort(port, 20_000);

    return {
      uri: `mongodb://127.0.0.1:${port}`,
      stop: async () => {
        await execFileAsync("docker", ["stop", containerId]);
      },
    };
  } catch (error) {
    await safeStop(containerId);
    throw error;
  }
}

async function waitForPublishedPort(
  containerName: string,
  timeoutMs: number
): Promise<number> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const { stdout } = await execFileAsync("docker", [
        "port",
        containerName,
        "27017/tcp",
      ]);

      const match = stdout.match(/:(\d+)\s*$/m);
      if (match) {
        return Number(match[1]);
      }
    } catch {
      // Container may not be ready to report ports yet.
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for Docker port mapping for ${containerName}`);
}

async function waitForPort(port: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ port, host: "127.0.0.1" });
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        resolve(false);
      });
    });

    if (connected) {
      return;
    }

    await delay(250);
  }

  throw new Error(`Timed out waiting for MongoDB on port ${port}`);
}

async function safeStop(containerId: string): Promise<void> {
  try {
    await execFileAsync("docker", ["stop", containerId]);
  } catch {
    // Ignore cleanup failures.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
