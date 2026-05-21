import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { seedDemoData } from "../../../../shared/pulseforge-backend/src/index.js";

dotenv.config({
  path: [
    fileURLToPath(new URL("../../.env.local", import.meta.url)),
    fileURLToPath(new URL("../../.env", import.meta.url)),
  ],
  quiet: true,
});

try {
  await seedDemoData();
  console.log("PulseForge demo data seeded successfully.");
} catch (error) {
  console.error("Failed to seed PulseForge demo data.", error);
  process.exit(1);
}
