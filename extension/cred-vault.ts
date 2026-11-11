/**
 * cred-vault.ts — 单目标凭据兼容性分析器 (Credential Scope Compatibility Analyzer)
 *
 * 安全边界：仅分析调用者显式指定的一个 Host 与一个 Credential ID；
 * 不遍历全网、不生成登录/喷洒/横向执行命令、不发起网络连接。
 */

import { getAllCredentials, getAllHosts, type CredentialNode, type HostNode } from "./state.ts";

export interface CredentialCompatibilityResult {
	credentialId: string;
	targetHostId: string;
	targetIp: string | null;
	credentialType: CredentialNode["type"];
	privilegeScope: CredentialNode["privilegeScope"];
	observedOpenPorts: number[];
	compatibleServices: Array<{ protocol: "smb" | "winrm" | "ssh" | "kerberos"; port: number }>;
	withinCredentialScope: boolean;
	analysisOnly: true;
	note: string;
}

/**
 * 仅对显式给出的单个主机和单个凭据做本地数据兼容性判断；不会生成执行命令或连接目标。
 */
export function analyzeCredentialCompatibility(
	targetHostId: string,
	credentialId: string,
): CredentialCompatibilityResult | null {
	const host = getAllHosts().find((item) => item.id === targetHostId);
	const credential = getAllCredentials().find((item) => item.id === credentialId);
	if (!host || !credential) return null;

	const targetIp = host.ips[0] ?? null;
	const withinCredentialScope = credential.validTargets.some((scope) =>
		scope === targetHostId || scope === targetIp || scope === host.hostname || scope === host.domain,
	);
	const observedOpenPorts = host.services.map((service) => service.port);
	const compatibleServices: CredentialCompatibilityResult["compatibleServices"] = [];
	const addIfOpen = (port: number, protocol: CredentialCompatibilityResult["compatibleServices"][number]["protocol"]) => {
		if (observedOpenPorts.includes(port)) compatibleServices.push({ protocol, port });
	};

	addIfOpen(445, "smb");
	addIfOpen(5985, "winrm");
	addIfOpen(22, "ssh");
	addIfOpen(88, "kerberos");

	return {
		credentialId: credential.id,
		targetHostId: host.id,
		targetIp,
		credentialType: credential.type,
		privilegeScope: credential.privilegeScope,
		observedOpenPorts,
		compatibleServices,
		withinCredentialScope,
		analysisOnly: true,
		note: "本结果仅为单目标本地元数据兼容性分析；不验证凭据有效性，不生成命令、不执行认证、不发起连接。仅可在已书面授权范围内人工复核。",
	};
}

/** 保留显式类型导入，方便调用端构造受类型约束的本地测试记录。 */
export type { HostNode };
