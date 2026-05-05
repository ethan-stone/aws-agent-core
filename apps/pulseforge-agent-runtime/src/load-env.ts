import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.resolve(currentDir, "..");
const repoRoot = path.resolve(currentDir, "../../..");

dotenv.config({
  path: [path.join(repoRoot, ".env.local"), path.join(runtimeDir, ".env.local")],
  quiet: true,
});
