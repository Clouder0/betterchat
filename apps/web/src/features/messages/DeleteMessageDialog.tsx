import * as Dialog from '@radix-ui/react-dialog';
import { useCallback } from 'react';

import type { TimelineMessage } from '@/lib/chatModels';
import { spaceText } from '@/lib/text';

import { createMessageExcerpt } from './messageCompose';
import styles from './DeleteMessageDialog.module.css';

export const DeleteMessageDialog = ({
	open,
	onOpenChange,
	onConfirm,
	sourceMessage,
	isSubmitting = false,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onConfirm: () => void;
	sourceMessage: TimelineMessage | null;
	isSubmitting?: boolean;
}) => {
	const handleConfirm = useCallback(() => {
		if (!isSubmitting) {
			onConfirm();
		}
	}, [isSubmitting, onConfirm]);

	const excerpt = sourceMessage ? createMessageExcerpt(sourceMessage) : '';

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className={styles.overlay} />
				<Dialog.Content
					className={styles.panel}
					data-testid='delete-message-dialog'
					onOpenAutoFocus={(event) => event.preventDefault()}
				>
					<Dialog.Title className={styles.title}>{spaceText('确定删除该消息？')}</Dialog.Title>

					{excerpt ? (
						<Dialog.Description className={styles.excerpt}>{spaceText(excerpt)}</Dialog.Description>
					) : null}

					<div className={styles.footer}>
						<button
							className={styles.cancelButton}
							data-testid='delete-message-cancel'
							onClick={() => onOpenChange(false)}
							type='button'
						>
							{spaceText('取消')}
						</button>
						<button
							className={styles.deleteButton}
							data-testid='delete-message-confirm'
							disabled={isSubmitting}
							onClick={handleConfirm}
							type='button'
						>
							{spaceText(isSubmitting ? '删除中…' : '删除')}
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
};
