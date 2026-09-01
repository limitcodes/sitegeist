import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { type Static, Type } from "@earendil-works/pi-ai";
import { Value } from "typebox/value";
import { DOWNLOAD_TOOL_DESCRIPTION } from "../prompts/prompts.js";

const downloadSchema = Type.Object({
	files: Type.Array(
		Type.Object({
			url: Type.String({ description: "HTTP(S) URL to download" }),
			filename: Type.String({
				description: "Path relative to the browser Downloads folder, such as blue/image-01.jpg",
			}),
		}),
		{ minItems: 1, maxItems: 100, description: "Files to download" },
	),
});

type DownloadParams = Static<typeof downloadSchema>;

interface DownloadedFile {
	url: string;
	filename: string;
	downloadId?: number;
	success: boolean;
	error?: string;
}

interface DownloadResult {
	files: DownloadedFile[];
}

function validateFile(url: string, filename: string): void {
	const parsedUrl = new URL(url);
	if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
		throw new Error("Only HTTP(S) URLs can be downloaded");
	}

	const normalized = filename.replaceAll("\\", "/");
	if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
		throw new Error("Filename must be a safe path relative to the Downloads folder");
	}
}

function waitForDownload(downloadId: number, signal?: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		const cleanup = () => {
			chrome.downloads.onChanged.removeListener(onChanged);
			signal?.removeEventListener("abort", onAbort);
		};
		const onAbort = () => {
			cleanup();
			void chrome.downloads.cancel(downloadId);
			reject(new Error("Download aborted"));
		};
		const onChanged = (delta: chrome.downloads.DownloadDelta) => {
			if (delta.id !== downloadId) return;
			if (delta.state?.current === "complete") {
				cleanup();
				resolve();
			} else if (delta.state?.current === "interrupted") {
				cleanup();
				reject(new Error(delta.error?.current || "Download interrupted"));
			}
		};

		chrome.downloads.onChanged.addListener(onChanged);
		signal?.addEventListener("abort", onAbort, { once: true });
		void chrome.downloads.search({ id: downloadId }).then((items) => {
			const item = items[0];
			if (item?.state === "complete") {
				cleanup();
				resolve();
			} else if (item?.state === "interrupted") {
				cleanup();
				reject(new Error(item.error || "Download interrupted"));
			}
		});
	});
}

export class DownloadTool implements AgentTool<typeof downloadSchema, DownloadResult> {
	name = "download";
	label = "Download";
	description = DOWNLOAD_TOOL_DESCRIPTION;
	parameters = downloadSchema;

	async execute(_toolCallId: string, params: unknown, signal?: AbortSignal): Promise<AgentToolResult<DownloadResult>> {
		const args: DownloadParams = Value.Parse(downloadSchema, params);
		const results: DownloadedFile[] = [];

		for (const file of args.files) {
			if (signal?.aborted) throw new Error("Download aborted");
			try {
				validateFile(file.url, file.filename);
				const downloadId = await chrome.downloads.download({
					url: file.url,
					filename: file.filename.replaceAll("\\", "/"),
					conflictAction: "uniquify",
					saveAs: false,
				});
				await waitForDownload(downloadId, signal);
				results.push({ ...file, downloadId, success: true });
			} catch (error) {
				results.push({
					...file,
					success: false,
					error: error instanceof Error ? error.message : String(error),
				});
			}
		}

		const succeeded = results.filter((file) => file.success).length;
		const failed = results.length - succeeded;
		const summary = `Downloaded ${succeeded} of ${results.length} files${failed ? `; ${failed} failed` : ""}.`;
		const failures = results
			.filter((file) => !file.success)
			.map((file) => `${file.filename}: ${file.error}`)
			.join("\n");

		return {
			content: [{ type: "text", text: failures ? `${summary}\n${failures}` : summary }],
			details: { files: results },
		};
	}
}
