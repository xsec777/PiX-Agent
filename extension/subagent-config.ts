/** Local FastTier selection preference; no host config files, model service calls or persistence. */

export interface SubAgentModelChoice {
	readonly provider: string;
	readonly modelId: string;
}

export interface SubAgentConfig {
	readonly inheritMain: boolean;
	readonly subAgentModel: SubAgentModelChoice | null;
	readonly updatedAt?: number;
}

export class SubAgentModelPreference {
	private inheritMain = true;
	private choice: SubAgentModelChoice | null = null;
	private updatedAt = 0;

	public get(): SubAgentConfig {
		return Object.freeze({
			inheritMain: this.inheritMain,
			subAgentModel: this.choice ? Object.freeze({ ...this.choice }) : null,
			updatedAt: this.updatedAt,
		});
	}

	public set(choice: SubAgentModelChoice | null, now = Date.now()): SubAgentConfig {
		if (choice === null) {
			this.inheritMain = true;
			this.choice = null;
		} else {
			const provider = choice.provider.trim();
			const modelId = choice.modelId.trim();
			if (!provider || !modelId || provider.length > 128 || modelId.length > 256) {
				throw new TypeError("provider and modelId must be non-empty and within length limits");
			}
			this.inheritMain = false;
			this.choice = Object.freeze({ provider, modelId });
		}
		if (!Number.isSafeInteger(now) || now < 0) throw new RangeError("now must be a non-negative safe integer");
		this.updatedAt = now;
		return this.get();
	}

	public reset(): void {
		this.inheritMain = true;
		this.choice = null;
		this.updatedAt = 0;
	}
}

export const globalSubAgentModelPreference = new SubAgentModelPreference();
