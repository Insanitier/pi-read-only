import type {
	ExtensionAPI,
	ExtensionContext,
	ToolInfo,
} from "@earendil-works/pi-coding-agent";
import { showReadOnlyMenu } from "./menu.js";
import { buildReadOnlyPrompt } from "./prompt.js";
import { STATE_ENTRY_TYPE, restoreReadOnlyState, type ReadOnlyState } from "./state.js";
import {
	canSelectToolInPlanMode,
	classifyPlanModeTool,
	findBlockedCommandSegment,
	isBuiltinTool,
	readCommand,
	SAFE_BUILTIN_PLAN_TOOLS,
} from "./tool-policy.js";

const STATUS_KEY = "pi-read-only";
const WIDGET_KEY = "pi-read-only-status";
const BLOCKED_BUILTIN_TOOLS = new Set(["edit", "write"]);
const DEFAULT_TOOLS = ["read", "bash", "edit", "write"];

export default function readOnlyMode(pi: ExtensionAPI) {
	let state: ReadOnlyState = { enabled: false };
	let previousTools: string[] | undefined;
	let menuGeneration = 0;
	let menuController = new AbortController();

	const persistState = () => pi.appendEntry<ReadOnlyState>(STATE_ENTRY_TYPE, state);

	const captureMenuLifecycle = () => {
		const generation = menuGeneration;
		const controller = menuController;
		return {
			signal: controller.signal,
			isCurrent: () => generation === menuGeneration && !controller.signal.aborted,
		};
	};

	pi.registerCommand("read-only", {
		description: "Open the Read-Only mode menu to start/stop the mode or configure its tools",
		handler: async (args, ctx) => {
			if (args.trim()) {
				ctx.ui.notify(
					"/read-only takes no arguments. Open the menu with bare /read-only.",
					"warning",
				);
				return;
			}
			if (!ctx.hasUI) {
				ctx.ui.notify(
					"The /read-only menu requires TUI or RPC mode.",
					"warning",
				);
				return;
			}
			await showMenu(ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		menuGeneration += 1;
		menuController.abort(new DOMException("Read-only session replaced", "AbortError"));
		menuController = new AbortController();
		previousTools = undefined;
		state = restoreReadOnlyState(ctx.sessionManager.getBranch());
		if (state.enabled) {
			applyReadOnlyTools();
			updateUi(ctx);
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		menuGeneration += 1;
		menuController.abort(new DOMException("Read-only session shut down", "AbortError"));
		persistState();
		if (state.enabled) restoreTools();
		clearUi(ctx);
	});

	pi.on("tool_call", async (event) => {
		if (!state.enabled) return;
		if (event.toolName === "update_plan") {
			return {
				block: true,
				reason:
					"Read-only mode blocks update_plan because it tracks execution progress rather than inspection.",
			};
		}
		const calledTool = toolByName(event.toolName);
		if (calledTool && classifyPlanModeTool(calledTool) === "blocked") {
			return {
				block: true,
				reason: `Read-only mode blocks built-in tool '${event.toolName}' because its policy class is blocked.`,
			};
		}
		if (!calledTool && BLOCKED_BUILTIN_TOOLS.has(event.toolName)) {
			return {
				block: true,
				reason: `Read-only mode blocks built-in tool '${event.toolName}' because its metadata is unavailable.`,
			};
		}
		if (event.toolName !== "bash") return;

		const blocked = findBlockedCommandSegment(readCommand(event.input));
		if (blocked !== undefined) {
			return {
				block: true,
				reason: `Read-only mode blocks bash commands outside its reviewed inspection policy.\nBlocked command: ${blocked}`,
			};
		}
		return undefined;
	});

	pi.on("before_agent_start", (event, ctx) => {
		if (!state.enabled) return;
		applyReadOnlyTools();
		updateUi(ctx);
		return {
			systemPrompt: `${event.systemPrompt}\n\n${buildReadOnlyPrompt()}`,
		};
	});

	function startReadOnly(ctx: ExtensionContext) {
		if (state.enabled) {
			ctx.ui.notify("Read-only mode is already active.", "info");
			return;
		}
		menuGeneration += 1;
		previousTools = safeGetActiveTools();
		state = { ...state, enabled: true };
		applyReadOnlyTools();
		persistState();
		updateUi(ctx);
		ctx.ui.notify("Read-only mode enabled. File mutations are blocked until you exit.", "info");
	}

	function stopReadOnly(ctx: ExtensionContext) {
		if (!state.enabled) {
			ctx.ui.notify("Read-only mode is not active.", "info");
			return;
		}
		menuGeneration += 1;
		state = { ...state, enabled: false };
		restoreTools();
		persistState();
		updateUi(ctx);
		ctx.ui.notify("Read-only mode disabled. Full tool access restored.", "info");
	}

	function applyReadOnlyTools() {
		pi.setActiveTools(readOnlyToolNames());
	}

	function readOnlyToolNames() {
		const tools = safeGetAllTools();
		const selectedNames = selectedToolNames(tools);
		return tools
			.filter((tool) => selectedNames.has(tool.name) && canSelectToolInPlanMode(tool))
			.map((tool) => tool.name);
	}

	function selectedToolNames(tools: ToolInfo[]) {
		const stored = state.selectedToolNames;
		if (stored !== undefined) {
			const available = new Set(
				tools
					.filter((tool) => canSelectToolInPlanMode(tool))
					.map((tool) => tool.name),
			);
			return new Set(stored.filter((name) => available.has(name)));
		}
		return new Set(
			tools
				.filter((tool) => isBuiltinTool(tool) && SAFE_BUILTIN_PLAN_TOOLS.has(tool.name))
				.map((tool) => tool.name),
		);
	}

	function setSelectedTools(names: string[]) {
		const tools = safeGetAllTools();
		const available = new Set(
			tools.filter((tool) => canSelectToolInPlanMode(tool)).map((tool) => tool.name),
		);
		state = {
			...state,
			selectedToolNames: Array.from(new Set(names.filter((name) => available.has(name)))),
		};
		persistState();
		if (state.enabled) applyReadOnlyTools();
	}

	function restoreTools() {
		const restoredTools = previousTools ?? DEFAULT_TOOLS;
		pi.setActiveTools(restoredTools);
		previousTools = undefined;
	}

	function toolByName(toolName: string) {
		return safeGetAllTools().find((candidate) => candidate.name === toolName);
	}

	function safeGetActiveTools() {
		try {
			return pi.getActiveTools();
		} catch {
			return DEFAULT_TOOLS;
		}
	}

	function safeGetAllTools() {
		try {
			return pi.getAllTools();
		} catch {
			return [];
		}
	}

	function updateUi(ctx: ExtensionContext) {
		ctx.ui.setStatus(STATUS_KEY, state.enabled ? "read-only active" : undefined);
		ctx.ui.setWidget(
			WIDGET_KEY,
			state.enabled ? ["Read-only mode: active", formatToolSummary()] : undefined,
		);
	}

	function clearUi(ctx: ExtensionContext) {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(WIDGET_KEY, undefined);
	}

	function formatToolSummary() {
		const names = readOnlyToolNames();
		return `Tools: ${names.length > 0 ? names.join(", ") : "none"}`;
	}

	async function showMenu(ctx: ExtensionContext) {
		const lifecycle = captureMenuLifecycle();
		if (!lifecycle.isCurrent() || lifecycle.signal.aborted) return;
		const tools = safeGetAllTools().sort(compareTools);
		await showReadOnlyMenu(ctx, {
			isEnabled: () => state.enabled,
			getSelectedNames: () => selectedToolNames(tools),
			toolSummary: (selectedNames) => {
				const names = tools
					.filter(
						(tool) => selectedNames.has(tool.name) && canSelectToolInPlanMode(tool),
					)
					.map((tool) => tool.name);
				if (names.length === 0) return "When active: no tools";
				if (names.length <= 6) return `When active: ${names.join(", ")}`;
				return `When active: ${names.length} tools — ${names.slice(0, 6).join(", ")}, …`;
			},
			tools: tools.map((tool) => {
				const selectable = canSelectToolInPlanMode(tool);
				const policy = toolPolicyLabel(tool);
				const description = tool.description ?? "No description available";
				const disabledReason = selectable ? undefined : "Blocked by read-only policy";
				return {
					name: tool.name,
					description: `${policy} · ${description}`,
					searchText: [policy, description].join(" "),
					disabled: !selectable,
					...(disabledReason ? { disabledReason } : {}),
				};
			}),
			...lifecycle,
			toggle: (signal) => {
				if (signal.aborted || !lifecycle.isCurrent()) return;
				if (state.enabled) stopReadOnly(ctx);
				else startReadOnly(ctx);
			},
			setTools: (names, signal) => {
				if (signal.aborted || !lifecycle.isCurrent()) return;
				setSelectedTools(names);
				ctx.ui.notify("Read-only tool selection updated.", "info");
			},
		});
	}
}

function compareTools(left: ToolInfo, right: ToolInfo) {
	const leftBuiltin = isBuiltinTool(left);
	const rightBuiltin = isBuiltinTool(right);
	if (leftBuiltin !== rightBuiltin) return leftBuiltin ? -1 : 1;
	return left.name.localeCompare(right.name);
}

function toolPolicyLabel(tool: ToolInfo) {
	const policy = classifyPlanModeTool(tool);
	if (policy === "read-only") return "built-in read-only";
	if (policy === "limited") return "built-in limited";
	if (policy === "blocked") return "built-in blocked";
	return `user opt-in: ${toolSourceLabel(tool)}`;
}

function toolSourceLabel(tool: ToolInfo) {
	const sourceInfo = tool.sourceInfo;
	const source = `${sourceInfo.scope}/${sourceInfo.source}`;
	return sourceInfo.path ? `${source} ${sourceInfo.path}` : source;
}
