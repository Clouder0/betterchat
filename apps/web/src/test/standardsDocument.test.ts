import { afterEach, describe, expect, it } from 'bun:test';
import { Window } from 'happy-dom';

import { installTestDom, type TestDomHarness } from '@/test/domHarness';
import { initializeStandardsDocument } from '@/test/standardsDocument';

let dom: TestDomHarness | null = null;

describe('standards document test environment', () => {
	afterEach(() => {
		dom?.cleanup();
		dom = null;
	});

	it('initializes standalone Happy DOM windows into standards mode', () => {
		const window = new Window({
			url: 'http://localhost:3300/',
		});

		expect(window.document.doctype).toBeNull();
		expect((window.document as Document & { compatMode?: string }).compatMode).toBeUndefined();

		initializeStandardsDocument(window);

		expect(window.document.doctype?.name).toBe('html');
		expect((window.document as Document & { compatMode?: string }).compatMode).toBe('CSS1Compat');
		expect(window.document.head).toBeTruthy();
		expect(window.document.body).toBeTruthy();

		window.close();
	});

	it('installs the interactive DOM harness in standards mode', () => {
		dom = installTestDom();

		expect(dom.window.document.doctype?.name).toBe('html');
		expect((dom.window.document as Document & { compatMode?: string }).compatMode).toBe('CSS1Compat');
		expect(document.doctype?.name).toBe('html');
		expect((document as Document & { compatMode?: string }).compatMode).toBe('CSS1Compat');
	});
});
