import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { cleanupDemoData } from "../../../../shared/pulseforge-backend/src/index.js";

dotenv.config({
  path: [
    fileURLToPath(new URL("../../.env.local", import.meta.url)),
    fileURLToPath(new URL("../../.env", import.meta.url)),
  ],
  quiet: true,
});

try {
  const result = await cleanupDemoData();
  const total = Object.values(result.deleted).reduce(
    (count, deleted) => count + deleted,
    0
  );

  console.log("PulseForge demo data cleaned up successfully.");
  console.log(`Deleted ${total} records from PulseForge app collections.`);
  console.table(result.deleted);
} catch (error) {
  console.error("Failed to clean up PulseForge demo data.", error);
  process.exit(1);
}
