export type XSetupProblem = 'helper' | 'grok' | 'login';
export function xSetupProblem(error: unknown): XSetupProblem | undefined {
	const code = error instanceof Error ? error.message : String(error);
	if (/grok-missing/.test(code)) return 'grok';
	if (/grok-login-required/.test(code)) return 'login';
	if (/native messaging|native host|helper-upgrade-required|x-helper-missing|未知操作|unknown action|not found|does not exist|forbidden|communicating/i.test(code)) return 'helper';
}
