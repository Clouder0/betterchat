import { systemTokens } from '@/data/demo';

import { Button, Field, Panel, Section, SurfaceTabs, Tag } from '@/components/ui';
import styles from './SystemPage.module.css';

const tokenGroups = Object.entries(systemTokens);

export const SystemPage = () => (
	<div className={styles.page}>
		<Section
			eyebrow='系统'
			title='色板、基础组件与中文排版'
			description='这一页不是看功能，而是判断这套系统是否真的能支撑中文为主的产品界面，包括色板、组件、标签语气和正文节奏。'
		>
			<SurfaceTabs
				defaultValue='tokens'
				items={[
					{
						value: 'tokens',
						label: '色板',
						content: (
							<div className={styles.tokenGroups}>
								{tokenGroups.map(([name, colors]) => (
									<Panel key={name}>
										<div className={styles.tokenHeader}>
											<h3>{name}</h3>
											<Tag>{name} 组</Tag>
										</div>
										<div className={styles.swatches}>
											{colors.map((color) => (
												<div key={color} className={styles.swatch}>
													<div className={styles.color} style={{ background: color }} />
													<code>{color}</code>
												</div>
											))}
										</div>
									</Panel>
								))}
							</div>
						),
					},
					{
						value: 'components',
						label: '组件',
						content: (
							<div className={styles.componentGrid}>
								<Panel>
									<h3 className={styles.panelTitle}>按钮</h3>
									<div className={styles.controlRow}>
										<Button>主要操作</Button>
										<Button tone='secondary'>次级操作</Button>
										<Button tone='ghost'>幽灵按钮</Button>
									</div>
								</Panel>

								<Panel>
									<h3 className={styles.panelTitle}>标签</h3>
									<div className={styles.controlRow}>
										<Tag>中性</Tag>
										<Tag tone='accent'>强调</Tag>
										<Tag tone='warning'>提醒</Tag>
										<Tag tone='success'>稳定</Tag>
									</div>
								</Panel>

								<Panel className={styles.formPanel}>
									<h3 className={styles.panelTitle}>输入框</h3>
									<div className={styles.formGrid}>
										<Field label='频道名称' placeholder='运营协调' />
										<Field label='频道说明' placeholder='值班与跨团队同步频道' />
									</div>
								</Panel>
							</div>
						),
					},
					{
						value: 'typography',
						label: '排版',
						content: (
							<div className={styles.typeGrid}>
								<Panel className={styles.typePanel}>
									<p className={styles.typeEyebrow}>标题语言</p>
									<h3 className={styles.displayLine}>安静界面，快速信号。</h3>
									<p className={styles.bodySample}>
										BetterChat 的标题不应该像广告语，而应该像产品界面本身的一部分。中文要稳、清楚、不过度挤压。
									</p>
								</Panel>

								<Panel className={styles.typePanel}>
									<p className={styles.typeEyebrow}>元信息语气</p>
									<div className={styles.metaBlock}>
										<div className={styles.metaRow}>
											<span className={styles.metaKey}>工作区</span>
											<strong>北域协作</strong>
										</div>
										<div className={styles.metaRow}>
											<span className={styles.metaKey}>频道</span>
											<strong>运营协调</strong>
										</div>
										<div className={styles.metaRow}>
											<span className={styles.metaKey}>状态</span>
											<Tag tone='accent'>12 人在线</Tag>
										</div>
									</div>
								</Panel>

								<Panel className={styles.voicePanel}>
									<p className={styles.typeEyebrow}>界面口吻</p>
									<div className={styles.voiceTags}>
										<Tag>克制</Tag>
										<Tag>平静</Tag>
										<Tag>清晰</Tag>
										<Tag tone='accent'>有判断</Tag>
									</div>
									<p className={styles.bodySample}>
										产品语气应该像内部工作台，而不是营销页面。它不需要讨好，也不该冰冷，而要显得有分寸、有判断。
									</p>
								</Panel>
							</div>
						),
					},
				]}
			/>
		</Section>
	</div>
);
