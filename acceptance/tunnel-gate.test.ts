import assert from "node:assert/strict";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import install from "../extension/index.ts";
import { detectTunnelCommand } from "../extension/tunnel-gate.ts";

// These are inert command strings; no shell or network calls are made.
for (const [command, tool] of [
	["chisel --help", "chisel"],
	["./frpc --version", "frp"],
	["ew --help", "ew"],
	["npc --help", "nps"],
	['& "C:\\Tools\\gost.exe" --help', "gost"],
	["ngrok --help", "ngrok"],
	["ssh -R", "ssh"],
	["ssh -D", "ssh"],
]) {
	assert.equal(detectTunnelCommand(command), tool);
}
assert.equal(detectTunnelCommand("ssh user@example.test"), undefined);
assert.equal(detectTunnelCommand("git status"), undefined);

let toolCall: ((event: unknown, ctx: unknown) => Promise<unknown>) | undefined;
install({
	on(event: string, handler: typeof toolCall) {
		if (event === "tool_call") toolCall = handler;
	},
	registerCommand() {},
	registerTool() {},
} as unknown as ExtensionAPI);
assert.ok(toolCall);
for (const toolName of ["bash", "powershell"]) {
	const event = { toolName, input: { command: "chisel --help", allowTunnel: true } };
	const ctx = { hasUI: true, ui: { confirm: () => assert.fail("tunnel block must precede confirmation") } };
	assert.deepEqual(await toolCall(event, ctx), {
		block: true,
		reason: "【PiX 平台管控·非目标防御】已拦截隧道命令（chisel）。",
	});
}
assert.equal(await toolCall({ toolName: "read", input: { command: "chisel --help" } }, {}), undefined);
console.log("Tunnel recognition and shell hook blocking checks passed.");
