export type MotionPreference = 'enabled' | 'disabled';

export const MOTION_STORAGE_KEY = 'betterchat.motion-preference.v1';
export const MOTION_ATTRIBUTE = 'data-motion';

const isMotionPreference = (value: string | null): value is MotionPreference => value === 'enabled' || value === 'disabled';

export const getStoredMotionPreference = (): MotionPreference => {
	if (typeof window === 'undefined') {
		return 'enabled';
	}

	const storedPreference = window.localStorage.getItem(MOTION_STORAGE_KEY);
	return isMotionPreference(storedPreference) ? storedPreference : 'enabled';
};

export const applyDocumentMotionPreference = (preference: MotionPreference) => {
	if (typeof document !== 'undefined') {
		document.documentElement.setAttribute(MOTION_ATTRIBUTE, preference === 'disabled' ? 'off' : 'on');
	}

	if (typeof window !== 'undefined') {
		window.localStorage.setItem(MOTION_STORAGE_KEY, preference);
	}
};

export const initializeDocumentMotionPreference = () => {
	const preference = getStoredMotionPreference();
	applyDocumentMotionPreference(preference);
	return preference;
};

export const isDocumentMotionDisabled = () => {
	if (typeof document !== 'undefined') {
		const motionState = document.documentElement.getAttribute(MOTION_ATTRIBUTE);
		if (motionState === 'off') {
			return true;
		}

		if (motionState === 'on') {
			return false;
		}
	}

	return getStoredMotionPreference() === 'disabled';
};

export const shouldDisableMotion = ({
	motionPreference,
	systemReducedMotion,
}: {
	motionPreference: MotionPreference;
	systemReducedMotion: boolean;
}) => motionPreference === 'disabled' || systemReducedMotion;
