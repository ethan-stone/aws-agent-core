import { execFileSync } from "node:child_process";

export function canUseDocker(): boolean {
  if (process.env.PULSEFORGE_SKIP_DOCKER_TESTS === "true") {
    return false;
  }

  try {
    execFileSync("docker", ["info"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}
