import { seedDemoData } from "../services/pulseforge-service.js";

try {
  await seedDemoData();
  console.log("PulseForge demo data seeded successfully.");
} catch (error) {
  console.error("Failed to seed PulseForge demo data.", error);
  process.exit(1);
}
