import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { HTMLAttributes, ReactNode } from 'react';

import { installTestDom, type TestDomHarness } from '@/test/domHarness';
import { getByTestId } from '@/test/domQueries';

const loadSettingsPanel = async () => {
	mock.restore();
	mock.module('@radix-ui/react-dialog', () => ({
		Root: ({ children }: { children: ReactNode }) => <>{children}</>,
		Trigger: ({ asChild, children }: { asChild?: boolean; children: ReactNode }) =>
			asChild ? children : <button type='button'>{children}</button>,
		Portal: ({ children }: { children: ReactNode }) => <>{children}</>,
		Overlay: (props: HTMLAttributes<HTMLDivElement>) => <div {...props} />,
		Content: ({
			onCloseAutoFocus: _onCloseAutoFocus,
			onEscapeKeyDown: _onEscapeKeyDown,
			onFocusOutside: _onFocusOutside,
			onInteractOutside: _onInteractOutside,
			onOpenAutoFocus: _onOpenAutoFocus,
			onPointerDownOutside: _onPointerDownOutside,
			...props
		}: HTMLAttributes<HTMLDivElement> & Record<string, unknown>) => <div {...props} />,
		Title: (props: HTMLAttributes<HTMLHeadingElement>) => <h2 {...props} />,
		Description: (props: HTMLAttributes<HTMLParagraphElement>) => <p {...props} />,
		Close: ({ asChild, children }: { asChild?: boolean; children: ReactNode }) =>
			asChild ? children : <button type='button'>{children}</button>,
	}));

	return import('./SettingsPanel').then((module) => module.SettingsPanel);
};

describe('SettingsPanel', () => {
	let dom: TestDomHarness;

	beforeEach(() => {
		dom = installTestDom();
	});

	afterEach(() => {
		cleanup();
		dom.cleanup();
		mock.restore();
	});

	it('renders notification delivery and default room policy controls', async () => {
		const SettingsPanel = await loadSettingsPanel();
		const handleBrowserDeliveryChange = mock(() => {});
		const handleRoomDefaultsChange = mock(() => {});
		render(
			<SettingsPanel
				browserNotificationBackgroundSupported={false}
				browserNotificationDelivery='foreground'
				browserNotificationPermission='granted'
				onBrowserNotificationDeliveryChange={handleBrowserDeliveryChange}
				onComposerSendShortcutChange={() => {}}
				onLogout={() => {}}
				onMotionPreferenceChange={() => {}}
				onOpenChange={() => {}}
				onRoomNotificationDefaultsChange={handleRoomDefaultsChange}
				onThemePreferenceChange={() => {}}
				motionPreference='enabled'
				open
				resolvedTheme='light'
				roomNotificationDefaults={{ dms: 'all', rooms: 'personal' }}
				sendShortcut='enter-send'
				themePreference='light'
			/>,
		);

		fireEvent.click(getByTestId(document.body, 'settings-browser-notifications-off'));
		fireEvent.click(getByTestId(document.body, 'settings-room-default-room-mute'));

		expect(handleBrowserDeliveryChange).toHaveBeenCalledWith('off');
		expect(handleRoomDefaultsChange).toHaveBeenCalledWith({ dms: 'all', rooms: 'mute' });
		expect((getByTestId(document.body, 'settings-browser-notifications-background') as HTMLButtonElement).disabled).toBe(true);
	});
});
