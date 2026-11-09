/**
 * artifacts.ts — 石碑式大产物持久化与上下文解耦引擎 (Artifact Store)
 *
 * 核心哲学（借鉴 Sapper-v2 冠军石碑架构与 LuaN1ao）：
 *   “渗透工具原始回显动辄数千行，直接灌入 System Prompt 会迅速引发上下文雪崩与注意力失明”
 *
 * 核心机制：
 * 1. 当 tool_result 文本 > 2048 字节时，自动计算 SHA256 哈希，将完整内容物理下沉至 cwd/.pix/artifacts/；
 * 2. 替换为 3 行高保真语义提要，向模型传递 Artifact 句柄，保证上下文长期紧凑；
 * 3. 注册 get_artifact 工具，供模型在需要深入分析特定输出时精准按行切片读取。
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const ARTIFACT_THRESHOLD = 2048; // 2KB 阈值

export interface ArtifactSaveResult {
	isSaved: boolean;
	artifactPath: string;
	hash: string;
	summaryText: string;
	originalSize: number;
}

export interface ArtifactSliceResult {
	filePath: string;
	totalLines: number;
	offset: number;
	limit: number;
	content: string;
	hasMore: boolean;
}

/** 确保 .pix/artifacts 目录存在 */
function ensureArtifactsDir(): string {
	const dir = join(process.cwd(), ".pix", "artifacts");
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/** 下沉保存大文本产物，并生成 3 行高保真摘要 */
export function saveArtifact(toolName: string, command: string, rawText: string): ArtifactSaveResult {
	if (!rawText || rawText.length <= ARTIFACT_THRESHOLD) {
		return {
			isSaved: false,
			artifactPath: "",
			hash: "",
			summaryText: rawText,
			originalSize: rawText.length,
		};
	}

	const dir = ensureArtifactsDir();
	const hash = createHash("sha256").update(rawText).digest("hex").slice(0, 10);
	const fileName = `art_${hash}.log`;
	const fullPath = join(dir, fileName);
	const relPath = `.pix/artifacts/${fileName}`;

	const lines = rawText.split("\n");
	const header = `=== PiX ARTIFACT: ${fileName} ===\nTool: ${toolName}\nCommand: ${command}\nSavedAt: ${new Date().toISOString()}\nTotalBytes: ${rawText.length}\nTotalLines: ${lines.length}\n========================================\n\n`;

	try {
		writeFileSync(fullPath, header + rawText, "utf8");
	} catch {}

	const sizeKb = (rawText.length / 1024).toFixed(1);
	const headLine = lines.slice(0, 3).map((l) => l.trim()).filter(Boolean).join(" | ").slice(0, 120);
	const tailLine = lines.slice(-2).map((l) => l.trim()).filter(Boolean).join(" | ").slice(0, 100);

	const summaryText =
		`[PiX 石碑归档] 原始物理输出 (${sizeKb} KB，${lines.length} 行) 已下沉持久化至: ${relPath}\n` +
		`[输出提要] 头部: ${headLine}...\n` +
		`[尾部特征] ${tailLine}\n` +
		`(提示: 大输出已下沉解耦以保护工作记忆；如需阅读细节，可调用 get_artifact({ artifactPath: "${relPath}", offset: 0, limit: 50 }))`;

	return {
		isSaved: true,
		artifactPath: relPath,
		hash,
		summaryText,
		originalSize: rawText.length,
	};
}

/** 切片读取大产物文件 */
export function readArtifactSlice(filePath: string, offset = 0, limit = 50): ArtifactSliceResult {
	const cwd = process.cwd();
	const fullPath = filePath.startsWith("/") || filePath.includes(":") ? filePath : join(cwd, filePath);

	if (!existsSync(fullPath)) {
		throw new Error(`产物文件不存在: ${filePath}`);
	}

	const raw = readFileSync(fullPath, "utf8");
	const lines = raw.split("\n");
	const slice = lines.slice(offset, offset + limit);

	return {
		filePath,
		totalLines: lines.length,
		offset,
		limit,
		content: slice.join("\n"),
		hasMore: offset + limit < lines.length,
	};
}
