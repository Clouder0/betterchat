export type TimelineChildFocusTarget =
	| {
			kind: 'message';
	  }
	| {
			kind: 'reply-preview';
	  }
	| {
			kind: 'mention';
			index: number;
	  }
	| {
			kind: 'image';
			index: number;
	  }
	| {
			kind: 'reply-action';
	  }
	| {
			kind: 'forward-action';
	  };

export const resolveTimelineChildFocusTarget = ({
	canOpenActions,
	direction,
	from,
	hasReplyPreview,
	mentionCount,
	imageCount,
}: {
	canOpenActions: boolean;
	direction: 'left' | 'right';
	from: TimelineChildFocusTarget;
	hasReplyPreview: boolean;
	mentionCount: number;
	imageCount: number;
}): TimelineChildFocusTarget | null => {
	const hasMentions = mentionCount > 0;
	const hasImages = imageCount > 0;

	if (direction === 'right') {
		if (from.kind === 'message') {
			if (hasReplyPreview) {
				return {
					kind: 'reply-preview',
				};
			}

			if (hasMentions) {
				return {
					kind: 'mention',
					index: 0,
				};
			}

			if (hasImages) {
				return {
					kind: 'image',
					index: 0,
				};
			}

			return canOpenActions
				? {
						kind: 'reply-action',
				  }
				: null;
		}

		if (from.kind === 'reply-preview') {
			if (hasMentions) {
				return {
					kind: 'mention',
					index: 0,
				};
			}

			if (hasImages) {
				return {
					kind: 'image',
					index: 0,
				};
			}

			return canOpenActions
				? {
						kind: 'reply-action',
				  }
				: null;
		}

		if (from.kind === 'mention') {
			if (from.index < mentionCount - 1) {
				return {
					kind: 'mention',
					index: from.index + 1,
				};
			}

			if (hasImages) {
				return {
					kind: 'image',
					index: 0,
				};
			}

			return canOpenActions
				? {
						kind: 'reply-action',
				  }
				: null;
		}

		if (from.kind === 'image') {
			if (from.index < imageCount - 1) {
				return {
					kind: 'image',
					index: from.index + 1,
				};
			}

			return canOpenActions
				? {
						kind: 'reply-action',
				  }
				: null;
		}

		if (from.kind === 'reply-action') {
			return {
				kind: 'forward-action',
			};
		}

		return null;
	}

	if (from.kind === 'reply-preview') {
		return {
			kind: 'message',
		};
	}

	if (from.kind === 'mention') {
		if (from.index > 0) {
			return {
				kind: 'mention',
				index: from.index - 1,
			};
		}

		return hasReplyPreview
			? {
					kind: 'reply-preview',
			  }
			: {
					kind: 'message',
			  };
	}

	if (from.kind === 'image') {
		if (from.index > 0) {
			return {
				kind: 'image',
				index: from.index - 1,
			};
		}

		if (hasMentions) {
			return {
				kind: 'mention',
				index: mentionCount - 1,
			};
		}

		return hasReplyPreview
			? {
					kind: 'reply-preview',
			  }
			: {
					kind: 'message',
			  };
	}

	if (from.kind === 'reply-action') {
		if (hasImages) {
			return {
				kind: 'image',
				index: imageCount - 1,
			};
		}

		if (hasMentions) {
			return {
				kind: 'mention',
				index: mentionCount - 1,
			};
		}

		if (hasReplyPreview) {
			return {
					kind: 'reply-preview',
			};
		}

		return {
			kind: 'message',
		};
	}

	if (from.kind === 'forward-action') {
		return {
			kind: 'reply-action',
		};
	}

	return null;
};
