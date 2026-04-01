import { memo } from 'react';
import type { SessionUser } from '@betterchat/contracts';

import { MarkdownContent } from '@/components/MarkdownContent';
import type { MarkdownMentionInteraction } from '@/components/MarkdownContent';
import { spaceText } from '@/lib/text';

import styles from './ForwardedMessageCard.module.css';

type ForwardedMessageCardProps = {
	authorName: string;
	bodyMarkdown: string;
	currentUser?: Pick<SessionUser, 'displayName' | 'username'> | null;
	mentionInteraction?: MarkdownMentionInteraction;
	roomTitle: string;
	timeLabel: string;
};

const ForwardedMessageCardComponent = ({
	authorName,
	bodyMarkdown,
	currentUser = null,
	mentionInteraction,
	roomTitle,
	timeLabel,
}: ForwardedMessageCardProps) => (
	<section className={styles.card} data-testid='forwarded-message-card'>
		<div className={styles.header}>
			<span className={styles.label}>{spaceText('转发')}</span>
			<div className={styles.meta}>
				<strong className={styles.author}>{spaceText(authorName)}</strong>
				<span className={styles.separator}>·</span>
				<span className={styles.room}>{spaceText(roomTitle)}</span>
				<span className={styles.separator}>·</span>
				<span className={styles.time}>{timeLabel}</span>
			</div>
		</div>

		<div className={styles.body}>
			<MarkdownContent currentUser={currentUser} dense mentionInteraction={mentionInteraction} source={bodyMarkdown} />
		</div>
	</section>
);

const areForwardedMessageCardPropsEqual = (
	previousProps: ForwardedMessageCardProps,
	nextProps: ForwardedMessageCardProps,
) =>
	previousProps.authorName === nextProps.authorName &&
	previousProps.bodyMarkdown === nextProps.bodyMarkdown &&
	previousProps.roomTitle === nextProps.roomTitle &&
	previousProps.timeLabel === nextProps.timeLabel &&
	(previousProps.currentUser?.displayName ?? null) === (nextProps.currentUser?.displayName ?? null) &&
	(previousProps.currentUser?.username ?? null) === (nextProps.currentUser?.username ?? null) &&
	previousProps.mentionInteraction === nextProps.mentionInteraction;

export const ForwardedMessageCard = memo(ForwardedMessageCardComponent, areForwardedMessageCardPropsEqual);
