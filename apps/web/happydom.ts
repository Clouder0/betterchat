import { Window } from 'happy-dom';
import { initializeStandardsDocument } from './src/test/standardsDocument';

const window = new Window({
	url: 'http://localhost:3000',
});

initializeStandardsDocument(window);

// @ts-ignore
globalThis.window = window;
// @ts-ignore
globalThis.document = window.document;
// @ts-ignore
globalThis.navigator = window.navigator;
// @ts-ignore
globalThis.HTMLElement = window.HTMLElement;
// @ts-ignore
globalThis.Element = window.Element;
// @ts-ignore
globalThis.Node = window.Node;
// @ts-ignore
globalThis.DOMException = window.DOMException;
// @ts-ignore
globalThis.DocumentFragment = window.DocumentFragment;
// @ts-ignore
globalThis.Text = window.Text;
// @ts-ignore
globalThis.location = window.location;
