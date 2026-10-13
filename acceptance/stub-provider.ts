/**
 * 验收专用 stub 模型提供方（不属于交付扩展，仅用于离线驱动真实 agent loop）。
 *
 * - 注册 provider "stub"（模型 stub/stub-model），streamSimple 按 FIFO 脚本队列回放 assistant 回合。
 * - 每次调用把收到的 system prompt（含 pix section）追加写入 STUB_CAPTURE_FILE（JSONL），供断言。
 * - 脚本队列静态声明，驱动端按固定顺序发送 prompt；斜杠命令（/mode /auth /task）
 *   由扩展 handler 处理（handled），不消耗脚本步。
 *
 * M1 参数口径（PiX v2）：失败回读阈值 6；节奏 pent=2000ms / redt=1000ms。
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/compat";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

interface ScriptStep {
	text?: string;
	toolCalls?: Array<{ name: string; arguments: Record<string, unknown> }>;
}

const fail = (direction: string, reason: string): ScriptStep => ({
	toolCalls: [{ name: "record_failure", arguments: { direction, reason } }],
});
const cap = (id: string): ScriptStep => ({
	toolCalls: [{ name: "record_capability", arguments: { capability_id: id, description: `probe ${id}`, evidence: "echo ok" } }],
});

// FIFO 脚本：与 run-acceptance.mjs 的 prompt 顺序一一对应
const SCRIPT: ScriptStep[] = [
	{ text: "ack-pent" }, // 步骤2: /mode pent 后（断言 PENT 段）
	{ text: "ack-redt" }, // 步骤3: /mode redt 后（断言 REDT 段 + 未登记任务书围栏）
	// ---- 步骤4：连续 6 次 record_failure 同方向（阈值 6） ----
	fail("order-query-errorbased", "no visible error echo"),
	fail("order-query-errorbased", "union columns mismatch"),
	fail("order-query-errorbased", "waf blocks single quote"),
	fail("order-query-errorbased", "sleep5 filtered"),
	fail("order-query-errorbased", "error-based extractvalue blocked"),
	fail("order-query-errorbased", "integer context mismatch"),
	{ text: "six failures recorded" }, // 步骤4 结束
	{ text: "ack-reread" }, // 步骤5: 断言 system prompt 含强制回读（≥6）
	{ toolCalls: [{ name: "get_state", arguments: {} }] },
	{ text: "state reported" }, // 步骤6 结束
	{ toolCalls: [{ name: "record_fact", arguments: { type: "finding", label: "order-by-3 reflects data column", tags: ["mysql"], detail: "order by 3 renders column data" } }] },
	{ toolCalls: [{ name: "record_fact", arguments: { type: "hypothesis", label: "union select viable at order-by position", relatedTo: "N1", relation: "leads_to", detail: "falsify if column count mismatch" } }] },
	{ text: "nodes and edge recorded" }, // 步骤7 建节点+连边
	{ toolCalls: [{ name: "get_state", arguments: {} }] },
	{ text: "state2 reported" }, // 步骤7 验证
	{ toolCalls: [{ name: "export_map", arguments: {} }] },
	{ text: "map exported" }, // 步骤8 结束
	// ---- 新增A：/auth 登记后 section 含授权段 ----
	{ text: "auth-turn" },
	// ---- 新增B：/task 登记后 section 含任务书段 ----
	{ text: "task-turn" },
	// ---------- §11 节奏自适应（redt 基准 1s → pent 基准 2s） ----------
	{ toolCalls: [{ name: "get_state", arguments: {} }] },
	{ text: "config reported" }, // 11.1 redt 基准 1000ms
	...Array.from({ length: 10 }, (_, i) => fail("pacing-test", `probe blocked ${i + 1}`)),
	{ text: "ten failures recorded" }, // 11.2 前置：窗口 10 连败
	{ toolCalls: [{ name: "bash", arguments: { command: "echo pacing-probe-all-fail" } }] },
	{ text: "probe1 done" }, // 11.2 计时：期望 ~2s（1s × 2.0）
	{ text: "reflect turn" }, // 11.4a 断言反思指令注入
	...Array.from({ length: 10 }, (_, i) => cap(`P${i + 1}`)),
	{ text: "ten successes recorded" }, // 11.3 前置：窗口 10 连胜
	{ toolCalls: [{ name: "bash", arguments: { command: "echo pacing-probe-all-success" } }] },
	{ text: "probe2 done" }, // 11.3 计时：期望 ~0.5s（1s × 0.5）
	{ text: "reflect2 turn" }, // 11.4b 反断言：连胜后反思消失
	{ toolCalls: [{ name: "get_state", arguments: {} }] },
	{ text: "config2 reported" }, // 11.5a pent 基准 2000ms
	...Array.from({ length: 5 }, (_, i) => fail("pacing-half", `half fail ${i + 1}`)),
	...Array.from({ length: 5 }, (_, i) => cap(`H${i + 1}`)),
	{ text: "half window set" }, // 11.5 前置：5 败 5 胜 → 系数 1
	{ toolCalls: [{ name: "bash", arguments: { command: "echo pacing-probe-pent-base" } }] },
	{ text: "probe3 done" }, // 11.5 计时：期望 ~2s（2s × 1.0）
	{ toolCalls: [{ name: "bash", arguments: { command: "shutdown -h now" } }] },
	{ text: "guardrail checked" }, // 附加A：危险命令被拦截（驱动端自动拒绝 confirm）
	// ---- C2：读卡门禁（未读卡 bash sqlmap → 拦截；读卡后 → 放行） ----
	{ toolCalls: [{ name: "bash", arguments: { command: "sqlmap -u http://example.gov/x?id=1 --batch" } }] },
	{ text: "gate blocked probe" },
	// ---- M2：toolbox 三入口 ----
	{ toolCalls: [{ name: "toolbox", arguments: { action: "list" } }] },
	{ text: "toolbox listed" },
	{ toolCalls: [{ name: "toolbox", arguments: { action: "howto", tool: "sqlmap" } }] },
	{ text: "sqlmap card read" },
	{ toolCalls: [{ name: "bash", arguments: { command: 'python "E:/AProjs/Zcode/PiX/tools/02_Exploit/sqlmap/sqlmap.py" --version --batch' } }] },
	{ text: "gate passed probe" }, // C2：读卡后同族命令放行（真跑 sqlmap --version）
	{ toolCalls: [{ name: "toolbox", arguments: { action: "search", task: "目录爆破" } }] },
	{ text: "dir search done" },
	// ---- M3：画板状态流转 ----
	{ toolCalls: [{ name: "update_node", arguments: { id: "H1", status: "confirmed", note: "union select 回显验证成功" } }] },
	{ text: "h1 confirmed" },
	// ---- M5 前置：tsecbench 未配置引导 ----
	{ toolCalls: [{ name: "tsecbench_challenges", arguments: {} }] },
	{ text: "tsecbench guide shown" },
	{ toolCalls: [{ name: "get_state", arguments: {} }] },
	{ text: "config3 reported" }, // 附加B：switch_session 前读取期望节点/边数
	// ---- C3：传感器（连续拦截/报错 → 止损提醒 + 客观失败入账；外部动作未入账 → 记账提醒） ----
	...Array.from({ length: 5 }, (_, i) => ({
		toolCalls: [{ name: "bash", arguments: { command: `echo "HTTP/1.1 403 Forbidden probe ${i + 1}"` } }],
	})),
	{ text: "blocked streak set" },
	{ toolCalls: [{ name: "get_state", arguments: {} }] },
	{ text: "sensor state reported" },
];

let turn = 0;

function captureDir(): string {
	return process.env.STUB_CAPTURE_DIR ?? process.cwd();
}

export default function (pi: ExtensionAPI) {
	pi.registerProvider("stub", {
		baseUrl: "http://127.0.0.1:9",
		apiKey: "stub-key",
		api: "stub-api",
		models: [
			{
				id: "stub-model",
				name: "Stub Model (acceptance)",
				reasoning: false,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 200000,
				maxTokens: 8192,
			},
		],
		streamSimple: (model, context) => {
			const stream = createAssistantMessageEventStream();
			const step = SCRIPT.shift() ?? { text: "(stub script exhausted)" };
			turn += 1;

			// 捕获 system prompt：按 SystemMessage 协议重放全部 system messages，
			// 得到最终的 pix section（before_agent_start 的 section 更新是后续 system message）
			try {
				let promptText = "";
				const sections: Record<string, string | null> = {};
				for (const m of context.messages as Array<{ role?: string; content?: unknown; sections?: Record<string, string | null> }>) {
					if (m.role !== "system") continue;
					const c = m.content;
					if (typeof c === "string") promptText += c + "\n";
					else if (Array.isArray(c)) promptText += c.map((x) => (x as { text?: string })?.text ?? "").join("\n") + "\n";
					if (m.sections) {
						for (const [k, v] of Object.entries(m.sections)) {
							if (v === null) delete sections[k];
							else sections[k] = v;
						}
					}
				}
				mkdirSync(captureDir(), { recursive: true });
				appendFileSync(
					join(captureDir(), "stub-captures.jsonl"),
					JSON.stringify({ turn, promptText: promptText.slice(-2000), sections }) + "\n",
				);
			} catch {
				// 捕获失败不影响回放
			}

			const base = {
				role: "assistant" as const,
				api: model.api,
				provider: model.provider,
				model: model.id,
				usage: {
					input: 1,
					output: 1,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 2,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				timestamp: Date.now(),
			};

			(async () => {
				if (step.toolCalls?.length) {
					const calls = step.toolCalls.map((tc, i) => ({
						type: "toolCall" as const,
						id: `call_${turn}_${i}`,
						name: tc.name,
						arguments: tc.arguments,
					}));
					const partial: Record<string, unknown> = { ...base, content: [], stopReason: "toolUse" };
					stream.push({ type: "start", partial: partial as never });
					for (let i = 0; i < calls.length; i++) {
						partial.content = calls.slice(0, i);
						stream.push({ type: "toolcall_start", contentIndex: i, partial: partial as never });
						partial.content = calls.slice(0, i + 1);
						stream.push({ type: "toolcall_end", contentIndex: i, toolCall: calls[i], partial: partial as never });
					}
					stream.push({
						type: "done",
						reason: "toolUse",
						message: { ...base, content: calls, stopReason: "toolUse" } as never,
					});
				} else {
					const text = step.text ?? "";
					const partial: Record<string, unknown> = { ...base, content: [{ type: "text", text: "" }], stopReason: "stop" };
					stream.push({ type: "start", partial: partial as never });
					stream.push({ type: "text_start", contentIndex: 0, partial: partial as never });
					(partial.content as Array<{ text: string }>)[0].text = text;
					stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: partial as never });
					stream.push({ type: "text_end", contentIndex: 0, content: text, partial: partial as never });
					stream.push({
						type: "done",
						reason: "stop",
						message: { ...base, content: [{ type: "text", text }], stopReason: "stop" } as never,
					});
				}
				stream.end();
			})();

			return stream;
		},
	});
}
