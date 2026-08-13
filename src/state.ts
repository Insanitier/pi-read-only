export const STATE_ENTRY_TYPE = "pi-read-only-state";

export interface ReadOnlyState {
	enabled: boolean;
	selectedToolNames?: string[];
}

type SessionEntry = {
	type?: string;
	customType?: string;
	data?: unknown;
};

/**
 * Restore read-only state from the most recent persisted entry in the session
 * branch, so resume and compaction keep the exact enabled state and tool
 * selection.
 */
export function restoreReadOnlyState(entries: unknown[]): ReadOnlyState {
	const branch = entries as SessionEntry[];
	let entryIndex = -1;
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const candidate = branch[index];
		if (candidate?.type === "custom" && candidate.customType === STATE_ENTRY_TYPE) {
			entryIndex = index;
			break;
		}
	}
	const entry = branch[entryIndex];
	if (!isRecord(entry?.data)) return { enabled: false };
	const result: ReadOnlyState = { enabled: entry.data.enabled === true };
	const selectedToolNames = stringArray(entry.data.selectedToolNames);
	if (selectedToolNames !== undefined) result.selectedToolNames = selectedToolNames;
	return result;
}

function stringArray(value: unknown) {
	return Array.isArray(value) && value.every((item): item is string => typeof item === "string")
		? Array.from(new Set(value))
		: undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
