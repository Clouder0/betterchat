import { MetricCard, Panel, ReviewDialog, Section, Tag } from '@/components/ui';
import styles from './OverviewPage.module.css';

export const OverviewPage = () => (
	<div className={styles.page}>
		<Section
			eyebrow='方向'
			title='现代、克制、优雅。'
			description='这一次不只是重新配色，而是把中文作为主要语言重新校准字体、节奏和信息层级。界面要先像真实工作产品，再谈展示感。'
		>
			<div className={styles.heroGrid}>
				<Panel className={styles.heroPanel}>
					<div className={styles.heroCopy}>
						<Tag tone='support'>中文优先</Tag>
						<h3 className={styles.heroTitle}>一个完整壳层，低噪界面，清晰层级。</h3>
						<p className={styles.heroText}>配色围绕柏木绿、橄榄灰与陶土暖色展开，并用温暖石色作为整体基底，让中文内容读起来更自然。</p>
					</div>

					<div className={styles.heroActions}>
						<ReviewDialog
							triggerLabel='评审说明'
							title='当前方向'
							description='这次调整不是简单翻译，而是用中文重新检验标题、标签、消息流和控制组件是否成立。'
						>
							<div className={styles.reviewList}>
								<p>把颜色当作材质关系，而不是界面装饰。</p>
								<p>让柏木绿和橄榄灰自然落在温暖石色基底之中。</p>
								<p>陶土色只作为暖意和提醒，不承担主要视觉压力。</p>
							</div>
						</ReviewDialog>
					</div>
				</Panel>

				<div className={styles.metrics}>
					<MetricCard
						className={styles.metricAccent}
						label='方向'
						value='精确现代主义'
						hint='强调结构、克制和真实产品感。'
					/>
					<MetricCard
						className={styles.metricSupport}
						label='密度'
						value='紧凑但平静'
						hint='面对日常协作信息密度仍然易读。'
					/>
					<MetricCard
						className={styles.metricAlloy}
						label='配色'
						value='柏木 / 橄榄 / 陶土'
						hint='信号、支撑、温度。'
					/>
				</div>
			</div>
		</Section>

		<Section
			eyebrow='变化'
			title='这次调整了什么'
			description='重点不是把英文换成中文，而是让中文在标题、标签、辅助信息和正文里都有合适的节奏与视觉重心。'
		>
			<div className={styles.checkGrid}>
				<Panel>
					<h3 className={styles.panelTitle}>去掉</h3>
					<ul className={styles.list}>
						<li>偏英文展示稿的排版习惯</li>
						<li>不自然的电性色彩倾向</li>
						<li>过度依赖大圆角和胶囊形态</li>
						<li>像设计宣言一样的文案语气</li>
					</ul>
				</Panel>

				<Panel>
					<h3 className={styles.panelTitle}>保留</h3>
					<ul className={styles.list}>
						<li>明确的明暗主题</li>
						<li>清晰的阅读顺序</li>
						<li>克制的强调色纪律</li>
						<li>以聊天工作台为中心</li>
					</ul>
				</Panel>
			</div>
		</Section>
	</div>
);
