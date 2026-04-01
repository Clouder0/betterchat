export type ClipboardResult =
	| { success: true }
	| { success: false; error: 'permission-denied' | 'not-supported' | 'write-failed'; message: string };

export const copyTextToClipboard = async (text: string): Promise<ClipboardResult> => {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return { success: true };
		}

		// Fallback to execCommand
		const textarea = document.createElement('textarea');
		textarea.value = text;
		textarea.setAttribute('readonly', 'true');
		textarea.style.position = 'absolute';
		textarea.style.left = '-9999px';
		document.body.appendChild(textarea);
		textarea.select();
		const success = document.execCommand('copy');
		document.body.removeChild(textarea);

		if (!success) {
			return {
				success: false,
				error: 'write-failed',
				message: '复制失败：无法访问剪贴板',
			};
		}

		return { success: true };
	} catch (error) {
		// Handle permission-related errors
		if (error instanceof DOMException) {
			if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
				return {
					success: false,
					error: 'permission-denied',
					message: '复制失败：请检查权限设置',
				};
			}
		}

		// Handle all other errors
		return {
			success: false,
			error: 'write-failed',
			message: '复制失败：无法访问剪贴板',
		};
	}
};
