/** RC2 credential analyzer: one explicit host + credential, metadata only. */
import { recordCredential, recordHost } from "../extension/state.ts";
import { analyzeCredentialCompatibility } from "../extension/cred-vault.ts";

const host = recordHost({
  ips: ["192.0.2.10"],
  hostname: "lab-host.example.test",
  networkScope: "internal",
  services: [{ port: 445, protocol: "tcp" }, { port: 5985, protocol: "tcp" }],
});
const credential = recordCredential({
  account: "lab-user",
  domain: "LAB",
  type: "ntlm_hash",
  value: "TEST_HASH_PLACEHOLDER",
  originHostId: host.id,
  privilegeScope: "local_admin",
  validTargets: [host.id],
});

const result = analyzeCredentialCompatibility(host.id, credential.id);
if (!result) throw new Error("expected a result for the explicitly selected records");
if (!result.analysisOnly || !result.withinCredentialScope) throw new Error("scope and analysis-only flags should be true");
if (result.compatibleServices.length !== 2) throw new Error("expected only the selected host's recorded services");
if ("suggestedCommand" in result || "credentialValue" in result) throw new Error("result must not expose commands or secret value");
if (analyzeCredentialCompatibility("unknown-host", credential.id) !== null) throw new Error("unknown host must return null");
if (analyzeCredentialCompatibility(host.id, "unknown-credential") !== null) throw new Error("unknown credential must return null");

console.log("RC2 single-target scope compatibility assertions passed.");
