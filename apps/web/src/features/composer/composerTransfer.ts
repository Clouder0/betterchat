type TransferFileItem = {
	kind?: string;
	type?: string;
	getAsFile?: () => File | null;
};

type TransferFileCollection = {
	files?: ArrayLike<File> | Iterable<File> | null;
	items?: ArrayLike<TransferFileItem> | Iterable<TransferFileItem> | null;
};

const DEFAULT_PASTED_IMAGE_NAME = 'pasted-image';

const inferImageFileExtension = (mimeType: string) => {
	const normalizedMimeType = mimeType.trim().toLowerCase();
	if (!normalizedMimeType.startsWith('image/')) {
		return 'png';
	}

	const subtype = normalizedMimeType.slice('image/'.length).split('+')[0];
	if (!subtype) {
		return 'png';
	}

	if (subtype === 'jpeg') {
		return 'jpg';
	}

	return subtype;
};

const normalizeTransferImageFile = (file: File) => {
	const fileName = typeof file.name === 'string' ? file.name.trim() : '';
	if (fileName.length > 0) {
		return file;
	}

	const fallbackFileName = `${DEFAULT_PASTED_IMAGE_NAME}.${inferImageFileExtension(file.type)}`;
	return new File([file], fallbackFileName, {
		lastModified: file.lastModified || Date.now(),
		type: file.type || 'image/png',
	});
};

const isImageMimeType = (value: string | null | undefined) => typeof value === 'string' && value.startsWith('image/');

const isImageFile = (file: File | null | undefined): file is File => Boolean(file && isImageMimeType(file.type));

export const hasComposerTransferImageFile = (transferData: TransferFileCollection | null | undefined) => {
	if (!transferData) {
		return false;
	}

	for (const item of Array.from(transferData.items ?? [])) {
		if (item?.kind === 'file' && isImageMimeType(item.type)) {
			return true;
		}
	}

	for (const file of Array.from(transferData.files ?? [])) {
		if (isImageFile(file)) {
			return true;
		}
	}

	return false;
};

export const pickComposerTransferImageFile = (transferData: TransferFileCollection | null | undefined) => {
	if (!transferData) {
		return null;
	}

	for (const item of Array.from(transferData.items ?? [])) {
		if (item?.kind !== 'file' || !isImageMimeType(item.type)) {
			continue;
		}

		const file = item.getAsFile?.() ?? null;
		if (isImageFile(file)) {
			return normalizeTransferImageFile(file);
		}
	}

	for (const file of Array.from(transferData.files ?? [])) {
		if (isImageFile(file)) {
			return normalizeTransferImageFile(file);
		}
	}

	return null;
};
