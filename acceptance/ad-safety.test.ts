import assert from "node:assert/strict";
import { ADSafetyGate } from "../extension/ad-safety.ts";

const gate = new ADSafetyGate();
assert.equal(gate.getMaxAllowedAttempts("example.test"), 0);
assert.equal(gate.canAttempt("example.test", "fixture-user").allowed, false);
assert.throws(() => gate.recordAttempt("example.test", "fixture-user"), /ceiling reached/);
assert.throws(() => gate.getAccountKey("", "fixture-user"), /required/);
assert.throws(() => gate.getAccountKey("example.test", ""), /required/);
assert.throws(() => gate.registerPolicy({ domain: "", lockoutThreshold: 5 }), /required/);
assert.throws(() => gate.registerPolicy({ domain: "example.test", lockoutThreshold: 1.5 }), RangeError);
assert.throws(() => gate.registerPolicy({ domain: "example.test", lockoutThreshold: -1 }), RangeError);
assert.throws(() => gate.registerPolicy({ domain: "example.test", lockoutThreshold: 5, lockoutDurationMinutes: Number.NaN }), RangeError);

for (const threshold of [0, 1, 2]) {
	gate.registerPolicy({ domain: "example.test", lockoutThreshold: threshold, source: "synthetic fixture" });
	assert.equal(gate.getMaxAllowedAttempts("example.test"), 0);
	assert.equal(gate.canAttempt("example.test", "fixture-user").allowed, false);
}

const policy = gate.registerPolicy({
	domain: "EXAMPLE.TEST",
	lockoutThreshold: 5,
	lockoutDurationMinutes: 30,
	observationWindowMinutes: 30,
	source: "synthetic fixture",
});
assert.equal(policy.domain, "example.test");
assert.equal(gate.getMaxAllowedAttempts("example.test"), 3);
policy.lockoutDurationMinutes = 0;
assert.equal(gate.getPolicy("example.test")?.lockoutDurationMinutes, 30);

for (let attempt = 1; attempt <= 3; attempt++) {
	const check = gate.canAttempt("example.test", "Finance_User");
	assert.equal(check.allowed, true);
	assert.equal(check.remainingAttempts, 4 - attempt);
	assert.equal(gate.recordAttempt("EXAMPLE.TEST", "finance_user"), attempt);
}
const blocked = gate.canAttempt("example.test", "FINANCE_USER");
assert.equal(blocked.allowed, false);
assert.equal(blocked.remainingAttempts, 0);
assert.throws(() => gate.recordAttempt("example.test", "finance_user"), /ceiling reached/);
assert.equal(gate.canAttempt("example.test", "other-user").remainingAttempts, 3);

gate.reset();
assert.equal(gate.getPolicy("example.test"), undefined);
assert.equal(gate.canAttempt("example.test", "finance_user").allowed, false);
console.log("AD safety local policy and attempt-accounting checks passed.");
