import * as Dialog from '@radix-ui/react-dialog';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

import { resolveSidebarSecondaryMeta } from '@/features/sidebar/sidebarPresence';
import type { RoomAlertPreferenceStore } from '@/features/sidebar/roomAlertPreferences';
import type { SidebarOrderingState } from '@/features/sidebar/sidebarOrdering';
import { getAvatarLabel } from '@/lib/avatar';
import type { RoomSummary, TimelineMessage } from '@/lib/chatModels';
import { spaceText } from '@/lib/text';

import { createMessageExcerpt } from './messageCompose';
import { buildRoomSelectionGroups } from './roomSelectionGroups';
import {
	resolveForwardDialogNoteKeyAction,
	resolveForwardDialogRoomKeyAction,
	resolveForwardDialogSearchKeyAction,
	resolveForwardDialogSubmitKeyAction,
} from './forwardDialogNavigation';
import styles from './ForwardMessageDialog.module.css';

const roomKindGlyph: Record<'channel' | 'group' | 'dm', string> = {
	channel: '#',
	group: '◎',
	dm: '私',
};

const roomKindLabel: Record<'channel' | 'group' | 'dm', string> = {
	channel: '频道',
	group: '群组',
	dm: '私信',
};

const closeGlyph = (
	<svg aria-hidden='true' className={styles.closeIcon} viewBox='0 0 24 24'>
		<path
			d='M7 7l10 10M17 7 7 17'
			fill='none'
			stroke='currentColor'
			strokeLinecap='round'
			strokeLinejoin='round'
			strokeWidth='1.55'
		/>
	</svg>
);

