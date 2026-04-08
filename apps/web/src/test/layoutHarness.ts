type ElementBox = {
	bottom?: number;
	clientHeight?: number;
	clientWidth?: number;
	height?: number;
	left?: number;
	offsetHeight?: number;
	offsetTop?: number;
	right?: number;
	scrollHeight?: number;
	scrollLeft?: number;
	scrollTop?: number;
	scrollWidth?: number;
	top?: number;
	width?: number;
};

const defineNumericProperty = (target: object, key: string, value: number | undefined) => {
	if (value === undefined) {
		return;
	}

	Object.defineProperty(target, key, {
		configurable: true,
		get: () => value,
	});
};

export const setElementBox = (element: Element, box: ElementBox) => {
	const width = box.width ?? box.clientWidth ?? 0;
	const height = box.height ?? box.clientHeight ?? 0;
	const top = box.top ?? box.offsetTop ?? 0;
	const left = box.left ?? 0;
	const right = box.right ?? left + width;
	const bottom = box.bottom ?? top + height;

	const domRectLike = {
		bottom,
		height,
		left,
		right,
		toJSON: () => ({
			bottom,
			height,
			left,
			right,
			top,
			width,
			x: left,
			y: top,
		}),
		top,
		width,
		x: left,
		y: top,
	} as DOMRect;

	Object.defineProperty(element, 'getBoundingClientRect', {
		configurable: true,
		value: () => domRectLike,
	});

	defineNumericProperty(element, 'clientHeight', box.clientHeight ?? height);
	defineNumericProperty(element, 'clientWidth', box.clientWidth ?? width);
	defineNumericProperty(element, 'offsetHeight', box.offsetHeight ?? height);
	defineNumericProperty(element, 'offsetTop', box.offsetTop ?? top);
	defineNumericProperty(element, 'scrollHeight', box.scrollHeight ?? height);
	defineNumericProperty(element, 'scrollWidth', box.scrollWidth ?? width);

	const scrollState = {
		left: box.scrollLeft ?? 0,
		top: box.scrollTop ?? 0,
	};

	Object.defineProperty(element, 'scrollLeft', {
		configurable: true,
		get: () => scrollState.left,
		set: (nextLeft: number) => {
			scrollState.left = nextLeft;
		},
	});
	Object.defineProperty(element, 'scrollTop', {
		configurable: true,
		get: () => scrollState.top,
		set: (nextTop: number) => {
			scrollState.top = nextTop;
		},
	});
	Object.defineProperty(element, 'scrollTo', {
		configurable: true,
		value: (optionsOrX?: ScrollToOptions | number, maybeY?: number) => {
			if (typeof optionsOrX === 'number') {
				scrollState.left = optionsOrX;
				scrollState.top = maybeY ?? scrollState.top;
				return;
			}

			if (optionsOrX?.left !== undefined) {
				scrollState.left = optionsOrX.left;
			}
			if (optionsOrX?.top !== undefined) {
				scrollState.top = optionsOrX.top;
			}
		},
	});
};

export const dispatchElementScroll = (element: Element) => {
	element.dispatchEvent(new Event('scroll', { bubbles: true }));
};

export const setSequentialVerticalOffsets = (
	elements: Element[],
	{
		gap = 0,
		startTop = 0,
	}: {
		gap?: number;
		startTop?: number;
	} = {},
) => {
	let currentTop = startTop;

	for (const element of elements) {
		const height = (element as HTMLElement).offsetHeight || (element as HTMLElement).clientHeight || 0;
		setElementBox(element, {
			height,
			offsetTop: currentTop,
			top: currentTop,
			width: (element as HTMLElement).clientWidth || 0,
		});
		currentTop += height + gap;
	}
};

