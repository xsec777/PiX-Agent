/**
 * model-tiering.ts — 本地 SmartTier / FastTier 配置选择与查询计数 (ADR 0003)
 *
 * 只返回内存配置副本，不读取用户模型配置、不切换宿主模型或调用模型服务。
 * 派发次数是配置查询次数；节约指标使用固定假设，不是实测 Token 或费用。
 */

export type ModelTier = "SmartTier" | "FastTier";

export interface ModelTierConfig {
	readonly tier: ModelTier;
	readonly modelName: string;
	readonly provider?: string;
	readonly temperature?: number;
	readonly maxTokens?: number;
	readonly contextWindow?: number;
}

export interface ModelRouterConfig {
	smartModel?: Partial<ModelTierConfig>;
	fastModel?: Partial<ModelTierConfig>;
}

export interface ModelRouterMetrics {
	smartTierDispatches: number;
	fastTierDispatches: number;
	totalDispatches: number;
	isDualTierActive: boolean;
	estimatedTokenSavingsRatio: number; // 预期 Token 节约率 (0~1)
}

export class ModelRouter {
	private smartConfig: ModelTierConfig;
	private fastConfig: ModelTierConfig;

	private smartDispatches = 0;
	private fastDispatches = 0;

	constructor(config: ModelRouterConfig = {}) {
		const smart = config.smartModel ?? config.fastModel;
		const fast = config.fastModel ?? config.smartModel;
		this.smartConfig = {
			tier: "SmartTier",
			modelName: smart?.modelName ?? "smart-tier-flagship",
			provider: smart?.provider ?? (config.fastModel && !config.smartModel ? "deepseek" : "anthropic"),
			temperature: smart?.temperature ?? 0.2,
			maxTokens: smart?.maxTokens ?? 8192,
			contextWindow: smart?.contextWindow ?? 128000,
		};

		this.fastConfig = {
			tier: "FastTier",
			modelName: fast?.modelName ?? "fast-tier-speed",
			provider: fast?.provider ?? (config.smartModel && !config.fastModel ? "anthropic" : "deepseek"),
			temperature: fast?.temperature ?? 0.1,
			maxTokens: fast?.maxTokens ?? 4096,
			contextWindow: fast?.contextWindow ?? 64000,
		};
	}

	/**
	 * 获取指定档位的模型配置
	 */
	public getModelForTier(tier: ModelTier): ModelTierConfig {
		if (tier === "SmartTier") {
			this.smartDispatches++;
			return { ...this.smartConfig };
		}
		this.fastDispatches++;
		return { ...this.fastConfig };
	}

	/**
	 * 依据角色与当前任务阻抗智能解析适用的模型档位
	 */
	public resolveModelForRole(role: "planner" | "worker", options?: { forceSmartTier?: boolean }): ModelTierConfig {
		if (role === "planner" || options?.forceSmartTier === true) {
			return this.getModelForTier("SmartTier");
		}
		return this.getModelForTier("FastTier");
	}

	/**
	 * 检查当前是否真正配置了两个不同的模型 (双档工作模式)
	 */
	public isDualTierActive(): boolean {
		return this.smartConfig.modelName !== this.fastConfig.modelName || this.smartConfig.provider !== this.fastConfig.provider;
	}

	/**
	 * 动态更新指定档位的模型参数
	 */
	public configureTier(tier: ModelTier, update: Partial<Omit<ModelTierConfig, "tier">>): void {
		if (tier === "SmartTier") {
			this.smartConfig = { ...this.smartConfig, ...update };
		} else {
			this.fastConfig = { ...this.fastConfig, ...update };
		}
	}

	/**
	 * 获取模型路由器的调度指标与 Token 经济学预估
	 */
	public getMetrics(): ModelRouterMetrics {
		const total = this.smartDispatches + this.fastDispatches;
		// 固定 70% 假设仅用于示例计算；不测量真实 Token 或费用。
		const savingsRatio = total === 0 || !this.isDualTierActive() ? 0 : Math.round(((this.fastDispatches * 0.7) / total) * 100) / 100;
		return {
			smartTierDispatches: this.smartDispatches,
			fastTierDispatches: this.fastDispatches,
			totalDispatches: total,
			isDualTierActive: this.isDualTierActive(),
			estimatedTokenSavingsRatio: savingsRatio,
		};
	}

	/**
	 * 重置调度统计 (用于单测或重开战役)
	 */
	public reset(): void {
		this.smartDispatches = 0;
		this.fastDispatches = 0;
	}
}

// 导出全局单例
export const globalModelRouter = new ModelRouter();