export const ForwardMessageDialog = ({
	currentRoomId,
	open,
	onOpenChange,
	onSubmit,
	sidebarEntries,
	sidebarOrderingState = {},
	roomAlertPreferences = {},
	sourceMessage,
	sourceRoomTitle,
}: {
	currentRoomId: string | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	onSubmit: (payload: { note: string; roomId: string }) => Promise<void>;
	sidebarEntries: RoomSummary[];
	sidebarOrderingState?: SidebarOrderingState;
	roomAlertPreferences?: RoomAlertPreferenceStore;
	sourceMessage: TimelineMessage | null;
	sourceRoomTitle: string | null;
}) => {
	const [searchValue, setSearchValue] = useState('');
	const [selectedRoomId, setSelectedRoomId] = useState(currentRoomId ?? '');
	const [note, setNote] = useState('');
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	const searchInputRef = useRef<HTMLInputElement>(null);
	const noteFieldRef = useRef<HTMLTextAreaElement>(null);
	const submitButtonRef = useRef<HTMLButtonElement>(null);
	const roomOptionRefs = useRef(new Map<string, HTMLButtonElement>());
	const groupedEntries = useMemo(
		() =>
			buildRoomSelectionGroups({
				activeRoomId: currentRoomId,
				alertPreferences: roomAlertPreferences,
				entries: sidebarEntries,
				orderingState: sidebarOrderingState,
				query: searchValue,
			}),
		[currentRoomId, roomAlertPreferences, searchValue, sidebarEntries, sidebarOrderingState],
	);
	const visibleRoomIds = useMemo(
		() => groupedEntries.flatMap((group) => group.entries.map((entry) => entry.id)),
		[groupedEntries],
	);
	const previewExcerpt = useMemo(() => (sourceMessage ? createMessageExcerpt(sourceMessage) : null), [sourceMessage]);
	const sourceRoomLabel = sourceRoomTitle ? spaceText(sourceRoomTitle) : null;
	const sourceTimeLabel = sourceMessage
		? new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(new Date(sourceMessage.createdAt))
		: null;
	const activeRoomId = visibleRoomIds.includes(selectedRoomId) ? selectedRoomId : visibleRoomIds[0] ?? '';

	useEffect(() => {
		if (!open) {
			return;
		}

		setSearchValue('');
		setNote('');
		setSelectedRoomId(currentRoomId ?? sidebarEntries[0]?.id ?? '');
		setIsSubmitting(false);
		setSubmitError(null);
	}, [currentRoomId, open, sidebarEntries]);

	useEffect(() => {
		if (!open) {
			return;
		}

		if (visibleRoomIds.length === 0) {
			if (selectedRoomId !== '') {
				setSelectedRoomId('');
			}
			return;
		}

		if (visibleRoomIds.includes(selectedRoomId)) {
			return;
		}

		const fallbackRoomId = currentRoomId && visibleRoomIds.includes(currentRoomId) ? currentRoomId : visibleRoomIds[0] ?? '';
		if (fallbackRoomId && fallbackRoomId !== selectedRoomId) {
			setSelectedRoomId(fallbackRoomId);
		}
	}, [currentRoomId, open, selectedRoomId, visibleRoomIds]);

	const setRoomOptionRef = useCallback(
		(roomId: string) => (node: HTMLButtonElement | null) => {
			if (node) {
				roomOptionRefs.current.set(roomId, node);
				return;
			}

			roomOptionRefs.current.delete(roomId);
		},
		[],
	);

	const focusSearchInput = useCallback(() => {
		const inputNode = searchInputRef.current;
		if (!inputNode) {
			return false;
		}

		inputNode.focus({ preventScroll: true });
		return true;
	}, []);

	const focusNoteField = useCallback(() => {
		const noteNode = noteFieldRef.current;
		if (!noteNode) {
			return false;
		}

		noteNode.focus({ preventScroll: true });
		return true;
	}, []);

	const focusSubmitButton = useCallback(() => {
		const submitNode = submitButtonRef.current;
		if (!submitNode) {
			return false;
		}

		submitNode.focus({ preventScroll: true });
		return true;
	}, []);

	const focusRoomOption = useCallback((roomId: string | null, behavior: ScrollBehavior = 'auto') => {
		if (!roomId) {
			return false;
		}

		const roomNode = roomOptionRefs.current.get(roomId);
		if (!roomNode) {
			return false;
		}

		roomNode.focus({ preventScroll: true });
		roomNode.scrollIntoView({
			behavior,
			block: 'nearest',
		});
		return true;
	}, []);

	const focusRoomOptionAtIndex = useCallback(
		(index: number, behavior: ScrollBehavior = 'auto') => {
			if (visibleRoomIds.length === 0) {
				return false;
			}

			const normalizedIndex = Math.max(0, Math.min(index, visibleRoomIds.length - 1));
			const roomId = visibleRoomIds[normalizedIndex] ?? null;
			if (!roomId) {
				return false;
			}

			setSelectedRoomId(roomId);
			window.requestAnimationFrame(() => {
				void focusRoomOption(roomId, behavior);
			});
			return true;
		},
		[focusRoomOption, visibleRoomIds],
	);

	const handleSubmit = useCallback(async () => {
		if (!selectedRoomId || !sourceMessage || !sourceRoomTitle || isSubmitting) {
			return;
		}

		setIsSubmitting(true);
		setSubmitError(null);
		try {
			await onSubmit({
				note,
				roomId: selectedRoomId,
			});
			onOpenChange(false);
		} catch (error) {
			setSubmitError(error instanceof Error ? error.message : '转发失败，请稍后重试。');
		} finally {
			setIsSubmitting(false);
		}
	}, [isSubmitting, note, onOpenChange, onSubmit, selectedRoomId, sourceMessage, sourceRoomTitle]);

	const handleSearchKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLInputElement>) => {
			if (event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}

			const action = resolveForwardDialogSearchKeyAction({
				hasActiveRoom: Boolean(activeRoomId),
				key: event.key,
			});
			if (action !== 'focus-active-room' || !activeRoomId) {
				return;
			}

			event.preventDefault();
			setSelectedRoomId(activeRoomId);
			window.requestAnimationFrame(() => {
				void focusRoomOption(activeRoomId);
			});
		},
		[activeRoomId, focusRoomOption],
	);

	const handleRoomOptionKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>, roomId: string) => {
			const currentIndex = visibleRoomIds.indexOf(roomId);
			if (currentIndex < 0) {
				return;
			}

			if (event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}

			const action = resolveForwardDialogRoomKeyAction({
				currentIndex,
				key: event.key,
				roomCount: visibleRoomIds.length,
			});
			if (!action) {
				return;
			}

			event.preventDefault();
			if (action.kind === 'focus-room') {
				void focusRoomOptionAtIndex(action.index);
				return;
			}

			if (action.kind === 'focus-search') {
				void focusSearchInput();
				return;
			}

			if (action.kind === 'focus-note') {
				void focusNoteField();
				return;
			}

			if (action.kind === 'select-room') {
				setSelectedRoomId(roomId);
				return;
			}

			setSelectedRoomId(roomId);
			window.requestAnimationFrame(() => {
				void focusNoteField();
			});
		},
		[focusNoteField, focusRoomOptionAtIndex, focusSearchInput, visibleRoomIds],
	);

	const handleNoteKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
			if (event.altKey || event.ctrlKey || event.metaKey) {
				const action = resolveForwardDialogNoteKeyAction({
					hasActiveRoom: Boolean(activeRoomId),
					isOnFirstLine: false,
					isOnLastLine: false,
					key: event.key,
					submitModifierPressed: Boolean(event.ctrlKey || event.metaKey),
				});
				if (action === 'submit') {
					event.preventDefault();
				void handleSubmit();
			}
				return;
			}

			const noteNode = noteFieldRef.current;
			if (!noteNode || noteNode.selectionStart !== noteNode.selectionEnd) {
				return;
			}

			const caretIndex = noteNode.selectionStart;
			const noteValue = noteNode.value;
			const isOnFirstLine = noteValue.lastIndexOf('\n', Math.max(caretIndex - 1, 0)) === -1;
			const isOnLastLine = noteValue.indexOf('\n', caretIndex) === -1;
			const action = resolveForwardDialogNoteKeyAction({
				hasActiveRoom: Boolean(activeRoomId),
				isOnFirstLine,
				isOnLastLine,
				key: event.key,
				submitModifierPressed: false,
			});
			if (!action) {
				return;
			}

			event.preventDefault();
			if (action === 'focus-active-room') {
				if (!focusRoomOption(activeRoomId)) {
					void focusSearchInput();
				}
				return;
			}

			if (action === 'focus-search') {
				void focusSearchInput();
				return;
			}

			if (action === 'focus-submit') {
				void focusSubmitButton();
			}
		},
		[activeRoomId, focusRoomOption, focusSearchInput, focusSubmitButton, handleSubmit],
	);

	const handleSubmitButtonKeyDown = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>) => {
			if (event.altKey || event.ctrlKey || event.metaKey) {
				return;
			}

			const action = resolveForwardDialogSubmitKeyAction({
				key: event.key,
			});
			if (action === 'focus-note') {
				event.preventDefault();
				void focusNoteField();
			}
		},
		[focusNoteField],
	);

	return (
		<Dialog.Root open={open} onOpenChange={onOpenChange}>
			<Dialog.Portal>
				<Dialog.Overlay className={styles.overlay} />
				<Dialog.Content
					className={styles.panel}
					data-testid='forward-dialog'
					onOpenAutoFocus={(event) => {
						event.preventDefault();
						window.requestAnimationFrame(() => {
							void focusSearchInput();
						});
					}}
				>
					<div className={styles.header}>
						<div className={styles.headerCopy}>
							<Dialog.Title className={styles.title}>{spaceText('转发消息')}</Dialog.Title>
							<Dialog.Description className={styles.description}>{spaceText('选择目标房间，可附一句说明')}</Dialog.Description>
						</div>

						<Dialog.Close asChild>
							<button aria-label='关闭转发对话框' className={styles.closeButton} type='button'>
								{closeGlyph}
							</button>
						</Dialog.Close>
					</div>

					<div className={styles.previewSection}>
						<p className={styles.sectionLabel}>{spaceText('原消息')}</p>
						{sourceMessage && sourceRoomTitle && previewExcerpt ? (
							<section className={styles.previewCard} data-testid='forward-preview-summary'>
								<div className={styles.previewMeta}>
									<strong className={styles.previewAuthor}>{spaceText(sourceMessage.author.displayName)}</strong>
									<span className={styles.previewSeparator}>·</span>
									<span className={styles.previewRoom}>{sourceRoomLabel}</span>
									<span className={styles.previewSeparator}>·</span>
									<span className={styles.previewTime}>{sourceTimeLabel}</span>
								</div>
								<p className={styles.previewBody} data-testid='forward-preview-body'>
									{spaceText(previewExcerpt)}
								</p>
							</section>
						) : null}
					</div>

					<div className={`${styles.section} ${styles.destinationSection}`}>
						<p className={styles.sectionLabel}>{spaceText('目标房间')}</p>
						<label className={styles.searchField}>
							<input
								className={styles.searchInput}
								data-testid='forward-search'
								onKeyDown={handleSearchKeyDown}
								onChange={(event) => setSearchValue(event.target.value)}
								placeholder={spaceText('搜索房间或联系人')}
								ref={searchInputRef}
								value={searchValue}
							/>
						</label>

						<div className={styles.roomList} data-testid='forward-room-list'>
							{groupedEntries.map((group) => (
								<section key={group.key} className={styles.roomGroup}>
									<h3 className={styles.groupTitle}>{spaceText(group.title)}</h3>
									<div className={styles.roomGroupBody}>
										{group.entries.map((entry) => {
											const secondaryMeta = resolveSidebarSecondaryMeta(entry);
											return (
												<button
													key={entry.id}
													aria-pressed={selectedRoomId === entry.id}
													className={styles.roomOption}
													data-active={selectedRoomId === entry.id ? 'true' : 'false'}
													data-testid={`forward-room-${entry.id}`}
													onClick={() => setSelectedRoomId(entry.id)}
													onFocus={() => setSelectedRoomId(entry.id)}
													onKeyDown={(event) => handleRoomOptionKeyDown(event, entry.id)}
													ref={setRoomOptionRef(entry.id)}
													tabIndex={entry.id === activeRoomId ? 0 : -1}
													type='button'
												>
													<span className={styles.roomAvatar}>
														{entry.kind === 'dm' ? getAvatarLabel(entry.title) : roomKindGlyph[entry.kind]}
													</span>
													<span className={styles.roomCopy}>
														<span className={styles.roomTitleRow}>
															<strong className={styles.roomTitle}>{spaceText(entry.title)}</strong>
															<span className={styles.roomKindTag}>{spaceText(roomKindLabel[entry.kind])}</span>
															{secondaryMeta.presence ? (
																<span
																	aria-label={spaceText(`当前状态：${secondaryMeta.presence.label}`)}
																	className={styles.roomPresenceDot}
																	data-status={secondaryMeta.presence.tone}
																	data-testid={`forward-room-presence-${entry.id}`}
																	title={spaceText(secondaryMeta.presence.label)}
																/>
															) : null}
														</span>
														<span className={styles.roomSubtitle}>{spaceText(secondaryMeta.text)}</span>
													</span>
													<span aria-hidden='true' className={styles.roomIndicator} />
												</button>
											);
										})}
									</div>
								</section>
							))}
						</div>
					</div>

					<div className={`${styles.section} ${styles.noteSection}`}>
						<p className={styles.sectionLabel}>{spaceText('附加说明')}</p>
						<textarea
							className={styles.noteField}
							data-testid='forward-note'
							onChange={(event) => setNote(event.target.value)}
							onKeyDown={handleNoteKeyDown}
							placeholder={spaceText('可选，补一句说明')}
							ref={noteFieldRef}
							rows={2}
							value={note}
						/>
					</div>

					<div className={styles.footer}>
						{submitError ? <p className={styles.errorText}>{spaceText(submitError)}</p> : null}
						<button
							className={styles.submitButton}
							data-testid='forward-submit'
							disabled={!selectedRoomId || isSubmitting}
							onKeyDown={handleSubmitButtonKeyDown}
							onClick={() => void handleSubmit()}
							ref={submitButtonRef}
							type='button'
						>
							{spaceText(isSubmitting ? '转发中…' : '转发')}
						</button>
					</div>
				</Dialog.Content>
			</Dialog.Portal>
		</Dialog.Root>
	);
};
