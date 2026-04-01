import { Window } from 'happy-dom';

const window = new Window({
	url: 'http://localhost:3000',
});

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

