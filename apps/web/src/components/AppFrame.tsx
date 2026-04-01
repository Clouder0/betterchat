import { Link, useRouterState } from '@tanstack/react-router';
import type { PropsWithChildren } from 'react';

import { ThemeToggle } from '@/app/ThemeProvider';
import { spaceText } from '@/lib/text';
import styles from './AppFrame.module.css';

const navigation = [
	{ to: '/', label: '总览' },
	{ to: '/shell', label: '工作台' },
	{ to: '/content', label: '内容' },
	{ to: '/system', label: '系统' },
] as const;

export const AppFrame = ({ children }: PropsWithChildren) => {
	const pathname = useRouterState({
		select: (state) => state.location.pathname,
	});

	return (
		<div className={styles.frame}>
			<header className={styles.header}>
				<div className={styles.brandBlock}>
					<div className={styles.brandMark} />
					<div>
						<p className={styles.brandEyebrow}>{spaceText('Rocket.Chat 7.6.0客户端评审')}</p>
						<h1 className={styles.brandTitle}>BetterChat</h1>
					</div>
				</div>

				<nav className={styles.nav}>
					{navigation.map((item) => (
						<Link
							key={item.to}
							to={item.to}
							className={styles.navLink}
							data-active={pathname === item.to ? 'true' : 'false'}
						>
							{spaceText(item.label)}
						</Link>
					))}
				</nav>

				<div className={styles.controls}>
					<div className={styles.environmentPill}>{spaceText('中文优先界面研究')}</div>
					<ThemeToggle />
				</div>
			</header>

			<main className={styles.content}>{children}</main>
		</div>
	);
};
