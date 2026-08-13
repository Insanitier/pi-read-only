import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { defineMenu, runMenu } from "@narumitw/pi-tui-kit";

export interface ReadOnlyTool {
	name: string;
	description: string;
	searchText: string;
	disabled: boolean;
	disabledReason?: string;
}

interface ReadOnlyMenuOptions {
	enabled: boolean;
	toolSummary(selectedNames: ReadonlySet<string>): string;
	getSelectedNames(): ReadonlySet<string>;
	tools: readonly ReadOnlyTool[];
	signal: AbortSignal;
	isCurrent(): boolean;
	toggle(signal: AbortSignal): void;
	setTools(toolNames: string[], signal: AbortSignal): void;
}

export async function showReadOnlyMenu(
	ctx: ExtensionContext,
	options: ReadOnlyMenuOptions,
) {
	type Screen = "main" | "tools";
	type Action = "toggle" | "toggle-tool" | "set-tools";
	const selectedNames = new Set(options.getSelectedNames());
	const menu = defineMenu<undefined, Screen, Action, ExtensionContext>({
		start: "main",
		screens: {
			main: () => ({
				kind: "actions",
				title: "Read-only mode",
				lines: [
					options.enabled
						? "Status: Active — file mutations are blocked."
						: "Status: Off — normal tools are active.",
					options.toolSummary(selectedNames),
				],
				items: [
					options.enabled
						? { id: "stop", label: "Stop read-only mode", action: "toggle" }
						: { id: "start", label: "Start read-only mode", action: "toggle" },
					{ id: "tools", label: "Configure read-only tools…", to: "tools" },
				],
				hint: "close",
			}),
			tools: () => ({
				kind: "multiSelect",
				title: "Read-only tools",
				lines: [
					options.enabled
						? "Changes apply immediately."
						: "Changes apply when you start read-only mode.",
					"Non-built-in tools run at user risk.",
				],
				enableSearch: true,
				viewportSize: 10,
				items: options.tools.map((tool) => ({
					id: tool.name,
					label: tool.name,
					description: tool.description,
					searchText: tool.searchText,
					selected: selectedNames.has(tool.name),
					disabled: tool.disabled,
					...(tool.disabledReason ? { disabledReason: tool.disabledReason } : {}),
				})),
				action: "toggle-tool",
				actions: [{ id: "done", label: "Done", action: "set-tools" }],
				hint: "back",
			}),
		},
		actions: {
			toggle: async ({ signal }) => {
				if (signal.aborted || !options.isCurrent()) return { kind: "rejected" };
				options.toggle(signal);
				return { kind: "close" };
			},
			"toggle-tool": async ({ itemId, selected, signal }) => {
				if (signal.aborted || !options.isCurrent()) return { kind: "rejected" };
				const tool = options.tools.find((candidate) => candidate.name === itemId);
				if (!tool || tool.disabled) return { kind: "rejected" };
				if (selected) selectedNames.add(tool.name);
				else selectedNames.delete(tool.name);
				return { kind: "stay" };
			},
			"set-tools": async ({ signal }) => {
				if (signal.aborted || !options.isCurrent()) return { kind: "rejected" };
				options.setTools(Array.from(selectedNames), signal);
				return { kind: "close" };
			},
		},
	});
	await runMenu(ctx, menu, {
		getState: () => undefined,
		signal: options.signal,
		isCurrent: options.isCurrent,
	});
}
