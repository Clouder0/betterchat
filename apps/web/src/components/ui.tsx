import * as Dialog from '@radix-ui/react-dialog';
import * as Tabs from '@radix-ui/react-tabs';
import type { PropsWithChildren, ReactNode } from 'react';
import type { ButtonHTMLAttributes, HTMLAttributes } from 'react';

import { spaceReactNode, spaceText } from '@/lib/text';
import styles from './ui.module.css';

export const Section = ({
	title,
	eyebrow,
	description,
	children,
}: PropsWithChildren<{ title: string; eyebrow?: string; description?: string }>) => (
	<section className={styles.section}>
		<div className={styles.sectionHeader}>
			{eyebrow ? <p className={styles.eyebrow}>{spaceText(eyebrow)}</p> : null}
			<h2 className={styles.sectionTitle}>{spaceText(title)}</h2>
			{description ? <p className={styles.sectionDescription}>{spaceText(description)}</p> : null}
		</div>
		{children}
	</section>
);

export const Panel = ({
	children,
	className = '',
	...props
}: PropsWithChildren<HTMLAttributes<HTMLDivElement>>) => (
	<div className={`${styles.panel} ${className}`.trim()} {...props}>
		{children}
	</div>
);

export const MetricCard = ({
	label,
	value,
	hint,
	className = '',
}: {
	label: string;
	value: string;
	hint: string;
	className?: string;
}) => (
	<div className={`${styles.metricCard} ${className}`.trim()}>
		<p className={styles.metricLabel}>{spaceText(label)}</p>
		<div className={styles.metricValue}>{spaceText(value)}</div>
		<p className={styles.metricHint}>{spaceText(hint)}</p>
	</div>
);

export const Tag = ({
	children,
	tone = 'neutral',
}: PropsWithChildren<{ tone?: 'neutral' | 'accent' | 'support' | 'success' | 'warning' }>) => (
	<span className={styles.tag} data-tone={tone}>
		{spaceReactNode(children)}
	</span>
);

export const Button = ({
	children,
	tone = 'primary',
	className = '',
	type = 'button',
	...props
}: PropsWithChildren<ButtonHTMLAttributes<HTMLButtonElement> & { tone?: 'primary' | 'secondary' | 'ghost' }>) => (
	<button className={`${styles.button} ${className}`.trim()} data-tone={tone} type={type} {...props}>
		{spaceReactNode(children)}
	</button>
);

export const Field = ({ label, placeholder }: { label: string; placeholder: string }) => (
	<label className={styles.field}>
		<span className={styles.fieldLabel}>{spaceText(label)}</span>
		<input className={styles.input} placeholder={spaceText(placeholder)} />
	</label>
);

export const SurfaceTabs = ({
	items,
	defaultValue,
}: {
	items: Array<{ value: string; label: string; content: ReactNode }>;
	defaultValue: string;
}) => (
	<Tabs.Root className={styles.tabs} defaultValue={defaultValue}>
		<Tabs.List className={styles.tabsList}>
			{items.map((item) => (
				<Tabs.Trigger key={item.value} className={styles.tabsTrigger} value={item.value}>
					{spaceText(item.label)}
				</Tabs.Trigger>
			))}
		</Tabs.List>
		{items.map((item) => (
			<Tabs.Content key={item.value} className={styles.tabsContent} value={item.value}>
				{item.content}
			</Tabs.Content>
		))}
	</Tabs.Root>
);

export const ReviewDialog = ({
	triggerLabel,
	title,
	description,
	children,
}: PropsWithChildren<{ triggerLabel: string; title: string; description: string }>) => (
	<Dialog.Root>
		<Dialog.Trigger asChild>
			<button className={styles.button} data-tone='secondary' type='button'>
				{spaceText(triggerLabel)}
			</button>
		</Dialog.Trigger>
		<Dialog.Portal>
			<Dialog.Overlay className={styles.dialogOverlay} />
			<Dialog.Content className={styles.dialogContent}>
				<Dialog.Title className={styles.dialogTitle}>{spaceText(title)}</Dialog.Title>
				<Dialog.Description className={styles.dialogDescription}>{spaceText(description)}</Dialog.Description>
				<div className={styles.dialogBody}>{children}</div>
				<div className={styles.dialogActions}>
					<Dialog.Close asChild>
						<button className={styles.button} data-tone='ghost' type='button'>
							关闭
						</button>
					</Dialog.Close>
					<button className={styles.button} data-tone='primary' type='button'>
						确认方向
					</button>
				</div>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
);
