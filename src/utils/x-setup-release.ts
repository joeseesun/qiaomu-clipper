// Flip published only after the version-matched, signed assets are reachable.
// Development bundles include these installers beside the extension folder.
export const X_HELPER_RELEASE = { version: '1.16.13', published: false,
	repository: 'https://github.com/joeseesun/qiaomu-clipper', tag: 'helper-v1.16.13' };
// Rounded decimal MB from the pinned Grok artifacts and bundled-Python installers.
// These are download estimates, not disk-space or subscription promises.
export function xDownloadSize(os: string, arch: string): { component: number; total: number } {
	const arm = ['arm', 'arm64', 'aarch64'].includes(arch);
	const component = os === 'win' ? (arm ? 134 : 155) : (arm ? 146 : 164);
	return { component, total: component + (os === 'win' ? 16 : 50) };
}
export function xInstaller(os: string, arch: string): { file: string; url?: string } | undefined {
	const file = os === 'mac' ? 'qiaomu-clipper-helper.pkg'
		: os === 'win' && ['x86-64', 'arm', 'arm64', 'aarch64'].includes(arch)
			? `qiaomu-clipper-helper-windows-${arch === 'x86-64' ? 'x64' : 'arm64'}.exe` : undefined;
	return file ? { file, ...(X_HELPER_RELEASE.published ? { url: `${X_HELPER_RELEASE.repository}/releases/download/${X_HELPER_RELEASE.tag}/${file}` } : {}) } : undefined;
}
