import { getAvatarLabel } from '@/lib/avatar';
import type { RoomSummary } from '@/lib/chatModels';
import { spaceText } from '@/lib/text';

import { resolveSidebarAttentionDockLabel } from './sidebarAttentionDockModel';
import styles from './SidebarAttentionDock.module.css';

const roomKindGlyph: Record<RoomSummary['kind'], string> = {
	channel: '#',
	group: '◎',
	dm: '私',
};

export const SidebarAttentionDock = ({
	entries,
	onOpenRoom,
	overflowCount,
}: {
	entries: RoomSummary[];
	onOpenRoom: (roomId: string) => void;
	overflowCount: number;
}) => {
	if (entries.length === 0) {
		return null;
	}

	return (
		<section aria-label={spaceText('待处理房间')} className={styles.dock} data-testid='sidebar-attention-dock'>
			<div className={styles.header}>
				<h3 className={styles.title}>{spaceText('待处理')}</h3>
				{overflowCount > 0 ? (
					<span className={styles.overflow} data-testid='sidebar-attention-dock-overflow'>
						{spaceText(`+${String(overflowCount)}`)}
					</span>
				) : null}
			</div>

			<div className={styles.entries}>
				{entries.map((entry) => {
					const attentionLabel = resolveSidebarAttentionDockLabel(entry) ?? entry.subtitle ?? '有新消息';
					return (
						<button
							key={entry.id}
							className={styles.entry}
							data-attention-level={entry.attention.level}
							data-testid={`sidebar-attention-dock-item-${entry.id}`}
							onClick={() => onOpenRoom(entry.id)}
							type='button'
						>
							<span className={styles.avatar} data-kind={entry.kind}>
								{entry.kind === 'dm' ? getAvatarLabel(entry.title) : roomKindGlyph[entry.kind]}
							</span>
							<span className={styles.copy}>
								<span className={styles.roomTitle} title={spaceText(entry.title)}>
									{spaceText(entry.title)}
								</span>
								<span className={styles.attentionLabel}>{spaceText(attentionLabel)}</span>
							</span>
						</button>
					);
				})}
			</div>
		</section>
	);
};
