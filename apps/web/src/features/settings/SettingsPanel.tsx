import * as Dialog from '@radix-ui/react-dialog';

import { type MotionPreference } from '@/app/motionPreference';
import { type BrowserNotificationDelivery, type BrowserNotificationPermissionState, type RoomNotificationDefaults, type RoomNotificationPreference } from '@/features/notifications/notificationPreferences';
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

const browserNotificationOptions = [
	{ value: 'off', label: '关闭', description: '不在此浏览器弹出 BetterChat 通知' },
	{ value: 'foreground', label: '前台', description: '仅在 BetterChat 打开时允许浏览器通知' },
	{ value: 'background', label: '后台', description: '当前构建预留该模式，尚未开放后台推送' },
] as const satisfies readonly {
	description: string;
	label: string;
	value: BrowserNotificationDelivery;
}[];

const roomPreferenceOptions = [
	{ value: 'all', label: '所有消息' },
	{ value: 'personal', label: '仅个人相关' },
	{ value: 'mute', label: '静音' },
] as const satisfies readonly {
	label: string;
	value: RoomNotificationPreference;
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

const resolveBrowserNotificationHint = ({
	backgroundSupported,
	delivery,
	permission,
}: {
	backgroundSupported: boolean;
	delivery: BrowserNotificationDelivery;
	permission: BrowserNotificationPermissionState;
}) => {
	if (permission === 'unsupported') {
		return '当前浏览器不支持 Notification API。';
	}

	if (permission === 'denied') {
		return '浏览器权限已阻止；设置会保留，但当前无法真正送达。';
	}

	if (permission === 'default' && delivery !== 'off') {
		return '开启通知时会向浏览器申请授权。';
	}

	if (!backgroundSupported) {
		return delivery === 'off'
			? '当前仅支持前台浏览器通知。'
			: '当前构建仅支持 BetterChat 打开时的浏览器通知。';
	}

	if (delivery === 'background') {
		return '允许在 BetterChat 不在前台时继续接收通知。';
	}

	if (delivery === 'foreground') {
		return '仅在 BetterChat 打开时允许浏览器通知。';
	}

	return '浏览器通知已关闭。';
};

export const SettingsPanel = ({
	browserNotificationBackgroundSupported,
	browserNotificationDelivery,
	browserNotificationPermission,
	onBrowserNotificationDeliveryChange,
	onComposerSendShortcutChange,
	onLogout,
	onMotionPreferenceChange,
	onOpenChange,
	onRoomNotificationDefaultsChange,
	onThemePreferenceChange,
	logoutPending = false,
	motionPreference,
	open,
	resolvedTheme,
	roomNotificationDefaults,
	sendShortcut,
	themePreference,
}: {
	browserNotificationBackgroundSupported: boolean;
	browserNotificationDelivery: BrowserNotificationDelivery;
	browserNotificationPermission: BrowserNotificationPermissionState;
	onBrowserNotificationDeliveryChange: (value: BrowserNotificationDelivery) => void;
	onComposerSendShortcutChange: (value: ComposerSendShortcut) => void;
	onLogout: () => void;
	onMotionPreferenceChange: (value: MotionPreference) => void;
	onOpenChange: (open: boolean) => void;
	onRoomNotificationDefaultsChange: (value: RoomNotificationDefaults) => void;
	onThemePreferenceChange: (value: ThemePreference) => void;
	logoutPending?: boolean;
	motionPreference: MotionPreference;
	open: boolean;
	resolvedTheme: ResolvedTheme;
	roomNotificationDefaults: RoomNotificationDefaults;
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
						<Dialog.Description className={styles.description}>{spaceText('界面与通知偏好')}</Dialog.Description>
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
						<p className={styles.sectionLabel}>{spaceText('浏览器通知')}</p>
						<p className={styles.sectionHint}>
							{spaceText(
								resolveBrowserNotificationHint({
									backgroundSupported: browserNotificationBackgroundSupported,
									delivery: browserNotificationDelivery,
									permission: browserNotificationPermission,
								}),
							)}
						</p>
					</div>

					<div className={styles.optionList} role='radiogroup' aria-label='浏览器通知送达方式'>
						{browserNotificationOptions.map((option) => {
							const disabled = option.value === 'background' && !browserNotificationBackgroundSupported;
							return (
								<button
									key={option.value}
									aria-checked={browserNotificationDelivery === option.value}
									className={styles.optionCard}
									data-active={browserNotificationDelivery === option.value ? 'true' : 'false'}
									data-testid={`settings-browser-notifications-${option.value}`}
									disabled={disabled}
									onClick={() => onBrowserNotificationDeliveryChange(option.value)}
									role='radio'
									type='button'
								>
									<span className={styles.optionCopy}>
										<strong className={styles.optionTitle}>{spaceText(option.label)}</strong>
										<span className={styles.optionDescription}>{spaceText(option.description)}</span>
									</span>
									<span aria-hidden='true' className={styles.optionIndicator} />
								</button>
							);
						})}
					</div>
				</section>

				<section className={styles.section}>
					<div className={styles.sectionHeader}>
						<p className={styles.sectionLabel}>{spaceText('房间通知默认值')}</p>
						<p className={styles.sectionHint}>{spaceText('房间未单独覆盖时，按下面规则决定是否允许打断你')}</p>
					</div>

					<div className={styles.preferenceField}>
						<p className={styles.preferenceLegend}>{spaceText('私信')}</p>
						<div className={styles.segmentedGroup} role='group' aria-label='私信通知默认值'>
							{roomPreferenceOptions.map((option) => (
								<button
									key={`dm-${option.value}`}
									className={styles.segmentedButton}
									data-active={roomNotificationDefaults.dms === option.value ? 'true' : 'false'}
									data-testid={`settings-room-default-dm-${option.value}`}
									onClick={() =>
										onRoomNotificationDefaultsChange({
											...roomNotificationDefaults,
											dms: option.value,
										})
									}
									type='button'
								>
									{spaceText(option.label)}
								</button>
							))}
						</div>
					</div>

					<div className={styles.preferenceField}>
						<p className={styles.preferenceLegend}>{spaceText('频道与群组')}</p>
						<div className={styles.segmentedGroup} role='group' aria-label='频道与群组通知默认值'>
							{roomPreferenceOptions.map((option) => (
								<button
									key={`room-${option.value}`}
									className={styles.segmentedButton}
									data-active={roomNotificationDefaults.rooms === option.value ? 'true' : 'false'}
									data-testid={`settings-room-default-room-${option.value}`}
									onClick={() =>
										onRoomNotificationDefaultsChange({
											...roomNotificationDefaults,
											rooms: option.value,
										})
									}
									type='button'
								>
									{spaceText(option.label)}
								</button>
							))}
						</div>
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
