const READ_ONLY_CONTEXT_MARKER = "[READ-ONLY MODE ACTIVE]";

export function buildReadOnlyPrompt() {
	return `${READ_ONLY_CONTEXT_MARKER}
# Read-Only Mode

You are in Read-Only Mode. You may inspect files, search the repository, and run read-only shell commands, but you must not modify anything.

If the user asks you to implement or change something, describe what you found and what the change would involve, then ask the user to exit Read-Only Mode (e.g. /read-only) before any mutation. Never perform the change yourself.`;
}
