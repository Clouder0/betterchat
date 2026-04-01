import { resolveTimelineChildFocusTarget, type TimelineChildFocusTarget } from './timelineChildFocus';

export type TimelineHorizontalFocusStop = Exclude<TimelineChildFocusTarget['kind'], 'image' | 'mention'> | 'image';

export const resolveTimelineHorizontalFocusTarget = ({
	canOpenActions,
	direction,
	from,
	hasImage,
	hasReplyPreview,
}: {
	canOpenActions: boolean;
	direction: 'left' | 'right';
	from: TimelineHorizontalFocusStop;
	hasImage: boolean;
	hasReplyPreview: boolean;
}): TimelineHorizontalFocusStop | null => {
	const target = resolveTimelineChildFocusTarget({
		canOpenActions,
		direction,
		from: from === 'image' ? { kind: 'image', index: 0 } : { kind: from },
		hasReplyPreview,
		mentionCount: 0,
		imageCount: hasImage ? 1 : 0,
	});

	if (target?.kind === 'mention') {
		return null;
	}

	return target?.kind ?? null;
};
