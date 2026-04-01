import * as Dialog from '@radix-ui/react-dialog';

import { type MotionPreference } from '@/app/motionPreference';
import { type ResolvedTheme, type ThemePreference } from '@/app/ThemeProvider';
import {
	composerSendShortcutOptions,
	type ComposerSendShortcut,
} from '@/features/composer/sendShortcutPreference';
import { spaceText } from '@/lib/text';

import styles from './SettingsPanel.module.css';

const themeOptions = [
	{ value: 'light', label: '浅色' },
	{ value: 'dark', label: '深色' },
	{ value: 'auto', label: '跟随系统' },
] as const satisfies readonly {
	label: string;
	value: ThemePreference;
}[];

const motionOptions = [
	{ value: 'enabled', label: '开启' },
	{ value: 'disabled', label: '关闭' },
] as const satisfies readonly {
	label: string;
	value: MotionPreference;
}[];

const settingsGlyph = (
	<svg aria-hidden='true' className={styles.triggerIcon} viewBox='0 0 24 24'>
		<path
			d='M6 7.25h12M6 12h12M6 16.75h12M9.25 7.25a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm9 4.75a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Zm-3.5 4.75a1.75 1.75 0 1 1-3.5 0 1.75 1.75 0 0 1 3.5 0Z'
			fill='none'
			stroke='currentColor'
			strokeLinecap='round'
			strokeLinejoin='round'
			strokeWidth='1.45'
		/>
	</svg>
);

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

export const SettingsPanel = ({
	onOpenChange,
	onComposerSendShortcutChange,
	onLogout,
	onMotionPreferenceChange,
	onThemePreferenceChange,
	logoutPending = false,
	motionPreference,
	open,
	resolvedTheme,
	sendShortcut,
	themePreference,
}: {
	onOpenChange: (open: boolean) => void;
	onComposerSendShortcutChange: (value: ComposerSendShortcut) => void;
	onLogout: () => void;
	onMotionPreferenceChange: (value: MotionPreference) => void;
	onThemePreferenceChange: (value: ThemePreference) => void;
	logoutPending?: boolean;
	motionPreference: MotionPreference;
	open: boolean;
	resolvedTheme: ResolvedTheme;
	sendShortcut: ComposerSendShortcut;
	themePreference: ThemePreference;
}) => (
	<Dialog.Root open={open} onOpenChange={onOpenChange}>
		<Dialog.Trigger asChild>
			<button
				aria-label='打开设置'
				aria-keyshortcuts='Control+, Meta+,'
				className={styles.trigger}
				data-testid='settings-trigger'
				title='设置'
				type='button'
			>
				{settingsGlyph}
				<span className={styles.triggerLabel}>{spaceText('设置')}</span>
			</button>
		</Dialog.Trigger>

		<Dialog.Portal>
			<Dialog.Overlay className={styles.overlay} />
			<Dialog.Content className={styles.panel} data-testid='settings-panel' data-theme-surface='true'>
				<div className={styles.header}>
					<div className={styles.headerCopy}>
						<Dialog.Title className={styles.title}>{spaceText('设置')}</Dialog.Title>
						<Dialog.Description className={styles.description}>{spaceText('本地界面偏好')}</Dialog.Description>
					</div>

					<Dialog.Close asChild>
						<button
							aria-label='关闭设置'
							className={styles.closeButton}
							data-testid='settings-close'
							type='button'
						>
							{closeGlyph}
						</button>
					</Dialog.Close>
				</div>

				<section className={styles.section}>
					<div className={styles.sectionHeader}>
						<p className={styles.sectionLabel}>{spaceText('外观')}</p>
						<p className={styles.sectionHint}>
							{spaceText(
								themePreference === 'auto'
									? `当前跟随系统：${resolvedTheme === 'dark' ? '深色' : '浅色'}`
									: `当前使用：${resolvedTheme === 'dark' ? '深色' : '浅色'}`,
							)}
						</p>
					</div>

					<div className={styles.segmentedGroup} role='group' aria-label='主题模式'>
						{themeOptions.map((option) => (
							<button
								key={option.value}
								className={styles.segmentedButton}
								data-active={themePreference === option.value ? 'true' : 'false'}
								data-testid={`settings-theme-${option.value}`}
								onClick={() => onThemePreferenceChange(option.value)}
								type='button'
							>
								{spaceText(option.label)}
							</button>
						))}
					</div>
				</section>

				<section className={styles.section}>
					<div className={styles.sectionHeader}>
						<p className={styles.sectionLabel}>{spaceText('消息输入')}</p>
						<p className={styles.sectionHint}>{spaceText('控制回车与换行的默认行为')}</p>
					</div>

					<div className={styles.optionList} role='radiogroup' aria-label='发送快捷键'>
						{composerSendShortcutOptions.map((option) => (
							<button
								key={option.value}
								aria-checked={sendShortcut === option.value}
								className={styles.optionCard}
								data-active={sendShortcut === option.value ? 'true' : 'false'}
								data-testid={`settings-send-mode-${option.value}`}
								onClick={() => onComposerSendShortcutChange(option.value)}
								role='radio'
								type='button'
							>
								<span className={styles.optionCopy}>
									<strong className={styles.optionTitle}>{spaceText(option.label)}</strong>
									<span className={styles.optionDescription}>{spaceText(option.description)}</span>
								</span>
								<span aria-hidden='true' className={styles.optionIndicator} />
							</button>
						))}
					</div>
				</section>

				<section className={styles.section}>
					<div className={styles.sectionHeader}>
						<p className={styles.sectionLabel}>{spaceText('动效')}</p>
						<p className={styles.sectionHint}>{spaceText('关闭后停用滚动动画、过渡与提示动效')}</p>
					</div>

					<div className={styles.binarySegmentedGroup} role='group' aria-label='界面动效'>
						{motionOptions.map((option) => (
							<button
								key={option.value}
								className={styles.segmentedButton}
								data-active={motionPreference === option.value ? 'true' : 'false'}
								data-testid={`settings-motion-${option.value}`}
								onClick={() => onMotionPreferenceChange(option.value)}
								type='button'
							>
								{spaceText(option.label)}
							</button>
						))}
					</div>
				</section>

				<section className={styles.section}>
					<div className={styles.sectionHeader}>
						<p className={styles.sectionLabel}>{spaceText('会话')}</p>
						<p className={styles.sectionHint}>{spaceText('结束当前 BetterChat 登录会话')}</p>
					</div>

					<div className={styles.sessionActions}>
						<button
							className={styles.sessionButton}
							data-testid='settings-logout'
							disabled={logoutPending}
							onClick={onLogout}
							type='button'
						>
							{spaceText(logoutPending ? '正在退出…' : '退出登录')}
						</button>
					</div>
				</section>
			</Dialog.Content>
		</Dialog.Portal>
	</Dialog.Root>
);
