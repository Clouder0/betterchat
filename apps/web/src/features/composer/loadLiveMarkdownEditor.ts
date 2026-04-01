let liveMarkdownEditorModulePromise: Promise<{
	default: typeof import('./LiveMarkdownEditor').LiveMarkdownEditor;
}> | null = null;

export const loadLiveMarkdownEditor = () => {
	if (!liveMarkdownEditorModulePromise) {
		liveMarkdownEditorModulePromise = import('./LiveMarkdownEditor').then((module) => ({
			default: module.LiveMarkdownEditor,
		}));
	}

	return liveMarkdownEditorModulePromise;
};

export const preloadLiveMarkdownEditor = () => {
	void loadLiveMarkdownEditor();
};
