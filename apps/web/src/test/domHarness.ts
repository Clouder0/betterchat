import { Window } from 'happy-dom';
import { initializeStandardsDocument } from '@/test/standardsDocument';

type StorageSeed = Record<string, string>;

type ResizeObserverEntryShape = {
	contentRect?: Partial<DOMRectInit>;
	target: Element;
};

type InstalledResizeObserver = {
	callback: ResizeObserverCallback;
	observed: Set<Element>;
};

type StoredGlobalDescriptor = {
	descriptor: PropertyDescriptor | undefined;
	key: string;
};

const defineGlobalValue = (key: string, value: unknown, stored: StoredGlobalDescriptor[]) => {
	stored.push({
		descriptor: Object.getOwnPropertyDescriptor(globalThis, key),
		key,
	});

	Object.defineProperty(globalThis, key, {
		configurable: true,
		writable: true,
		value,
	});
};

const createStorageSeed = (storage: Storage, seed: StorageSeed | undefined) => {
	for (const [key, value] of Object.entries(seed ?? {})) {
		storage.setItem(key, value);
	}
};

const createNotificationStub = (permission: NotificationPermission) =>
	class TestNotification {
		static permission = permission;

		static async requestPermission(): Promise<NotificationPermission> {
			return TestNotification.permission;
		}

		close() {}

		constructor(_title: string, _options?: NotificationOptions) {}
	};

export type TestDomHarness = {
	cleanup: () => void;
	flushAnimationFrames: () => Promise<void>;
	setMatchMedia: (query: string, matches: boolean) => void;
	triggerResizeObservers: (entries?: ResizeObserverEntryShape[]) => void;
	window: Window;
};

