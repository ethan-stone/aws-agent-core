import path from "node:path";
import dotenv from "dotenv";

const runtimeDir = process.cwd();
const repoRoot = path.resolve(runtimeDir, "../..");

dotenv.config({
  path: [path.join(repoRoot, ".env.local"), path.join(runtimeDir, ".env.local")],
  quiet: true,
});
