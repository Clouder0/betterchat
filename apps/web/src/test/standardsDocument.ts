import type { Window } from 'happy-dom';

export const initializeStandardsDocument = (win: Window) => {
	const documentWithCompatMode = win.document as unknown as Document & { compatMode?: string };

	if (!win.document.doctype) {
		win.document.open();
	}

	if (documentWithCompatMode.compatMode !== 'CSS1Compat') {
		Object.defineProperty(documentWithCompatMode, 'compatMode', {
			configurable: true,
			value: 'CSS1Compat',
		});
	}
};