export const installTestDom = ({
	localStorageSeed,
	notificationPermission = 'denied',
	sessionStorageSeed,
	url = 'http://localhost:3300/',
	viewport = { height: 900, width: 1440 },
}: {
	localStorageSeed?: StorageSeed;
	notificationPermission?: NotificationPermission;
	sessionStorageSeed?: StorageSeed;
	url?: string;
	viewport?: { height: number; width: number };
} = {}): TestDomHarness => {
	const win = new Window({
		height: viewport.height,
		url,
		width: viewport.width,
	});
	initializeStandardsDocument(win);

	const storedGlobals: StoredGlobalDescriptor[] = [];
	const matchMediaState = new Map<string, boolean>();
	const resizeObservers = new Set<InstalledResizeObserver>();
	let rafQueue: Array<{ callback: FrameRequestCallback; id: number }> = [];
	let nextRafId = 0;
	let rafTimestamp = 0;
	const cancelledRafIds = new Set<number>();

	createStorageSeed(win.localStorage, localStorageSeed);
	createStorageSeed(win.sessionStorage, sessionStorageSeed);

	const matchMedia = (query: string): MediaQueryList => {
		let matches = matchMediaState.get(query) ?? false;
		const listeners = new Set<(event: MediaQueryListEvent) => void>();
		const legacyListeners = new Set<(event: MediaQueryListEvent) => void>();
		const mediaQueryList = {
			get matches() {
				return matches;
			},
			media: query,
			onchange: null,
			addEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
				if (typeof listener === 'function') {
					listeners.add(listener);
				}
			},
			removeEventListener: (_type: string, listener: EventListenerOrEventListenerObject | null) => {
				if (typeof listener === 'function') {
					listeners.delete(listener);
				}
			},
			addListener: (listener: ((event: MediaQueryListEvent) => void) | null) => {
				if (typeof listener === 'function') {
					legacyListeners.add(listener);
				}
			},
			removeListener: (listener: ((event: MediaQueryListEvent) => void) | null) => {
				if (typeof listener === 'function') {
					legacyListeners.delete(listener);
				}
			},
			dispatchEvent: (event: Event) => {
				const mediaEvent = event as unknown as MediaQueryListEvent;
				for (const listener of listeners) {
					listener(mediaEvent);
				}
				for (const listener of legacyListeners) {
					listener(mediaEvent);
				}
				mediaQueryList.onchange?.(mediaEvent);
				return true;
			},
		} as unknown as MediaQueryList;

		Object.defineProperty(mediaQueryList, '__setMatches', {
			configurable: true,
			value(nextMatches: boolean) {
				matches = nextMatches;
				const event = new win.Event('change') as unknown as MediaQueryListEvent;
				Object.defineProperty(event, 'matches', {
					configurable: true,
					value: matches,
				});
				Object.defineProperty(event, 'media', {
					configurable: true,
					value: query,
				});
				mediaQueryList.dispatchEvent(event);
			},
		});

		return mediaQueryList;
	};

	const mediaQueryLists = new Map<string, MediaQueryList>();
	win.matchMedia = (((query: string) => {
		const existing = mediaQueryLists.get(query);
		if (existing) {
			return existing;
		}

		const created = matchMedia(query);
		mediaQueryLists.set(query, created);
		return created;
	}) as unknown) as typeof win.matchMedia;

	class TestResizeObserver {
		readonly #instance: InstalledResizeObserver;

		constructor(callback: ResizeObserverCallback) {
			this.#instance = {
				callback,
				observed: new Set<Element>(),
			};
			resizeObservers.add(this.#instance);
		}

		disconnect() {
			this.#instance.observed.clear();
			resizeObservers.delete(this.#instance);
		}

		observe(target: Element) {
			this.#instance.observed.add(target);
		}

		unobserve(target: Element) {
			this.#instance.observed.delete(target);
		}
	}

	const requestAnimationFrame = (callback: FrameRequestCallback) => {
		const id = nextRafId += 1;
		rafQueue.push({ callback, id });
		return id;
	};

	const cancelAnimationFrame = (id: number) => {
		cancelledRafIds.add(id);
	};

	const NotificationStub = createNotificationStub(notificationPermission);

	Object.defineProperty(win.document, 'visibilityState', {
		configurable: true,
		value: 'visible',
	});
	win.document.hasFocus = () => true;
	win.requestAnimationFrame = (requestAnimationFrame as unknown) as typeof win.requestAnimationFrame;
	win.cancelAnimationFrame = (cancelAnimationFrame as unknown) as typeof win.cancelAnimationFrame;
	(win as unknown as { Notification: typeof NotificationStub }).Notification = NotificationStub;
	(win as unknown as { SyntaxError: typeof SyntaxError }).SyntaxError = globalThis.SyntaxError;
	win.scrollTo = () => {};
	win.HTMLElement.prototype.scrollIntoView = () => {};
	if (!win.HTMLElement.prototype.setPointerCapture) {
		win.HTMLElement.prototype.setPointerCapture = () => {};
	}
	if (!win.HTMLElement.prototype.releasePointerCapture) {
		win.HTMLElement.prototype.releasePointerCapture = () => {};
	}
	if (!win.HTMLElement.prototype.hasPointerCapture) {
		win.HTMLElement.prototype.hasPointerCapture = () => false;
	}

	const globalValues: Array<[string, unknown]> = [
		['window', win],
		['document', win.document],
		['navigator', win.navigator],
		['localStorage', win.localStorage],
		['sessionStorage', win.sessionStorage],
		['Node', win.Node],
		['NodeFilter', win.NodeFilter],
		['Element', win.Element],
		['Text', win.Text],
		['HTMLElement', win.HTMLElement],
		['HTMLInputElement', win.HTMLInputElement],
		['HTMLTextAreaElement', win.HTMLTextAreaElement],
		['HTMLButtonElement', win.HTMLButtonElement],
		['DocumentFragment', win.DocumentFragment],
		['Event', win.Event],
		['CustomEvent', win.CustomEvent],
		['MouseEvent', win.MouseEvent],
		['PointerEvent', win.PointerEvent ?? win.MouseEvent],
		['KeyboardEvent', win.KeyboardEvent],
		['FocusEvent', win.FocusEvent],
		['InputEvent', win.InputEvent ?? win.Event],
		['ClipboardEvent', win.ClipboardEvent ?? win.Event],
		['DragEvent', win.DragEvent ?? win.MouseEvent],
		['MutationObserver', win.MutationObserver],
		['DOMRect', win.DOMRect],
		['File', win.File],
		['Blob', win.Blob],
		['FileReader', win.FileReader],
		['Image', win.Image],
		['URL', win.URL],
		['URLSearchParams', win.URLSearchParams],
		['ResizeObserver', TestResizeObserver],
		['Notification', NotificationStub],
		['requestAnimationFrame', requestAnimationFrame],
		['cancelAnimationFrame', cancelAnimationFrame],
		['getComputedStyle', win.getComputedStyle.bind(win)],
		['performance', win.performance],
		['IS_REACT_ACT_ENVIRONMENT', true],
	];

	for (const [key, value] of globalValues) {
		defineGlobalValue(key, value, storedGlobals);
	}

	return {
		cleanup() {
			rafQueue = [];
			cancelledRafIds.clear();
			resizeObservers.clear();
			for (const { descriptor, key } of storedGlobals.reverse()) {
				if (descriptor) {
					Object.defineProperty(globalThis, key, descriptor);
				} else {
					delete (globalThis as Record<string, unknown>)[key];
				}
			}
			win.close();
		},
		async flushAnimationFrames() {
			while (rafQueue.length > 0) {
				const currentQueue = rafQueue;
				rafQueue = [];
				rafTimestamp += 16;
				for (const entry of currentQueue) {
					if (cancelledRafIds.has(entry.id)) {
						cancelledRafIds.delete(entry.id);
						continue;
					}
					entry.callback(rafTimestamp);
				}
				await Promise.resolve();
			}
		},
		setMatchMedia(query: string, matches: boolean) {
			matchMediaState.set(query, matches);
			const mediaQueryList = mediaQueryLists.get(query) as (MediaQueryList & { __setMatches?: (matches: boolean) => void }) | undefined;
			mediaQueryList?.__setMatches?.(matches);
		},
		triggerResizeObservers(entries = []) {
			for (const observer of resizeObservers) {
				const observedEntries: ResizeObserverEntryShape[] =
					entries.length > 0
						? entries.filter((entry) => observer.observed.has(entry.target))
						: Array.from(observer.observed).map<ResizeObserverEntryShape>((target) => ({ target }));
				if (!observedEntries.length) {
					continue;
				}

				observer.callback(
					observedEntries.map(
						(entry) =>
							({
								borderBoxSize: [],
								contentBoxSize: [],
								contentRect: new win.DOMRect(
									entry.contentRect?.x ?? 0,
									entry.contentRect?.y ?? 0,
									entry.contentRect?.width ?? 0,
									entry.contentRect?.height ?? 0,
								),
								devicePixelContentBoxSize: [],
								target: entry.target,
							}) as ResizeObserverEntry,
					),
					{} as ResizeObserver,
				);
			}
		},
		window: win,
	};
};
