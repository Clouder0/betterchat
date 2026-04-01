const toPositiveInteger = (value: unknown) => {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return null;
	}

	const normalizedValue = Math.floor(value);
	return normalizedValue > 0 ? normalizedValue : null;
};

export const resolveMaxUploadBytesFromError = (error: unknown) => {
	if (typeof error !== 'object' || error === null || !('details' in error)) {
		return null;
	}

	const details = error.details;
	if (typeof details !== 'object' || details === null || !('maxUploadBytes' in details)) {
		return null;
	}

	return toPositiveInteger(details.maxUploadBytes);
};

export const resolveImageUploadFailureMessage = (error: unknown) => {
	const maxUploadBytes = resolveMaxUploadBytesFromError(error);
	if (!maxUploadBytes) {
		return null;
	}

	return `图片过大，超过后台 ${(maxUploadBytes / (1024 * 1024)).toFixed(1)} MB 上限。当前浏览器不会压缩或转码图片，请调整原图后重试。`;
};
