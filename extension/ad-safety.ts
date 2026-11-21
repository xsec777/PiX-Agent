/**
 * ad-safety.ts - local account-attempt accounting from caller-provided policy data.
 *
 * This module does not probe a domain controller, perform authentication, intercept
 * other tools, or guarantee that an account will not be locked. State is process-local.
 */

export interface DomainPasswordPolicy {
	readonly domain: string;
	readonly lockoutThreshold: number | null;
	readonly lockoutDurationMinutes?: number;
	readonly observationWindowMinutes?: number;
	readonly probedAt: number;
	readonly source: string;
}

export interface AttemptCheckResult {
	readonly allowed: boolean;
	readonly accountKey: string;
	readonly attemptsCount: number;
	readonly maxAllowed: number;
	readonly remainingAttempts: number;
	readonly reason?: string;
}

export class ADSafetyGate {
	private policies = new Map<string, DomainPasswordPolicy>();
	private attemptCounter = new Map<string, number>();

	public getAccountKey(domain: string, username: string): string {
		const cleanDomain = domain.trim().toLowerCase();
		const cleanUser = username.trim().toLowerCase();
		if (!cleanDomain || !cleanUser) throw new Error("domain and username are required");
		return `${cleanDomain}\\${cleanUser}`;
	}

	public registerPolicy(params: {
		domain: string;
		lockoutThreshold: number | null;
		lockoutDurationMinutes?: number;
		observationWindowMinutes?: number;
		source?: string;
	}): DomainPasswordPolicy {
		const domain = params.domain.trim().toLowerCase();
		if (!domain) throw new Error("domain is required");
		if (params.lockoutThreshold !== null && (!Number.isInteger(params.lockoutThreshold) || params.lockoutThreshold < 0)) {
			throw new RangeError("lockoutThreshold must be a non-negative integer or null");
		}
		for (const value of [params.lockoutDurationMinutes, params.observationWindowMinutes]) {
			if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
				throw new RangeError("policy durations must be non-negative finite numbers");
			}
		}
		const policy: DomainPasswordPolicy = {
			domain,
			lockoutThreshold: params.lockoutThreshold,
			lockoutDurationMinutes: params.lockoutDurationMinutes,
			observationWindowMinutes: params.observationWindowMinutes,
			probedAt: Date.now(),
			source: params.source?.trim() || "caller-provided",
		};
		this.policies.set(domain, policy);
		return { ...policy };
	}

	/** Returns the local accounting ceiling, not a guarantee that authentication is safe. */
	public getMaxAllowedAttempts(domain: string): number {
		const cleanDomain = domain.trim().toLowerCase();
		if (!cleanDomain) throw new Error("domain is required");
		const threshold = this.policies.get(cleanDomain)?.lockoutThreshold;
		if (threshold === undefined || threshold === null || threshold <= 2) return 0;
		return threshold - 2;
	}

	public canAttempt(domain: string, username: string): AttemptCheckResult {
		const accountKey = this.getAccountKey(domain, username);
		const attemptsCount = this.attemptCounter.get(accountKey) ?? 0;
		const maxAllowed = this.getMaxAllowedAttempts(domain);
		const remainingAttempts = Math.max(0, maxAllowed - attemptsCount);
		if (attemptsCount >= maxAllowed) {
			return {
				allowed: false,
				accountKey,
				attemptsCount,
				maxAllowed,
				remainingAttempts: 0,
				reason: `[ADSafetyGate] local accounting ceiling reached for '${accountKey}' (${attemptsCount}/${maxAllowed}; ${this.getPolicyThresholdText(domain)})`,
			};
		}
		return { allowed: true, accountKey, attemptsCount, maxAllowed, remainingAttempts };
	}

	/** Records a caller-reported attempt; it does not perform authentication. */
	public recordAttempt(domain: string, username: string): number {
		const check = this.canAttempt(domain, username);
		if (!check.allowed) throw new Error(check.reason);
		const next = check.attemptsCount + 1;
		this.attemptCounter.set(check.accountKey, next);
		return next;
	}

	public getPolicy(domain: string): DomainPasswordPolicy | undefined {
		const policy = this.policies.get(domain.trim().toLowerCase());
		return policy ? { ...policy } : undefined;
	}

	public reset(): void {
		this.policies.clear();
		this.attemptCounter.clear();
	}

	private getPolicyThresholdText(domain: string): string {
		const threshold = this.policies.get(domain.trim().toLowerCase())?.lockoutThreshold;
		return threshold === undefined || threshold === null ? "policy unknown" : `threshold ${threshold}`;
	}
}

export const globalADSafetyGate = new ADSafetyGate();
