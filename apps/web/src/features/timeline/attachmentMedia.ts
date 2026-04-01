import type { TimelineAttachment } from '@/lib/chatModels';

export const resolveTimelineImageAttachmentMedia = (attachment: Extract<TimelineAttachment, { kind: 'image' }>) => ({
	src: attachment.preview.url,
	width: attachment.preview.width,
	height: attachment.preview.height,
	viewerSrc: attachment.source.url,
	viewerWidth: attachment.source.width,
	viewerHeight: attachment.source.height,
});
