import "dotenv/config";
import { listAbbyySkills } from "@/modules/extraction/infrastructure/abbyy-vantage-client";

async function main() {
  const skills = await listAbbyySkills();
  console.log("ABBYY Vantage skills:\n");
  for (const skill of skills) {
    console.log(`- ${skill.name ?? "(no name)"} | type=${skill.type ?? "?"} | id=${skill.id}`);
  }
  console.log("\nSet ABBYY_SKILL_ID in backend/.env to the OCR skill id you want to use.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
