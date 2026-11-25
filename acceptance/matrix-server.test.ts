import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Writable } from "node:stream";

const scratch = mkdtempSync(join(tmpdir(), "pix-matrix-server-"));
const originalCwd = process.cwd();
process.chdir(scratch);
writeFileSync(join(scratch, "pix-live-matrix.json"), JSON.stringify({
	version: "3.5.2",
	metrics: { totalEndpoints: 2, closedEndpoints: 1, confirmedCount: 1 },
	hosts: [],
	endpoints: [],
	swarm: {
		maxConcurrency: 1,
		activeSlots: 1,
		totalSlots: 4,
		slots: [{ id: "slot-1", status: "running", workerId: "local-fixture", targetHost: "example.test", modelTier: "FastTier", turnCount: 1, elapsedMs: 1, currentAction: "fixture" }],
		hostLocks: [{ host: "example.test", workerId: "local-fixture" }],
		throttle: { state: "cooldown", currentWindow: 1, inCooldown: true },
	},
}), "utf8");

process.once("exit", () => {
	process.chdir(originalCwd);
	rmSync(scratch, { recursive: true, force: true });
});

const url = pathToFileURL(join(originalCwd, "scripts/matrix-server.mjs")).href;
const { createMatrixServer, getMatrixData, watchMatrixFile } = await import(url);
const data = getMatrixData();
assert.equal(data.version, "3.5.2");
assert.equal(data.swarm.activeSlots, 1);
assert.equal(data.swarm.hostLocks[0].host, "example.test");
assert.equal(data.swarm.throttle.state, "cooldown");

const server = createMatrixServer();
assert.equal(server.listening, false, "import must not open a listening socket");
const handler = server.listeners("request")[0] as (req: unknown, res: unknown) => void;
const htmlSource = serverSource();

function serverSource(): string {
	return readFileSync(join(originalCwd, "scripts/matrix-server.mjs"), "utf8");
}

function invoke(method: string, path: string): { status: number; headers: Record<string, string>; body: string } {
	let status = 0;
	const headers: Record<string, string> = {};
	let body = "";
	const req = { method, url: path, headers: { host: "127.0.0.1" }, on() { return this; } };
	const res = new Writable({
		write(chunk, _encoding, callback) { body += chunk.toString(); callback(); },
	});
	Object.assign(res, {
		writeHead(code: number, values: Record<string, string>) { status = code; Object.assign(headers, values); return this; },
		end(text = "") { if (text) body += text; return this; },
	});
	handler(req, res);
	return { status, headers, body };
}

for (const method of ["POST", "PUT", "DELETE", "PATCH"]) {
	const blocked = invoke(method, "/api/matrix");
	assert.equal(blocked.status, 405, `${method} must be rejected`);
	assert.match(blocked.body, /read-only/);
	assert.equal(blocked.headers.Allow, "GET, HEAD, OPTIONS");
}
const snapshot = invoke("GET", "/api/matrix");
assert.equal(snapshot.status, 200);
assert.equal(JSON.parse(snapshot.body).swarm.slots[0].workerId, "local-fixture");
assert.equal(invoke("HEAD", "/api/matrix").status, 200);
assert.equal(invoke("OPTIONS", "/").status, 200);
const page = invoke("GET", "/");
assert.equal(page.status, 200);
assert.ok(page.body.includes("slots-container"));
assert.ok(page.body.includes("textNode"), "snapshot fields must be rendered as text nodes");
assert.match(htmlSource, /"Content-Type":\s*"text\/event-stream"/);
assert.match(htmlSource, /url\.pathname === "\/events"/);
assert.match(htmlSource, /"Access-Control-Allow-Origin":\s*"\*"/);

// A real watcher is created only on explicit start and can be closed without opening a socket.
const stopWatcher = watchMatrixFile();
stopWatcher();
rmSync(join(scratch, "pix-live-matrix.json"));
const idle = getMatrixData();
assert.equal(idle.swarm.totalSlots, 4);
assert.equal(idle.swarm.activeSlots, 0);
assert.equal(idle.swarm.slots.length, 4);
server.close();
console.log("Read-only matrix routes, idle Swarm snapshot, and explicit watcher cleanup passed.");
