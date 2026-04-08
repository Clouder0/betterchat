import styles from './AppShellRouteFallback.module.css';

const sidebarRowWidths = ['62%', '78%', '56%', '70%', '48%'] as const;
const timelineClusterWidths = [
	['24%', '58%', '42%'],
	['30%', '64%'],
	['18%', '52%', '36%'],
] as const;

export const AppShellRouteFallback = () => (
	<div
		aria-busy='true'
		aria-label='正在加载工作区'
		className={styles.shell}
		data-testid='app-shell-route-fallback'
		data-theme-surface='true'
	>
		<aside aria-hidden='true' className={styles.sidebar} data-theme-surface='true'>
			<div className={styles.sidebarHeader}>
				<div className={`${styles.block} ${styles.brandMark}`} />
				<div className={`${styles.block} ${styles.brandTitle}`} />
			</div>
			<div className={`${styles.block} ${styles.search}`} />
			<div className={styles.roomList}>
				{sidebarRowWidths.map((width, index) => (
					<div key={width} className={styles.roomRow}>
						<div className={`${styles.block} ${styles.roomIcon}`} />
						<div className={styles.roomBody}>
							<div className={`${styles.block} ${styles.roomTitle}`} style={{ width }} />
							<div
								className={`${styles.block} ${styles.roomMeta}`}
								style={{ width: `${Math.max(Number.parseInt(width, 10) - 16, 24)}%` }}
							/>
						</div>
						<div className={`${styles.block} ${styles.roomBadge}`} data-visible={index < 2 ? 'true' : 'false'} />
					</div>
				))}
			</div>
		</aside>

		<main aria-hidden='true' className={styles.main} data-theme-surface='true'>
			<header className={styles.mainHeader}>
				<div className={styles.headerIdentity}>
					<div className={`${styles.block} ${styles.title}`} />
					<div className={`${styles.block} ${styles.subtitle}`} />
				</div>
				<div className={styles.headerActions}>
					<div className={`${styles.block} ${styles.action}`} />
					<div className={`${styles.block} ${styles.action}`} />
				</div>
			</header>

			<section className={styles.timeline}>
				{timelineClusterWidths.map((widths, clusterIndex) => (
					<div key={clusterIndex} className={styles.timelineCluster}>
						<div className={`${styles.block} ${styles.avatar}`} />
						<div className={styles.messageBody}>
							{widths.map((width) => (
								<div key={`${clusterIndex}-${width}`} className={`${styles.block} ${styles.messageLine}`} style={{ width }} />
							))}
						</div>
					</div>
				))}
			</section>

			<footer className={styles.composerLane}>
				<div className={`${styles.block} ${styles.composer}`} />
			</footer>
		</main>
	</div>
);
