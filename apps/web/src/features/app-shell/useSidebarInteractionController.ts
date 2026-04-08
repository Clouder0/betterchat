import { isDocumentMotionDisabled } from '@/app/motionPreference';

import {
	DEFAULT_SIDEBAR_WIDTH_PX,
	SIDEBAR_RESIZE_DESKTOP_BREAKPOINT_PX,
	clampSidebarPreviewWidth,
	clampSidebarWidth,
	formatSidebarWidthCssValue,
	loadSidebarWidthPreference,
	resolveSidebarPreviewWidth,
	resolveSidebarWidthBounds,
	saveSidebarWidthPreference,
} from './sidebarWidthPreference';
import { resolveElementKeyboardRegion } from './keyboardRegion';
import {
	resolveSidebarRailPointerCompletion,
	resolveSidebarRailPointerPreview,
	SIDEBAR_RAIL_DRAG_SLOP_PX,
} from './sidebarRailInteraction';
import {
	loadSidebarCollapsedPreference,
	saveSidebarCollapsedPreference,
	SIDEBAR_COLLAPSE_SNAP_THRESHOLD_PX,
} from './sidebarCollapsePreference';
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type KeyboardEvent as ReactKeyboardEvent,
	type PointerEvent as ReactPointerEvent,
	type RefObject,
} from 'react';

type SidebarResizeState = {
	currentWidth: number;
	dragged: boolean;
	pointerId: number;
	startedCollapsed: boolean;
	startWidth: number;
	startX: number;
};

export type SidebarInteractionController = {
	clearSidebarResizeKeyboardAdjusting: () => void;
	collapseSidebar: () => void;
	commitSidebarWidth: (nextWidth: number) => number;
	effectiveSidebarCollapsed: boolean;
	expandSidebar: () => void;
	handleSidebarResizeDoubleClick: () => void;
	handleSidebarResizeKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
	handleSidebarResizePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
	handleSidebarResizePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
	resolvedSidebarWidth: number;
	sidebarCollapsed: boolean;
	sidebarResizeDragging: boolean;
	sidebarResizeEnabled: boolean;
	sidebarResizeKeyboardAdjusting: boolean;
	sidebarWidthBounds: { max: number; min: number };
	stopSidebarResize: (pointerId?: number) => void;
	toggleSidebarCollapse: () => void;
	visibleSidebarWidth: number;
	workspaceStyle: CSSProperties;
};

