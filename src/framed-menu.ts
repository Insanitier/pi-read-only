import {
	DynamicBorder,
	getSelectListTheme,
	type ExtensionContext,
	type KeybindingsManager,
	type Theme,
} from "@earendil-works/pi-coding-agent";
import {
	Key,
	matchesKey,
	SelectList,
	truncateToWidth,
	type TUI,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";

export interface ReadOnlyTool {
	name: string;
	description: string;
	searchText: string;
	disabled: boolean;
	disabledReason?: string;
}

export interface ReadOnlyMenuCallbacks {
	isEnabled(): boolean;
	toolSummary(selectedNames: ReadonlySet<string>): string;
	getSelectedNames(): ReadonlySet<string>;
	tools: readonly ReadOnlyTool[];
	toggle(): void;
	setTools(names: string[]): void;
}

/**
 * Read-only menu rendered in pi's built-in selector style: a DynamicBorder
 * top/bottom divider, an accent title, and a SelectList with the built-in
 * theme, shown as a regular (non-overlay) custom component like pi's own
 * /settings and /model selectors.
 */
export async function showReadOnlyMenu(ctx: ExtensionContext, callbacks: ReadOnlyMenuCallbacks) {
	await ctx.ui.custom(
		(tui, theme, keybindings, done) =>
			new ReadOnlyMenuComponent(tui, theme, keybindings, done, callbacks),
	);
}

class ReadOnlyMenuComponent {
	private screen: "main" | "tools" = "main";
	private query = "";
	private selectedNames: Set<string>;
	private list: SelectList;
	private readonly border = new DynamicBorder((text) => this.theme.fg("border", text));

	constructor(
		private readonly tui: TUI,
		private readonly theme: Theme,
		private readonly keybindings: KeybindingsManager,
		private readonly done: (result: unknown) => void,
		private readonly callbacks: ReadOnlyMenuCallbacks,
	) {
		this.selectedNames = new Set(callbacks.getSelectedNames());
		this.list = this.buildList("main");
	}

	render(width: number): string[] {
		const safeWidth = Math.max(1, width);
		const title = this.screen === "main" ? "Read-only mode" : "Read-only tools";
		const lines = [
			...this.border.render(safeWidth),
			...wrapTextWithAnsi(this.theme.fg("accent", this.theme.bold(title)), safeWidth),
			...this.headerLines(),
			"",
			...this.list.render(safeWidth),
			...this.hintLines(),
			...this.border.render(safeWidth),
		];
		return lines.map((line) => truncateToWidth(line, safeWidth, ""));
	}

	invalidate() {
		this.border.invalidate();
		this.list.invalidate();
	}

	handleInput(data: string) {
		if (matchesKey(data, Key.ctrl("c"))) {
			this.done(undefined);
			return;
		}
		if (this.keybindings.matches(data, "tui.select.cancel")) {
			if (this.screen === "tools") this.switchScreen("main");
			else this.done(undefined);
			this.tui.requestRender();
			return;
		}
		if (this.screen === "tools" && !matchesKey(data, Key.enter)) {
			if (matchesKey(data, Key.backspace)) {
				this.query = this.query.slice(0, -1);
				this.list.setFilter(this.query);
				this.tui.requestRender();
				return;
			}
			if (data.length === 1 && data >= " " && data !== "\u007f") {
				this.query += data;
				this.list.setFilter(this.query);
				this.tui.requestRender();
				return;
			}
		}
		this.list.handleInput(data);
		this.tui.requestRender();
	}

	private buildList(screen: "main" | "tools"): SelectList {
		const theme = getSelectListTheme();
		if (screen === "main") {
			const list = new SelectList(
				[
					{
						value: "toggle",
						label: this.callbacks.isEnabled()
							? "Stop read-only mode"
							: "Start read-only mode",
					},
					{ value: "tools", label: "Configure read-only tools…" },
				],
				10,
				theme,
			);
			list.onSelect = (item) => {
				if (item.value === "toggle") {
					this.callbacks.toggle();
					this.list = this.buildList("main");
				} else {
					this.switchScreen("tools");
				}
				this.tui.requestRender();
			};
			return list;
		}
		const list = new SelectList(
			this.callbacks.tools.map((tool) => ({
				value: tool.name,
				label: `${tool.disabled ? "[-]" : this.selectedNames.has(tool.name) ? "[x]" : "[ ]"} ${tool.name}`,
				description: [
					tool.disabled && tool.disabledReason
						? `Unavailable: ${tool.disabledReason}`
						: undefined,
					tool.description,
				]
					.filter((value): value is string => Boolean(value))
					.join(" · "),
			})),
			10,
			theme,
		);
		list.onSelect = (item) => {
			const tool = this.callbacks.tools.find((candidate) => candidate.name === item.value);
			if (!tool || tool.disabled) return;
			if (this.selectedNames.has(tool.name)) this.selectedNames.delete(tool.name);
			else this.selectedNames.add(tool.name);
			this.callbacks.setTools(Array.from(this.selectedNames));
			const restoredIndex = this.filteredToolIndex(item.value);
			this.list = this.buildList("tools");
			this.list.setFilter(this.query);
			this.list.setSelectedIndex(Math.max(0, restoredIndex));
			this.tui.requestRender();
		};
		return list;
	}

	/** Index of a tool inside the filtered list, matching SelectList.setFilter semantics. */
	private filteredToolIndex(name: string) {
		const q = this.query.toLowerCase();
		const filtered = q
			? this.callbacks.tools.filter((tool) => tool.name.toLowerCase().startsWith(q))
			: [...this.callbacks.tools];
		return filtered.findIndex((tool) => tool.name === name);
	}

	private switchScreen(screen: "main" | "tools") {
		this.screen = screen;
		this.query = "";
		this.list = this.buildList(screen);
	}

	private headerLines(): string[] {
		const theme = this.theme;
		if (this.screen === "main") {
			const enabled = this.callbacks.isEnabled();
			return [
				theme.fg(
					"muted",
					enabled
						? "Status: Active — file mutations are blocked."
						: "Status: Off — normal tools are active.",
				),
				theme.fg("muted", this.callbacks.toolSummary(this.selectedNames)),
			];
		}
		return [
			`${theme.fg("muted", "Search: ")}${this.query}${theme.fg("dim", "▏")}`,
			theme.fg(
				"muted",
				"Toggle a tool to apply it immediately; non-built-in tools run at user risk.",
			),
		];
	}

	private hintLines(): string[] {
		const theme = this.theme;
		return [
			theme.fg(
				"dim",
				this.screen === "main"
					? "↑/↓ navigate · enter select · esc close"
					: "Type to filter · enter toggle · esc back",
			),
		];
	}
}
