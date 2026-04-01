import { Fragment, useCallback, useEffect, useRef, useState } from 'react';

import { shellRooms, timelineMessages } from '@/data/demo';

import { MarkdownContent } from '@/components/MarkdownContent';
import { Button, Panel, Section } from '@/components/ui';
import { getAvatarLabel } from '@/lib/avatar';
import { spaceText } from '@/lib/text';
import styles from './ShellPage.module.css';

export const ShellPage = () => {
	const [expandedMessages, setExpandedMessages] = useState<Record<string, boolean>>({});
	const [showJumpToUnread, setShowJumpToUnread] = useState(false);
	const [showJumpToBottom, setShowJumpToBottom] = useState(false);
	const firstUnreadIndex = timelineMessages.findIndex((message) => message.status === 'unread');
	const unreadCount = timelineMessages.filter((message) => message.status === 'unread').length;
	const messageStreamRef = useRef<HTMLDivElement>(null);
	const unreadDividerRef = useRef<HTMLDivElement>(null);

	const scrollToUnread = useCallback((behavior: ScrollBehavior = 'smooth') => {
		const container = messageStreamRef.current;
		const unreadDivider = unreadDividerRef.current;

		if (!container || !unreadDivider) {
			return;
		}

		container.scrollTo({
			top: Math.max(unreadDivider.offsetTop - 72, 0),
			behavior,
		});
	}, []);

	const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
		const container = messageStreamRef.current;

		if (!container) {
			return;
		}

		container.scrollTo({
			top: container.scrollHeight,
			behavior,
		});
	}, []);

	const updateFloatingActions = useCallback(() => {
		const container = messageStreamRef.current;

		if (!container) {
			return;
		}

		const { scrollTop, clientHeight, scrollHeight } = container;
		const bottomGap = scrollHeight - (scrollTop + clientHeight);
		const unreadTop = unreadDividerRef.current?.offsetTop ?? null;
		const isAboveUnread = unreadTop !== null && unreadTop > scrollTop + 88;
		const isPastUnread = unreadTop !== null && unreadTop < scrollTop - 24;

		setShowJumpToUnread(isAboveUnread);
		setShowJumpToBottom(unreadTop === null ? bottomGap > 140 : !isAboveUnread && isPastUnread && bottomGap > 140);
	}, []);

	useEffect(() => {
		if (firstUnreadIndex < 0) {
			return;
		}

		const frameId = window.requestAnimationFrame(() => {
			scrollToUnread('auto');
			updateFloatingActions();
		});

		return () => window.cancelAnimationFrame(frameId);
	}, [firstUnreadIndex, scrollToUnread, updateFloatingActions]);

	useEffect(() => {
		const container = messageStreamRef.current;

		if (!container) {
			return;
		}

		updateFloatingActions();
		container.addEventListener('scroll', updateFloatingActions, { passive: true });
		window.addEventListener('resize', updateFloatingActions);

		return () => {
			container.removeEventListener('scroll', updateFloatingActions);
			window.removeEventListener('resize', updateFloatingActions);
		};
	}, [updateFloatingActions]);

	useEffect(() => {
		updateFloatingActions();
	}, [expandedMessages, updateFloatingActions]);

	const jumpAction = showJumpToUnread
		? {
				label: `${unreadCount} 条未读`,
				tone: 'accent' as const,
				onClick: () => scrollToUnread(),
		  }
		: showJumpToBottom
			? {
					label: '最新',
					tone: 'neutral' as const,
					onClick: () => scrollToBottom(),
			  }
			: null;

	return (
		<div className={styles.page}>
			<Section
				eyebrow='工作台'
				title='用中文重新检验整个壳层'
				description='如果这套系统真的以中文为主，那么侧栏、房间头部、消息流和输入区都应该在中文密度下依然清楚、自然、稳定。'
			>
				<div className={styles.workspace}>
					<aside className={styles.sidebar}>
						<div className={styles.sidebarHeader}>
							<p className={styles.sidebarEyebrow}>工作区</p>
							<h3 className={styles.sidebarTitle}>北域协作</h3>
						</div>

						<div className={styles.searchBlock}>
							<div className={styles.commandBar}>
								<span className={styles.commandLabel}>跳转到房间</span>
								<span className={styles.commandShortcut} aria-hidden='true'>
									<span className={styles.keycap}>⌘</span>
									<span className={styles.keycap}>K</span>
								</span>
							</div>
						</div>

						<nav className={styles.roomList}>
							{shellRooms.map((room, index) => (
								<button key={room.name} className={styles.roomRow} data-active={index === 0 ? 'true' : 'false'} type='button'>
									<div className={styles.roomInfo}>
										<span className={styles.roomName}>{spaceText(room.name)}</span>
										<span className={styles.roomStatus}>{spaceText(room.status)}</span>
									</div>
									{room.unread > 0 ? (
										<span className={styles.roomBadge} data-tone={room.tone}>
											{room.unread}
										</span>
									) : null}
								</button>
							))}
						</nav>
					</aside>

					<section className={styles.timelinePanel}>
						<header className={styles.timelineHeader}>
							<div className={styles.timelineIdentity}>
								<p className={styles.roomMeta}>频道</p>
								<div className={styles.timelineTitleRow}>
									<h3 className={styles.timelineTitle}>运营协调</h3>
									<span className={styles.timelinePresence}>
										<span className={styles.presenceDot} />
										12 人在线
									</span>
								</div>
								<p className={styles.timelineSummary}>Rocket.Chat 7.6.0 兼容评审与交接同步</p>
							</div>
						</header>

						<div className={styles.messageViewport}>
							<div ref={messageStreamRef} className={styles.messageStream}>
								{timelineMessages.map((message, index) => {
									const isExpanded = expandedMessages[message.id] ?? !message.collapsed;
									const isCollapsible = Boolean(message.collapsed);

									return (
										<Fragment key={message.id}>
											{index === firstUnreadIndex ? (
												<div ref={unreadDividerRef} className={styles.unreadDivider}>
													<span>{spaceText(`${message.time} 之后 ${unreadCount} 条未读`)}</span>
												</div>
											) : null}

											<article className={styles.messageRow} data-status={message.status}>
												<div className={styles.avatar} data-tone={message.tone}>
													{getAvatarLabel(message.author)}
												</div>
												<div className={styles.messageBody}>
													<div className={styles.messageMeta}>
														<strong>{spaceText(message.author)}</strong>
														<span>{spaceText(message.role)}</span>
														<time>{message.time}</time>
													</div>
													{message.replyTo ? (
														<div className={styles.replyPreview} data-long={message.replyTo.long ? 'true' : 'false'}>
															<span aria-hidden='true' className={styles.replyGlyph}>
																↳
															</span>
															<div className={styles.replyCard}>
																<div className={styles.replyMeta}>
																	<span className={styles.replyLabel}>回复</span>
																	<strong>{spaceText(message.replyTo.author)}</strong>
																	{message.replyTo.long ? <span className={styles.replyHint}>长消息</span> : null}
																</div>
																<p className={styles.replyExcerpt}>{spaceText(message.replyTo.excerpt)}</p>
															</div>
														</div>
													) : null}
													<div className={styles.messageContent} data-collapsed={isCollapsible && !isExpanded ? 'true' : 'false'}>
														<MarkdownContent dense source={message.body} />
													</div>
													{isCollapsible ? (
														<button
															className={styles.messageToggle}
															onClick={() =>
																setExpandedMessages((currentState) => ({
																	...currentState,
																	[message.id]: !(currentState[message.id] ?? !message.collapsed),
																}))
															}
															type='button'
														>
															{isExpanded ? '收起' : '展开全文'}
														</button>
													) : null}
													{message.thread ? (
														<div className={styles.threadMeta}>
															<span className={styles.threadCount}>{spaceText(`${message.thread.replies} 条回复`)}</span>
															{message.thread.lastReply ? (
																<span>{spaceText(`最后回复 ${message.thread.lastReply}`)}</span>
															) : null}
															{message.thread.time ? <span>{message.thread.time}</span> : null}
														</div>
													) : null}
												</div>
											</article>
										</Fragment>
									);
								})}
							</div>

							{jumpAction ? (
								<div className={styles.jumpDock}>
									<button className={styles.jumpButton} data-tone={jumpAction.tone} onClick={jumpAction.onClick} type='button'>
										{jumpAction.tone === 'accent' ? <span className={styles.jumpDot} /> : null}
										<span className={styles.jumpLabel}>{spaceText(jumpAction.label)}</span>
										<span aria-hidden='true' className={styles.jumpArrow}>
											↓
										</span>
									</button>
								</div>
							) : null}
						</div>

						<footer className={styles.composer}>
							<textarea
								className={styles.textarea}
								defaultValue='先把信息层级收紧，保证 Rocket.Chat 7.6.0 的复杂消息读起来更顺。'
							/>
							<div className={styles.composerFooter}>
								<div className={styles.composerHints}>
									<span className={styles.composerHint}>@ 提及</span>
									<span className={styles.composerHint}>附件</span>
									<span className={styles.composerHint}>/ 命令</span>
								</div>
								<Button>发送消息</Button>
							</div>
						</footer>
					</section>

					<aside className={styles.contextPanel}>
						<Panel className={styles.contextCard}>
							<p className={styles.contextEyebrow}>房间备注</p>
							<h3 className={styles.contextTitle}>信号先于装饰</h3>
							<p className={styles.contextText}>右侧面板要像辅助上下文，而不是第二个仪表盘。中文内容一多，这一点会更明显。</p>
						</Panel>

						<Panel className={styles.contextCard}>
							<p className={styles.contextEyebrow}>检查点</p>
							<ul className={styles.contextList}>
								<li>消息流是否仍然易读</li>
								<li>界面噪音是否足够低</li>
								<li>激活状态是否清楚</li>
								<li>空间是否没有被浪费</li>
							</ul>
						</Panel>
					</aside>
				</div>
			</Section>
		</div>
	);
};
