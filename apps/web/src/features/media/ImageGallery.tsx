import type PhotoSwipe from 'photoswipe';
import type { DataSourceArray, Padding, Point, PreparedPhotoSwipeOptions, UIElementData } from 'photoswipe';
import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef } from 'react';
import type { FocusEventHandler, KeyboardEvent, KeyboardEventHandler, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import 'photoswipe/style.css';

import {
	formatImageViewerZoomPercent,
	normalizeImageViewerWheelZoomDelta,
	normalizeImageViewerWheelNavigationDelta,
	resolveImageViewerWheelNavigationDirection,
	resolveImageViewerWheelZoomFactor,
} from './imageViewerZoom';
import styles from './ImageGallery.module.css';

type RegisteredGalleryImage = {
	displaySrc: string;
	id: string;
	alt: string;
	viewerSrc: string;
	width?: number;
	height?: number;
	viewerWidth?: number;
	viewerHeight?: number;
	getElement: () => HTMLImageElement | null;
	sequence: number;
};

type ImageGalleryContextValue = {
	openImage: (imageId: string, point?: Point | null) => Promise<void>;
	registerImage: (image: Omit<RegisteredGalleryImage, 'sequence'>) => () => void;
	updateImageSize: (imageId: string, width: number, height: number) => void;
	updateViewerImageSize: (imageId: string, width: number, height: number) => void;
};

type GalleryImageProps = {
	alt?: string;
	className?: string;
	height?: number;
	imageId?: string;
	onFocus?: FocusEventHandler<HTMLImageElement>;
	onKeyDown?: KeyboardEventHandler<HTMLImageElement>;
	src: string;
	tabIndex?: number;
	testId?: string;
	title?: string;
	timelineMessageId?: string;
	viewerHeight?: number;
	viewerSrc?: string;
	viewerWidth?: number;
	width?: number;
};

const LIGHTBOX_CLASS_NAME = 'betterchat-pswp';
const inferredViewerSizeCache = new Map<string, Promise<{ width: number; height: number } | null>>();

const LEFT_CHEVRON_SVG =
	'<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 24 24" width="24" height="24"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>';
const RIGHT_CHEVRON_SVG =
	'<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 24 24" width="24" height="24"><path d="M9.5 5.5L16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>';
const CLOSE_SVG =
	'<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 24 24" width="24" height="24"><path d="M6.5 6.5L17.5 17.5M17.5 6.5L6.5 17.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>';
const ZOOM_SVG =
	'<svg aria-hidden="true" class="pswp__icn" viewBox="0 0 24 24" width="24" height="24"><path d="M12 7.25v9.5M7.25 12h9.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>';

const ImageGalleryContext = createContext<ImageGalleryContextValue | null>(null);

const dockPrevIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M14.5 5.5L8 12l6.5 6.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>';
const dockNextIcon = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M9.5 5.5L16 12l-6.5 6.5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>';
const dockCloseIcon =
	'<svg aria-hidden="true" viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"/></svg>';

const viewportPadding = ({ x, y }: { x: number; y: number }): Padding => {
	const horizontal = x >= 1480 ? 132 : x >= 1120 ? 104 : x >= 820 ? 64 : 18;
	const top = y >= 960 ? 44 : y >= 760 ? 30 : 18;
	const bottom = y >= 960 ? 126 : y >= 760 ? 112 : 88;

	return {
		top,
		right: horizontal,
		bottom,
		left: horizontal,
	};
};

const resolveImageDimensions = (image: RegisteredGalleryImage) => {
	const element = image.getElement();
	const intrinsicWidth = element?.naturalWidth;
	const intrinsicHeight = element?.naturalHeight;
	const renderedWidth = element?.clientWidth;
	const renderedHeight = element?.clientHeight;
	const scale = Math.max(window.devicePixelRatio || 1, 1);

	const width = image.width ?? intrinsicWidth ?? (renderedWidth ? Math.round(renderedWidth * scale) : undefined) ?? 1600;
	const height = image.height ?? intrinsicHeight ?? (renderedHeight ? Math.round(renderedHeight * scale) : undefined) ?? 1200;

	return {
		width: Math.max(width, 1),
		height: Math.max(height, 1),
	};
};

const resolveViewerImageDimensions = (image: RegisteredGalleryImage) => {
	if (image.viewerWidth && image.viewerHeight) {
		return {
			width: Math.max(image.viewerWidth, 1),
			height: Math.max(image.viewerHeight, 1),
		};
	}

	return resolveImageDimensions(image);
};

const inferRemoteImageDimensions = (src: string) => {
	if (typeof window === 'undefined') {
		return Promise.resolve(null);
	}

	const cached = inferredViewerSizeCache.get(src);
	if (cached) {
		return cached;
	}

	const pendingDimensions = new Promise<{ width: number; height: number } | null>((resolve) => {
		const image = new window.Image();
		image.decoding = 'async';
		image.onload = () => {
			const width = image.naturalWidth;
			const height = image.naturalHeight;
			resolve(width > 0 && height > 0 ? { width, height } : null);
		};
		image.onerror = () => resolve(null);
		image.src = src;
	});

	inferredViewerSizeCache.set(src, pendingDimensions);
	return pendingDimensions;
};

const compareImageOrder = (left: RegisteredGalleryImage, right: RegisteredGalleryImage) => {
	const leftElement = left.getElement();
	const rightElement = right.getElement();

	if (!leftElement || !rightElement || leftElement === rightElement) {
		return left.sequence - right.sequence;
	}

	const relation = leftElement.compareDocumentPosition(rightElement);
	if (relation & Node.DOCUMENT_POSITION_FOLLOWING) {
		return -1;
	}

	if (relation & Node.DOCUMENT_POSITION_PRECEDING) {
		return 1;
	}

	return left.sequence - right.sequence;
};

const isRegisteredGalleryImageNavigable = (image: RegisteredGalleryImage) => {
	const element = image.getElement();
	return Boolean(element?.isConnected && !element.closest('[inert]'));
};

const isViewerImageTarget = (target: EventTarget | null): target is Element =>
	target instanceof Element && Boolean(target.closest('.pswp__img'));

const isViewerControlsTarget = (target: EventTarget | null): target is Element =>
	target instanceof Element && Boolean(target.closest(`.${styles.controlsBar}`));

const createControlsDockElement = (): UIElementData => ({
	name: 'betterchatControlsDock',
	appendTo: 'root',
	order: 30,
	className: styles.controlsDock,
	html: `
		<div class="${styles.controlsBar}" role="toolbar" aria-label="图片查看器控件">
			<button type="button" class="${styles.controlButton}" data-action="prev" data-testid="image-viewer-prev" title="上一张图片" aria-label="上一张图片">
				${dockPrevIcon}
			</button>
			<span class="${styles.controlCounter}" data-element="counter" data-testid="image-viewer-counter" aria-live="polite"></span>
			<button type="button" class="${styles.controlButton}" data-action="next" data-testid="image-viewer-next" title="下一张图片" aria-label="下一张图片">
				${dockNextIcon}
			</button>
			<span class="${styles.controlZoom}" data-element="zoom-level" data-testid="image-viewer-zoom-level" aria-live="polite"></span>
			<span class="${styles.controlDivider}" aria-hidden="true"></span>
			<button type="button" class="${styles.controlButton}" data-action="close" data-testid="image-viewer-close" title="关闭图片查看器" aria-label="关闭图片查看器">
				${dockCloseIcon}
			</button>
		</div>
	`,
	onInit: (element, pswp) => {
		const prevButton = element.querySelector<HTMLButtonElement>('[data-action="prev"]');
		const nextButton = element.querySelector<HTMLButtonElement>('[data-action="next"]');
		const closeButton = element.querySelector<HTMLButtonElement>('[data-action="close"]');
		const counter = element.querySelector<HTMLSpanElement>('[data-element="counter"]');
		const zoomLevel = element.querySelector<HTMLSpanElement>('[data-element="zoom-level"]');

		const updateZoomLevel = () => {
			const currentSlide = pswp.currSlide;
			if (!zoomLevel || !currentSlide) {
				return;
			}

			zoomLevel.textContent = formatImageViewerZoomPercent({
				currZoomLevel: currentSlide.currZoomLevel,
				initialZoomLevel: currentSlide.zoomLevels.initial,
			});
		};

		const updateControls = () => {
			const total = pswp.getNumItems();
			if (counter) {
				counter.textContent = `${pswp.currIndex + 1} / ${total}`;
			}

			const atStart = pswp.currIndex <= 0;
			const atEnd = pswp.currIndex >= total - 1;

			if (prevButton) {
				prevButton.disabled = atStart;
			}

			if (nextButton) {
				nextButton.disabled = atEnd;
			}

			element.dataset.single = total <= 1 ? 'true' : 'false';
			updateZoomLevel();
		};

		prevButton?.addEventListener('click', () => pswp.prev());
		nextButton?.addEventListener('click', () => pswp.next());
		closeButton?.addEventListener('click', () => pswp.close());
		pswp.on('change', updateControls);
		pswp.on('zoomPanUpdate', updateZoomLevel);
		pswp.on('resize', updateZoomLevel);
		updateControls();
	},
});

const buildPhotoSwipeOptions = (dataSource: DataSourceArray, index: number, point?: Point | null): Partial<PreparedPhotoSwipeOptions> => ({
	dataSource,
	index,
	initialPointerPos: point ?? null,
	mainClass: LIGHTBOX_CLASS_NAME,
	bgOpacity: 0.9,
	loop: false,
	clickToCloseNonZoomable: false,
	showHideAnimationType: 'none',
	showAnimationDuration: 0,
	hideAnimationDuration: 0,
	zoomAnimationDuration: 0,
	preload: [1, 2],
	arrowKeys: true,
	trapFocus: true,
	returnFocus: true,
	indexIndicatorSep: ' / ',
	errorMsg: '图片暂时无法加载。',
	paddingFn: viewportPadding,
	imageClickAction: false,
	arrowPrev: false,
	arrowNext: false,
	close: false,
	counter: false,
	zoom: false,
	arrowPrevSVG: LEFT_CHEVRON_SVG,
	arrowNextSVG: RIGHT_CHEVRON_SVG,
	closeSVG: CLOSE_SVG,
	zoomSVG: ZOOM_SVG,
	closeTitle: '关闭图片查看器',
	zoomTitle: '缩放图片',
	arrowPrevTitle: '上一张图片',
	arrowNextTitle: '下一张图片',
});

export const TimelineImageGalleryProvider = ({
	children,
	galleryKey,
}: {
	children: ReactNode;
	galleryKey: string;
}) => {
	const imagesRef = useRef(new Map<string, RegisteredGalleryImage>());
	const sequenceRef = useRef(0);
	const activeViewerRef = useRef<PhotoSwipe | null>(null);
	const photoSwipeModulePromiseRef = useRef<Promise<typeof import('photoswipe')> | null>(null);

	const destroyActiveViewer = useCallback(() => {
		activeViewerRef.current?.destroy();
		activeViewerRef.current = null;
	}, []);

	useEffect(
		() => () => {
			destroyActiveViewer();
		},
		[destroyActiveViewer],
	);

	const ensurePhotoSwipeModule = useCallback(async () => {
		if (!photoSwipeModulePromiseRef.current) {
			photoSwipeModulePromiseRef.current = import('photoswipe').catch((error: unknown) => {
				photoSwipeModulePromiseRef.current = null;
				throw error;
			});
		}

		return photoSwipeModulePromiseRef.current;
	}, []);

	const registerImage = useCallback((image: Omit<RegisteredGalleryImage, 'sequence'>) => {
		const registeredImage = {
			...image,
			sequence: imagesRef.current.get(image.id)?.sequence ?? sequenceRef.current++,
		};
		imagesRef.current.set(image.id, registeredImage);

		return () => {
			const currentImage = imagesRef.current.get(image.id);
			if (currentImage?.sequence === registeredImage.sequence) {
				imagesRef.current.delete(image.id);
			}
		};
	}, []);

	const updateImageSize = useCallback((imageId: string, width: number, height: number) => {
		if (!width || !height) {
			return;
		}

		const currentImage = imagesRef.current.get(imageId);
		if (!currentImage) {
			return;
		}

		imagesRef.current.set(imageId, {
			...currentImage,
			width,
			height,
		});
	}, []);

	const updateViewerImageSize = useCallback((imageId: string, width: number, height: number) => {
		if (!width || !height) {
			return;
		}

		const currentImage = imagesRef.current.get(imageId);
		if (!currentImage) {
			return;
		}

		imagesRef.current.set(imageId, {
			...currentImage,
			viewerWidth: width,
			viewerHeight: height,
		});
	}, []);

	const openImage = useCallback(
		async (imageId: string, point?: Point | null) => {
			const orderedImages = [...imagesRef.current.values()]
				.filter((image) => image.id === imageId || isRegisteredGalleryImageNavigable(image))
				.sort(compareImageOrder);
			const targetIndex = orderedImages.findIndex((image) => image.id === imageId);

			if (targetIndex < 0) {
				return;
			}

			const inferredViewerDimensions = await Promise.all(
				orderedImages.map(async (image) => {
					if (image.viewerWidth && image.viewerHeight) {
						return {
							height: image.viewerHeight,
							id: image.id,
							width: image.viewerWidth,
						};
					}

					const inferredDimensions = await inferRemoteImageDimensions(image.viewerSrc);
					if (!inferredDimensions) {
						return null;
					}

					updateViewerImageSize(image.id, inferredDimensions.width, inferredDimensions.height);
					return {
						height: inferredDimensions.height,
						id: image.id,
						width: inferredDimensions.width,
					};
				}),
			);
			const inferredViewerDimensionsById = new Map(
				inferredViewerDimensions
					.filter((dimensions): dimensions is { id: string; width: number; height: number } => Boolean(dimensions))
					.map((dimensions) => [dimensions.id, dimensions]),
			);

			const dataSource: DataSourceArray = orderedImages.map((image) => {
				const inferredDimensions = inferredViewerDimensionsById.get(image.id);
				const { width, height } = inferredDimensions ?? resolveViewerImageDimensions(image);
				return {
					src: image.viewerSrc,
					alt: image.alt,
					width,
					height,
				};
			});

			destroyActiveViewer();
			const module = await ensurePhotoSwipeModule();
			const viewer = new module.default(buildPhotoSwipeOptions(dataSource, targetIndex, point));
			let detachBackdropPointerHandler: (() => void) | null = null;
			let navigationAccumulatorPx = 0;
			let navigationCooldownUntil = 0;
			let lastNavigationDirection: 'next' | 'prev' | null = null;
			let navigationAccumulatorResetTimer: number | null = null;
			let zoomDeltaAccumulator = 0;
			let zoomAnimationFrame: number | null = null;
			let zoomPoint: Point | undefined;
			viewer.on('uiRegister', () => {
				viewer.ui?.registerElement(createControlsDockElement());
			});
			viewer.on('afterInit', () => {
				if (typeof document === 'undefined') {
					return;
				}

				const handleBackdropPointerDown = (event: globalThis.PointerEvent) => {
					if (event.button > 0) {
						return;
					}

					const target = event.target;
					if (isViewerImageTarget(target) || isViewerControlsTarget(target)) {
						return;
					}

					viewer.close();
				};

				document.addEventListener('pointerdown', handleBackdropPointerDown, true);
				detachBackdropPointerHandler = () => {
					document.removeEventListener('pointerdown', handleBackdropPointerDown, true);
				};
			});
			viewer.on('wheel', (event) => {
				const originalEvent = event.originalEvent;

				const flushZoom = () => {
					zoomAnimationFrame = null;
					const currentSlide = viewer.currSlide;
					if (!currentSlide?.isZoomable()) {
						zoomDeltaAccumulator = 0;
						return;
					}

					const factor = resolveImageViewerWheelZoomFactor(zoomDeltaAccumulator);
					zoomDeltaAccumulator = 0;
					if (factor === 1) {
						return;
					}

					currentSlide.zoomTo(currentSlide.currZoomLevel * factor, zoomPoint);
				};

				if (originalEvent.ctrlKey) {
					if (!viewer.currSlide?.isZoomable()) {
						return;
					}

					event.preventDefault();
					navigationAccumulatorPx = 0;
					if (navigationAccumulatorResetTimer !== null) {
						window.clearTimeout(navigationAccumulatorResetTimer);
						navigationAccumulatorResetTimer = null;
					}
					zoomDeltaAccumulator += normalizeImageViewerWheelZoomDelta(originalEvent);
					zoomPoint = {
						x: originalEvent.clientX,
						y: originalEvent.clientY,
					};
					if (zoomAnimationFrame === null) {
						zoomAnimationFrame = window.requestAnimationFrame(flushZoom);
					}
					return;
				}

				event.preventDefault();
				if (viewer.getNumItems() <= 1) {
					return;
				}
				if (zoomAnimationFrame !== null) {
					window.cancelAnimationFrame(zoomAnimationFrame);
					zoomAnimationFrame = null;
				}
				zoomDeltaAccumulator = 0;

				const now = Date.now();
				navigationAccumulatorPx += normalizeImageViewerWheelNavigationDelta(originalEvent);
				if (navigationAccumulatorResetTimer !== null) {
					window.clearTimeout(navigationAccumulatorResetTimer);
				}
				navigationAccumulatorResetTimer = window.setTimeout(() => {
					navigationAccumulatorPx = 0;
					navigationAccumulatorResetTimer = null;
				}, 160);

				const direction = resolveImageViewerWheelNavigationDirection(navigationAccumulatorPx);
				if (!direction) {
					return;
				}

				if (now < navigationCooldownUntil && direction === lastNavigationDirection) {
					return;
				}

				navigationAccumulatorPx = 0;
				navigationCooldownUntil = now + 220;
				lastNavigationDirection = direction;
				if (navigationAccumulatorResetTimer !== null) {
					window.clearTimeout(navigationAccumulatorResetTimer);
					navigationAccumulatorResetTimer = null;
				}

				if (direction === 'next') {
					viewer.next();
					return;
				}

				viewer.prev();
			});
			viewer.on('destroy', () => {
				detachBackdropPointerHandler?.();
				detachBackdropPointerHandler = null;
				if (navigationAccumulatorResetTimer !== null) {
					window.clearTimeout(navigationAccumulatorResetTimer);
					navigationAccumulatorResetTimer = null;
				}
				if (zoomAnimationFrame !== null) {
					window.cancelAnimationFrame(zoomAnimationFrame);
					zoomAnimationFrame = null;
				}
				if (activeViewerRef.current === viewer) {
					activeViewerRef.current = null;
				}
			});
			activeViewerRef.current = viewer;
			viewer.init();
		},
		[destroyActiveViewer, ensurePhotoSwipeModule],
	);

	const value = useMemo<ImageGalleryContextValue>(
		() => ({
			openImage,
			registerImage,
			updateImageSize,
			updateViewerImageSize,
		}),
		[openImage, registerImage, updateImageSize, updateViewerImageSize],
	);

	return <ImageGalleryContext.Provider value={value}>{children}</ImageGalleryContext.Provider>;
};

export const GalleryImage = ({
	alt,
	className,
	height,
	imageId,
	onFocus,
	onKeyDown,
	src,
	tabIndex,
	testId,
	title,
	timelineMessageId,
	viewerHeight,
	viewerSrc,
	viewerWidth,
	width,
}: GalleryImageProps) => {
	const gallery = useContext(ImageGalleryContext);
	const generatedId = useId();
	const resolvedImageId = imageId ?? generatedId;
	const imageRef = useRef<HTMLImageElement>(null);
	const accessibleLabel = title ?? alt ?? '查看图片';
	const resolvedViewerSrc = viewerSrc ?? src;

	useLayoutEffect(() => {
		if (!gallery || !src) {
			return;
		}

		return gallery.registerImage({
			id: resolvedImageId,
			displaySrc: src,
			alt: accessibleLabel,
			viewerSrc: resolvedViewerSrc,
			width,
			height,
			viewerWidth,
			viewerHeight,
			getElement: () => imageRef.current,
		});
	}, [accessibleLabel, gallery, height, resolvedImageId, resolvedViewerSrc, src, viewerHeight, viewerWidth, width]);

	const syncImageSize = useCallback(() => {
		if (!gallery || !imageRef.current) {
			return;
		}

		const { naturalWidth, naturalHeight } = imageRef.current;
		if (!naturalWidth || !naturalHeight) {
			return;
		}

		gallery.updateImageSize(resolvedImageId, naturalWidth, naturalHeight);
	}, [gallery, resolvedImageId]);

	const handleOpen = useCallback(
		(event: ReactMouseEvent<HTMLImageElement>) => {
			if (!gallery) {
				return;
			}

			event.preventDefault();
			const rect = imageRef.current?.getBoundingClientRect();
			const point = rect
				? {
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2,
				  }
				: null;

			void gallery.openImage(resolvedImageId, point);
		},
		[gallery, resolvedImageId],
	);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLImageElement>) => {
			onKeyDown?.(event);
			if (event.defaultPrevented) {
				return;
			}

			if (!gallery) {
				return;
			}

			if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') {
				return;
			}

			event.preventDefault();
			event.stopPropagation();
			const rect = imageRef.current?.getBoundingClientRect();
			const point = rect
				? {
					x: rect.left + rect.width / 2,
					y: rect.top + rect.height / 2,
				  }
				: null;

			void gallery.openImage(resolvedImageId, point);
		},
		[gallery, onKeyDown, resolvedImageId],
	);

	const imageElement = (
		<img
			ref={imageRef}
			alt={accessibleLabel}
			aria-label={gallery ? `查看图片：${accessibleLabel}` : undefined}
			className={[className, gallery ? styles.imageInteractive : null].filter(Boolean).join(' ')}
			data-enabled={gallery ? 'true' : 'false'}
			data-timeline-interactive-image={timelineMessageId ? 'true' : undefined}
			data-timeline-message-id={timelineMessageId}
			data-testid={testId}
			height={height}
			loading='lazy'
			onClick={gallery ? handleOpen : undefined}
			onFocus={onFocus}
			onKeyDown={gallery ? handleKeyDown : undefined}
			onLoad={syncImageSize}
			role={gallery ? 'button' : undefined}
			src={src}
			tabIndex={gallery ? (tabIndex ?? 0) : undefined}
			title={title}
			width={width}
		/>
	);

	if (!src) {
		return imageElement;
	}

	return imageElement;
};
