/** PiX v2.7.0 tactical JIT routing, cache, and excerpt assertions. */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { searchTactics, extractTacticalSections } from "../extension/tactical-loader.ts";

const root = join(process.cwd(), "skills", "xt", "skills");
const fixtures = [
  ["active-directory-certificate-services", "ADCS ESC1 certificate", "intranet"],
  ["ntlm-relay-coercion", "NTLM PTH lateral", "intranet"],
  ["tunneling-and-pivoting", "tunnel chisel frp", "intranet"],
] as const;
for (const [name, title] of fixtures) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `# ${title}\n## SOP\n\`\`\`sh\necho lab\n\`\`\`\n`, "utf8");
}
try {
  const adcs = searchTactics("ADCS ESC1 certificate", 10);
  if (!adcs.some((e) => e.name === "active-directory-certificate-services")) throw Error("ADCS alias routing failed");
  const ntlm = searchTactics("NTLM PTH lateral", 10);
  if (!ntlm.some((e) => e.name === "ntlm-relay-coercion")) throw Error("NTLM/PTH alias routing failed");
  const tunnel = searchTactics("tunnel chisel frp", 10);
  if (!tunnel.some((e) => e.name === "tunneling-and-pivoting")) throw Error("tunnel alias routing failed");

  const doc = `## Overview\n${"background ".repeat(30)}\n## SOP Attack\n\`\`\`sh\necho safe\n\`\`\`\n${"details ".repeat(500)}\n## Reference\n${"reference ".repeat(30)}`;
  const excerpt = extractTacticalSections(doc, 900);
  if (excerpt.length > 1000 || !excerpt.includes("SOP Attack") || excerpt.includes("## Reference")) throw Error("excerpt priority/budget failed");
  if (searchTactics("ADCS ESC1 certificate", 10) !== adcs) throw Error("query cache reuse failed");
  console.log("v2.7 tactical loader checks passed: aliases, prioritization, slicing, cache.");
} finally {
  rmSync(join(process.cwd(), "skills", "xt"), { recursive: true, force: true });
}