export const useSidebarInteractionController = ({
	focusSidebarFromResizeHandle,
	focusTimeline,
	markSidebarPointerInteraction,
	roomInfoOpen,
	sidebarRef,
	viewportWidth,
	workspaceRef,
}: {
	focusSidebarFromResizeHandle: () => boolean;
	focusTimeline: () => boolean;
	markSidebarPointerInteraction: () => void;
	roomInfoOpen: boolean;
	sidebarRef: RefObject<HTMLElement | null>;
	viewportWidth: number;
	workspaceRef: RefObject<HTMLElement | null>;
}): SidebarInteractionController => {
	const sidebarResizeStateRef = useRef<SidebarResizeState | null>(null);
	const sidebarLiveWidthRef = useRef(loadSidebarWidthPreference());
	const sidebarCollapsedInitialRef = useRef(true);
	const lastSidebarExpandFromCollapsedPointerAtRef = useRef<number>(-1);
	const sidebarResizeFrameRef = useRef<number | null>(null);
	const sidebarResizePendingWidthRef = useRef<number | null>(null);
	const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidthPreference);
	const [sidebarCollapsed, setSidebarCollapsed] = useState(loadSidebarCollapsedPreference);
	const [sidebarPreviewCollapsedOverride, setSidebarPreviewCollapsedOverride] = useState<boolean | null>(null);
	const [sidebarResizeDragging, setSidebarResizeDragging] = useState(false);
	const [sidebarResizeKeyboardAdjusting, setSidebarResizeKeyboardAdjusting] = useState(false);

	const sidebarResizeEnabled = viewportWidth > SIDEBAR_RESIZE_DESKTOP_BREAKPOINT_PX;
	const sidebarWidthBounds = useMemo(
		() =>
			resolveSidebarWidthBounds({
				infoSidebarOpen: roomInfoOpen,
				viewportWidth,
			}),
		[roomInfoOpen, viewportWidth],
	);
	const resolvedSidebarWidth = sidebarResizeEnabled
		? clampSidebarWidth(sidebarWidth, sidebarWidthBounds)
		: DEFAULT_SIDEBAR_WIDTH_PX;
	const effectiveSidebarCollapsed = sidebarPreviewCollapsedOverride ?? sidebarCollapsed;
	const settledSidebarWidth = sidebarCollapsed ? 0 : resolvedSidebarWidth;
	const visibleSidebarWidth = sidebarResizeDragging
		? sidebarLiveWidthRef.current
		: effectiveSidebarCollapsed
			? 0
			: resolvedSidebarWidth;
	const workspaceStyle = useMemo(
		() =>
			({
				'--shell-sidebar-width': formatSidebarWidthCssValue(
					sidebarResizeDragging ? sidebarLiveWidthRef.current : settledSidebarWidth,
				),
			}) as CSSProperties,
		[settledSidebarWidth, sidebarResizeDragging],
	);

	const applySidebarWidthToWorkspace = useCallback(
		(nextWidth: number) => {
			sidebarLiveWidthRef.current = nextWidth;
			workspaceRef.current?.style.setProperty('--shell-sidebar-width', formatSidebarWidthCssValue(nextWidth));
		},
		[workspaceRef],
	);

	const flushSidebarWidthPreview = useCallback(() => {
		if (typeof window !== 'undefined' && sidebarResizeFrameRef.current !== null) {
			window.cancelAnimationFrame(sidebarResizeFrameRef.current);
			sidebarResizeFrameRef.current = null;
		}

		const pendingWidth = sidebarResizePendingWidthRef.current;
		if (pendingWidth !== null) {
			applySidebarWidthToWorkspace(pendingWidth);
			sidebarResizePendingWidthRef.current = null;
		}
	}, [applySidebarWidthToWorkspace]);

	const discardSidebarWidthPreview = useCallback(() => {
		if (typeof window !== 'undefined' && sidebarResizeFrameRef.current !== null) {
			window.cancelAnimationFrame(sidebarResizeFrameRef.current);
			sidebarResizeFrameRef.current = null;
		}

		sidebarResizePendingWidthRef.current = null;
	}, []);

	const setSidebarPreviewCollapsedState = useCallback((next: boolean | null) => {
		setSidebarPreviewCollapsedOverride((current) => (current === next ? current : next));
	}, []);

	const previewSidebarWidth = useCallback(
		(nextWidth: number) => {
			const clampedWidth = clampSidebarPreviewWidth(nextWidth, sidebarWidthBounds.max);
			sidebarLiveWidthRef.current = clampedWidth;
			sidebarResizePendingWidthRef.current = clampedWidth;

			if (typeof window === 'undefined') {
				applySidebarWidthToWorkspace(clampedWidth);
				sidebarResizePendingWidthRef.current = null;
				return clampedWidth;
			}

			if (sidebarResizeFrameRef.current !== null) {
				return clampedWidth;
			}

			sidebarResizeFrameRef.current = window.requestAnimationFrame(() => {
				sidebarResizeFrameRef.current = null;
				const pendingWidth = sidebarResizePendingWidthRef.current;
				if (pendingWidth === null) {
					return;
				}

				applySidebarWidthToWorkspace(pendingWidth);
				sidebarResizePendingWidthRef.current = null;
			});

			return clampedWidth;
		},
		[applySidebarWidthToWorkspace, sidebarWidthBounds.max],
	);

	const commitSidebarWidth = useCallback(
		(nextWidth: number) => {
			const clampedWidth = clampSidebarWidth(nextWidth, sidebarWidthBounds);
			flushSidebarWidthPreview();
			applySidebarWidthToWorkspace(clampedWidth);
			setSidebarWidth((currentWidth) => (currentWidth === clampedWidth ? currentWidth : clampedWidth));
			saveSidebarWidthPreference(clampedWidth);
			return clampedWidth;
		},
		[applySidebarWidthToWorkspace, flushSidebarWidthPreview, sidebarWidthBounds],
	);

	const expandSidebar = useCallback(() => {
		setSidebarCollapsed((current) => {
			if (!current) {
				return current;
			}

			saveSidebarCollapsedPreference(false);
			return false;
		});
	}, []);

	const collapseSidebar = useCallback(() => {
		setSidebarCollapsed((current) => {
			if (current) {
				return current;
			}

			saveSidebarCollapsedPreference(true);
			return true;
		});
	}, []);

	const toggleSidebarCollapse = useCallback(() => {
		setSidebarCollapsed((current) => {
			const next = !current;
			saveSidebarCollapsedPreference(next);
			return next;
		});
	}, []);

	const stopSidebarResize = useCallback(
		(pointerId?: number) => {
			const resizeState = sidebarResizeStateRef.current;
			if (pointerId !== undefined && resizeState?.pointerId !== pointerId) {
				return;
			}

			if (resizeState) {
				const completion = resolveSidebarRailPointerCompletion({
					collapsedAtStart: resizeState.startedCollapsed,
					collapseThreshold: SIDEBAR_COLLAPSE_SNAP_THRESHOLD_PX,
					dragged: resizeState.dragged,
					rawWidth: resizeState.currentWidth,
					restoredWidth: resolvedSidebarWidth,
				});

				if (completion.kind === 'set-collapsed') {
					discardSidebarWidthPreview();
					applySidebarWidthToWorkspace(0);
					setSidebarCollapsed(true);
					saveSidebarCollapsedPreference(true);
				} else if (completion.kind === 'commit-resize') {
					if (sidebarCollapsed) {
						setSidebarCollapsed(false);
						saveSidebarCollapsedPreference(false);
					}
					commitSidebarWidth(completion.width);
				} else if (completion.kind === 'expand-restored-width') {
					discardSidebarWidthPreview();
					setSidebarCollapsed(false);
					saveSidebarCollapsedPreference(false);
					lastSidebarExpandFromCollapsedPointerAtRef.current = Date.now();
				}
			}

			sidebarResizeStateRef.current = null;
			setSidebarPreviewCollapsedState(null);
			setSidebarResizeDragging(false);
		},
		[
			applySidebarWidthToWorkspace,
			commitSidebarWidth,
			discardSidebarWidthPreview,
			resolvedSidebarWidth,
			setSidebarPreviewCollapsedState,
			sidebarCollapsed,
		],
	);

	const handleSidebarResizePointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (!sidebarResizeEnabled || event.button !== 0) {
				return;
			}

			event.preventDefault();
			markSidebarPointerInteraction();
			setSidebarResizeKeyboardAdjusting(false);
			setSidebarPreviewCollapsedState(null);
			const currentWidth = sidebarCollapsed ? 0 : (sidebarRef.current?.getBoundingClientRect().width ?? resolvedSidebarWidth);
			sidebarResizeStateRef.current = {
				currentWidth,
				dragged: false,
				pointerId: event.pointerId,
				startedCollapsed: sidebarCollapsed,
				startWidth: currentWidth,
				startX: event.clientX,
			};
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[
			markSidebarPointerInteraction,
			resolvedSidebarWidth,
			setSidebarPreviewCollapsedState,
			sidebarCollapsed,
			sidebarRef,
			sidebarResizeEnabled,
		],
	);

	const handleSidebarResizePointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			const resizeState = sidebarResizeStateRef.current;
			if (!resizeState || resizeState.pointerId !== event.pointerId) {
				return;
			}

			const dragDistance = Math.abs(event.clientX - resizeState.startX);
			if (!resizeState.dragged && dragDistance < SIDEBAR_RAIL_DRAG_SLOP_PX) {
				return;
			}

			event.preventDefault();
			if (!resizeState.dragged) {
				resizeState.dragged = true;
				setSidebarResizeDragging(true);
			}
			const rawWidth = resizeState.startWidth + (event.clientX - resizeState.startX);
			const previewWidth = resolveSidebarPreviewWidth({
				currentX: event.clientX,
				max: sidebarWidthBounds.max,
				startWidth: resizeState.startWidth,
				startX: resizeState.startX,
			});
			const preview = resolveSidebarRailPointerPreview({
				collapseThreshold: SIDEBAR_COLLAPSE_SNAP_THRESHOLD_PX,
				previewWidth,
				rawWidth,
			});
			setSidebarPreviewCollapsedState(preview.collapsed);
			resizeState.currentWidth = previewSidebarWidth(preview.width);
		},
		[previewSidebarWidth, setSidebarPreviewCollapsedState, sidebarWidthBounds.max],
	);

	const handleSidebarResizeDoubleClick = useCallback(() => {
		if (Date.now() - lastSidebarExpandFromCollapsedPointerAtRef.current < 320) {
			return;
		}

		toggleSidebarCollapse();
	}, [toggleSidebarCollapse]);

	const handleSidebarResizeKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLDivElement>) => {
			if (!sidebarResizeEnabled) {
				return;
			}

			if (event.key === 'Enter') {
				event.preventDefault();
				setSidebarResizeKeyboardAdjusting((currentState) => !currentState);
				return;
			}

			if (event.key === 'Escape' && sidebarResizeKeyboardAdjusting) {
				event.preventDefault();
				setSidebarResizeKeyboardAdjusting(false);
				return;
			}

			if (!sidebarResizeKeyboardAdjusting) {
				if (event.key === 'ArrowLeft') {
					event.preventDefault();
					void focusSidebarFromResizeHandle();
					return;
				}

				if (event.key === 'ArrowRight') {
					event.preventDefault();
					void focusTimeline();
				}

				return;
			}

			const step = event.shiftKey ? 40 : 16;
			if (event.key === 'ArrowLeft') {
				event.preventDefault();
				commitSidebarWidth(resolvedSidebarWidth - step);
				return;
			}

			if (event.key === 'ArrowRight') {
				event.preventDefault();
				commitSidebarWidth(resolvedSidebarWidth + step);
				return;
			}

			if (event.key === 'Home') {
				event.preventDefault();
				commitSidebarWidth(sidebarWidthBounds.min);
				return;
			}

			if (event.key === 'End') {
				event.preventDefault();
				commitSidebarWidth(sidebarWidthBounds.max);
			}
		},
		[
			commitSidebarWidth,
			focusSidebarFromResizeHandle,
			focusTimeline,
			resolvedSidebarWidth,
			sidebarResizeEnabled,
			sidebarResizeKeyboardAdjusting,
			sidebarWidthBounds.max,
			sidebarWidthBounds.min,
		],
	);

	const clearSidebarResizeKeyboardAdjusting = useCallback(() => {
		setSidebarResizeKeyboardAdjusting(false);
	}, []);

	useEffect(() => {
		if (sidebarResizeDragging) {
			return;
		}

		applySidebarWidthToWorkspace(settledSidebarWidth);
	}, [applySidebarWidthToWorkspace, settledSidebarWidth, sidebarResizeDragging]);

	useEffect(
		() => () => {
			if (typeof window !== 'undefined' && sidebarResizeFrameRef.current !== null) {
				window.cancelAnimationFrame(sidebarResizeFrameRef.current);
			}
		},
		[],
	);

	useEffect(() => {
		if (!sidebarResizeDragging || typeof document === 'undefined') {
			return;
		}

		const previousCursor = document.body.style.cursor;
		const previousUserSelect = document.body.style.userSelect;
		document.body.style.cursor = 'col-resize';
		document.body.style.userSelect = 'none';

		return () => {
			document.body.style.cursor = previousCursor;
			document.body.style.userSelect = previousUserSelect;
		};
	}, [sidebarResizeDragging]);

	useEffect(() => {
		if (!sidebarResizeEnabled) {
			setSidebarResizeKeyboardAdjusting(false);
		}
	}, [sidebarResizeEnabled]);

	useEffect(() => {
		if (!sidebarCollapsed) {
			return;
		}

		const region = resolveElementKeyboardRegion(document.activeElement as Element | null);
		if (region === 'sidebar-list') {
			focusTimeline();
		}
	}, [focusTimeline, sidebarCollapsed]);

	useEffect(() => {
		if (sidebarCollapsedInitialRef.current) {
			sidebarCollapsedInitialRef.current = false;
			return;
		}

		const workspace = workspaceRef.current;
		if (!workspace || sidebarResizeDragging || isDocumentMotionDisabled()) {
			return;
		}

		workspace.setAttribute('data-sidebar-transitioning', 'true');
		const fallbackTimer = window.setTimeout(() => {
			workspace.removeAttribute('data-sidebar-transitioning');
		}, 250);
		return () => window.clearTimeout(fallbackTimer);
	}, [sidebarCollapsed, sidebarResizeDragging, workspaceRef]);

	return {
		clearSidebarResizeKeyboardAdjusting,
		collapseSidebar,
		commitSidebarWidth,
		effectiveSidebarCollapsed,
		expandSidebar,
		handleSidebarResizeDoubleClick,
		handleSidebarResizeKeyDown,
		handleSidebarResizePointerDown,
		handleSidebarResizePointerMove,
		resolvedSidebarWidth,
		sidebarCollapsed,
		sidebarResizeDragging,
		sidebarResizeEnabled,
		sidebarResizeKeyboardAdjusting,
		sidebarWidthBounds,
		stopSidebarResize,
		toggleSidebarCollapse,
		visibleSidebarWidth,
		workspaceStyle,
	};
};
