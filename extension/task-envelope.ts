/**
 * task-envelope.ts — 不可变任务信封数据契约与参数序列化引擎 (ADR 0001/0002 & CONTEXT.md)
 *
 * 核心职责：
 * 1. 结构化凭据：作为 Planner 派发给 Worker 子会话的唯一不可变任务载体；
 * 2. 边界约束：内嵌目标端点、HTTP 方法、参数清单、配额上限与安全阻断边界；
 * 3. 不可变性：执行深度冻结 (Object.freeze)，杜绝 Worker 会话内对任务凭据的意外篡改；
 * 4. 刚性校验：提供运行时契约验证与双向确定性序列化。
 */

export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";
export type ModelTier = "FastTier" | "SmartTier";

export interface ProbeQuota {
	readonly maxTurns: number; // 单子会话物理推理轮次硬顶 (默认 ≤ 6)
	readonly timeoutMs: number; // 墙钟时间硬顶 (默认 ≤ 180,000ms / 3分钟)
	readonly maxMutations: number; // 最大允许变异尝试次数 (默认 5)
}

export interface SecurityBoundary {
	readonly forbiddenPaths: readonly string[]; // 绝对禁入的路径黑名单 (如 /api/v1/logout, /reboot)
	readonly allowedHosts: readonly string[]; // 允许发包的 Host 白名单 (防越界外联)
	readonly readOnly: boolean; // 是否处于纯只读探测模式 (禁止写操作/破坏性载荷)
}

export interface TaskEnvelope {
	readonly id: string; // 唯一凭据 ID，格式: env-<timestamp>-<rand>
	readonly endpointId: string; // 关联的 EndpointNode ID
	readonly targetUrl: string; // 目标完整绝对 URL
	readonly httpMethod: HttpMethod; // HTTP 请求方法
	readonly targetHost: string; // 从 URL 提取的规范化目标 Host
	readonly params: readonly string[]; // 目标已知请求参数列表
	readonly probeQuota: ProbeQuota; // 探测物理硬顶与配额
	readonly boundary: SecurityBoundary; // 安全红线与越界围栏
	readonly assignedTier: ModelTier; // 指派的模型档位 (FastTier / SmartTier)
	readonly contextFacts: readonly string[]; // 现场已知背景认知 (如技术栈、WAF 规则、前置指纹)
	readonly createdAt: number; // 任务创建时间戳
}

export interface CreateTaskEnvelopeOptions {
	id?: string;
	endpointId: string;
	targetUrl: string;
	httpMethod?: HttpMethod;
	params?: string[];
	probeQuota?: Partial<ProbeQuota>;
	boundary?: Partial<SecurityBoundary>;
	assignedTier?: ModelTier;
	contextFacts?: string[];
}

/**
 * 递归深度冻结对象，确保 TaskEnvelope 绝对不可变
 */
function deepFreeze<T>(obj: T): Readonly<T> {
	if (obj === null || typeof obj !== "object") {
		return obj;
	}
	Object.freeze(obj);
	for (const key of Object.keys(obj as object)) {
		const val = (obj as Record<string, unknown>)[key];
		if (val !== null && typeof val === "object" && !Object.isFrozen(val)) {
			deepFreeze(val);
		}
	}
	return obj as Readonly<T>;
}

/**
 * 从合法 URL 中解析并归一化 host
 */
function extractHost(rawUrl: string): string {
	try {
		const parsed = new URL(rawUrl);
		return parsed.host.toLowerCase();
	} catch {
		throw new Error(`[TaskEnvelope] 非法的 targetUrl 无法提取 host: ${rawUrl}`);
	}
}

/**
 * 运行时校验 TaskEnvelope 数据契约
 */
