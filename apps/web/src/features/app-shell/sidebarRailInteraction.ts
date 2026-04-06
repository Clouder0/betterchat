import { shouldSnapToCollapsed } from './sidebarCollapsePreference';

export const SIDEBAR_RAIL_DRAG_SLOP_PX = 4;

export type SidebarRailPointerPreview =
	| {
			collapsed: true;
			kind: 'collapse-preview';
			width: number;
	  }
	| {
			collapsed: false;
			kind: 'resize-preview';
			width: number;
	  };

export type SidebarRailPointerCompletion =
	| {
			kind: 'commit-resize';
			width: number;
	  }
	| {
			kind: 'expand-restored-width';
			width: number;
	  }
	| {
			kind: 'no-op';
	  }
	| {
			kind: 'set-collapsed';
	  };

export const resolveSidebarRailPointerPreview = ({
	collapseThreshold,
	previewWidth,
	rawWidth,
}: {
	collapseThreshold: number;
	previewWidth: number;
	rawWidth: number;
}): SidebarRailPointerPreview => {
	if (shouldSnapToCollapsed({ rawWidth, threshold: collapseThreshold })) {
		return {
			collapsed: true,
			kind: 'collapse-preview',
			width: previewWidth,
		};
	}

	return {
		collapsed: false,
		kind: 'resize-preview',
		width: previewWidth,
	};
};

export const resolveSidebarRailPointerCompletion = ({
	collapsedAtStart,
	collapseThreshold,
	dragged,
	rawWidth,
	restoredWidth,
}: {
	collapsedAtStart: boolean;
	collapseThreshold: number;
	dragged: boolean;
	rawWidth: number;
	restoredWidth: number;
}): SidebarRailPointerCompletion => {
	if (!dragged) {
		if (collapsedAtStart) {
			return {
				kind: 'expand-restored-width',
				width: restoredWidth,
			};
		}

		return {
			kind: 'no-op',
		};
	}

	if (shouldSnapToCollapsed({ rawWidth, threshold: collapseThreshold })) {
		return {
			kind: 'set-collapsed',
		};
	}

	return {
		kind: 'commit-resize',
		width: rawWidth,
	};
};
