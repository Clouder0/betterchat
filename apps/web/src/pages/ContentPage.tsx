import { markdownMessages, markdownReference, showcaseMessages } from '@/data/demo';

import { MarkdownContent } from '@/components/MarkdownContent';
import { Panel, Section, Tag } from '@/components/ui';
import { getAvatarLabel } from '@/lib/avatar';
import { spaceText } from '@/lib/text';
import styles from './ContentPage.module.css';

export const ContentPage = () => (
	<div className={styles.page}>
		<Section
			eyebrow='内容'
			title='Markdown、代码块与数学公式'
			description='这一页专门评估内容渲染，而不是壳层本身。目标是让 Markdown、KaTeX、表格和代码块在中文界面里仍然像同一套产品语言。'
		>
			<div className={styles.heroGrid}>
				<Panel className={styles.referencePanel}>
					<div className={styles.panelHeader}>
						<div>
							<p className={styles.panelEyebrow}>长内容视图</p>
							<h3 className={styles.panelTitle}>文档型渲染</h3>
						</div>
						<div className={styles.panelTags}>
							<Tag tone='accent'>Markdown</Tag>
							<Tag tone='support'>GFM</Tag>
							<Tag tone='warning'>KaTeX</Tag>
						</div>
					</div>
					<MarkdownContent source={markdownReference} />
				</Panel>

				<div className={styles.noteStack}>
					<Panel className={styles.notePanel}>
						<p className={styles.noteEyebrow}>评审重点</p>
						<h3 className={styles.noteTitle}>内容不能像插件贴片</h3>
						<p className={styles.noteText}>
							如果代码块、表格、长消息或公式一出现，就破坏整体气质，那设计系统实际上还没有闭环。
						</p>
					</Panel>

					<Panel className={styles.notePanel}>
						<p className={styles.noteEyebrow}>关注点</p>
						<ul className={styles.checkList}>
							<li>标题与正文是否仍然稳</li>
							<li>表格是否像产品，而不是文档站</li>
							<li>公式框是否清楚但不突兀</li>
							<li>代码块是否有足够的技术气质</li>
							<li>长消息是否仍然能被快速扫读</li>
						</ul>
					</Panel>
				</div>
			</div>
		</Section>

		<Section
			eyebrow='消息'
			title='聊天消息中的富文本'
			description='聊天消息里的 Markdown 不能直接照搬长文样式。它需要更紧凑，但仍然要保持层级、公式可读性和代码块边界。'
		>
			<div className={styles.messageStack}>
				{markdownMessages.map((message) => (
					<article key={message.id} className={styles.messageCard}>
						<div className={styles.avatar} data-tone={message.tone}>
							{getAvatarLabel(message.author)}
						</div>
						<div className={styles.messageMain}>
							<div className={styles.messageMeta}>
								<strong>{spaceText(message.author)}</strong>
								<span>{spaceText(message.role)}</span>
								<time>{message.time}</time>
							</div>
							<MarkdownContent dense source={message.body} />
						</div>
					</article>
				))}
			</div>
		</Section>

		<Section
			eyebrow='场景'
			title='更复杂的聊天消息样本'
			description='这里故意把超长说明、数学解释、技术代码与决策日志都放回聊天语境里，确认这套设计不是只能做“短消息截图”。'
		>
			<div className={styles.scenarioGrid}>
				{showcaseMessages.map((message) => (
					<article key={message.id} className={styles.scenarioCard}>
						<div className={styles.scenarioHeader}>
							<div className={styles.avatar} data-tone={message.tone}>
								{getAvatarLabel(message.author)}
							</div>
							<div className={styles.scenarioIntro}>
								<div className={styles.messageMeta}>
									<strong>{spaceText(message.author)}</strong>
									<span>{spaceText(message.role)}</span>
									<time>{message.time}</time>
								</div>
								<h3 className={styles.scenarioTitle}>{spaceText(message.title)}</h3>
							</div>
						</div>

						<div className={styles.scenarioTags}>
							{message.tags.map((tag) => (
								<Tag key={`${message.id}-${tag}`}>{tag}</Tag>
							))}
						</div>

						<MarkdownContent dense source={message.body} />
					</article>
				))}
			</div>
		</Section>
	</div>
);