export function validateTaskEnvelope(envelope: unknown): { valid: boolean; errors: string[] } {
	const errors: string[] = [];
	if (!envelope || typeof envelope !== "object") {
		return { valid: false, errors: ["TaskEnvelope 必须是非空对象"] };
	}

	const env = envelope as Partial<TaskEnvelope>;

	if (!env.id || typeof env.id !== "string" || !env.id.trim()) {
		errors.push("缺少或无效的 id 字段");
	}
	if (!env.endpointId || typeof env.endpointId !== "string" || !env.endpointId.trim()) {
		errors.push("缺少或无效的 endpointId 字段");
	}
	if (!env.targetUrl || typeof env.targetUrl !== "string") {
		errors.push("缺少或无效的 targetUrl 字段");
	} else {
		try {
			new URL(env.targetUrl);
		} catch {
			errors.push(`targetUrl 格式不合法: ${env.targetUrl}`);
		}
	}

	const validMethods: HttpMethod[] = ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"];
	if (!env.httpMethod || !validMethods.includes(env.httpMethod)) {
		errors.push(`无效的 httpMethod: ${String(env.httpMethod)}`);
	}

		if (!env.targetHost || typeof env.targetHost !== "string") {
			errors.push("缺少或无效的 targetHost 字段");
		} else if (typeof env.targetUrl === "string") {
			try {
				const url = new URL(env.targetUrl);
				if (url.host.toLowerCase() !== env.targetHost.toLowerCase()) errors.push("targetHost 与 targetUrl 不匹配");
				if (!Array.isArray(env.boundary?.allowedHosts) || !env.boundary.allowedHosts.includes(url.host.toLowerCase())) {
					errors.push("targetUrl 的 Host 不在 allowedHosts 白名单内");
				}
				if (Array.isArray(env.boundary?.forbiddenPaths) && env.boundary.forbiddenPaths.some((path) => url.pathname === path || url.pathname.startsWith(`${path.replace(/\/$/, "")}/`))) {
					errors.push("targetUrl 命中 forbiddenPaths 禁止路径");
				}
				if (env.boundary?.readOnly && env.httpMethod && !["GET", "HEAD", "OPTIONS"].includes(env.httpMethod)) {
					errors.push("只读任务仅允许 GET、HEAD 或 OPTIONS");
				}
			} catch {
				// targetUrl validation above reports malformed URLs.
			}
		}

	if (!Array.isArray(env.params)) {
		errors.push("params 必须为字符串数组");
	}

	if (!env.probeQuota || typeof env.probeQuota !== "object") {
		errors.push("缺少 probeQuota 配额对象");
	} else {
		if (!Number.isInteger(env.probeQuota.maxTurns) || env.probeQuota.maxTurns <= 0 || env.probeQuota.maxTurns > 6) {
			errors.push("probeQuota.maxTurns 必须为正整数");
		}
		if (!Number.isInteger(env.probeQuota.timeoutMs) || env.probeQuota.timeoutMs <= 0 || env.probeQuota.timeoutMs > 180000) {
			errors.push("probeQuota.timeoutMs 必须为正整数");
		}
		if (!Number.isInteger(env.probeQuota.maxMutations) || env.probeQuota.maxMutations < 0) {
			errors.push("probeQuota.maxMutations 必须为非负整数");
		}
	}

	if (!env.boundary || typeof env.boundary !== "object") {
		errors.push("缺少 boundary 安全边界对象");
	} else {
		if (!Array.isArray(env.boundary.forbiddenPaths)) {
			errors.push("boundary.forbiddenPaths 必须为字符串数组");
		}
		if (!Array.isArray(env.boundary.allowedHosts)) {
			errors.push("boundary.allowedHosts 必须为字符串数组");
		}
		if (typeof env.boundary.readOnly !== "boolean") {
			errors.push("boundary.readOnly 必须为布尔值");
		}
	}

	const validTiers: ModelTier[] = ["FastTier", "SmartTier"];
	if (!env.assignedTier || !validTiers.includes(env.assignedTier)) {
		errors.push(`无效的 assignedTier: ${String(env.assignedTier)}`);
	}

	if (!Array.isArray(env.contextFacts)) {
		errors.push("contextFacts 必须为字符串数组");
	}

	if (typeof env.createdAt !== "number" || env.createdAt <= 0) {
		errors.push("createdAt 必须为合法时间戳");
	}

	return { valid: errors.length === 0, errors };
}

/**
 * 工厂函数：创建并深度冻结一份规范的 TaskEnvelope 不可变凭据
 */
export function createTaskEnvelope(options: CreateTaskEnvelopeOptions): Readonly<TaskEnvelope> {
	const host = extractHost(options.targetUrl);
	const now = Date.now();
	const envelopeId = options.id ?? `env-${now}-${Math.random().toString(36).substring(2, 8)}`;

	const quota: ProbeQuota = {
		maxTurns: options.probeQuota?.maxTurns ?? 6, // 默认 WatchdogCeiling ≤ 6 轮
		timeoutMs: options.probeQuota?.timeoutMs ?? 180000, // 默认 180s
		maxMutations: options.probeQuota?.maxMutations ?? 5,
	};

	const boundary: SecurityBoundary = {
		forbiddenPaths: options.boundary?.forbiddenPaths ? [...options.boundary.forbiddenPaths] : ["/logout", "/exit"],
		allowedHosts: options.boundary?.allowedHosts ? options.boundary.allowedHosts.map((allowed) => allowed.toLowerCase()) : [host],
		readOnly: options.boundary?.readOnly ?? true,
	};

	const rawEnvelope: TaskEnvelope = {
		id: envelopeId,
		endpointId: options.endpointId,
		targetUrl: options.targetUrl,
		httpMethod: options.httpMethod ?? "GET",
		targetHost: host,
		params: options.params ? [...options.params] : [],
		probeQuota: quota,
		boundary: boundary,
		assignedTier: options.assignedTier ?? "FastTier",
		contextFacts: options.contextFacts ? [...options.contextFacts] : [],
		createdAt: now,
	};

	const check = validateTaskEnvelope(rawEnvelope);
	if (!check.valid) {
		throw new Error(`[TaskEnvelope] 创建失败，契约校验错误: ${check.errors.join("; ")}`);
	}

	return deepFreeze(rawEnvelope);
}

/**
 * 确定性序列化 TaskEnvelope 为 JSON 传输载荷
 */
export function serializeTaskEnvelope(envelope: TaskEnvelope): string {
	const check = validateTaskEnvelope(envelope);
	if (!check.valid) {
		throw new Error(`[TaskEnvelope] 序列化前校验未通过: ${check.errors.join("; ")}`);
	}
	return JSON.stringify(envelope, null, 2);
}

/**
 * 反序列化并重组深冻结的 TaskEnvelope
 */
export function deserializeTaskEnvelope(rawJson: string): Readonly<TaskEnvelope> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawJson);
	} catch (e: unknown) {
		const msg = e instanceof Error ? e.message : String(e);
		throw new Error(`[TaskEnvelope] JSON 反序列化解析失败: ${msg}`);
	}

	const check = validateTaskEnvelope(parsed);
	if (!check.valid) {
		throw new Error(`[TaskEnvelope] 反序列化契约校验失败: ${check.errors.join("; ")}`);
	}

	return deepFreeze(parsed as TaskEnvelope);
}
