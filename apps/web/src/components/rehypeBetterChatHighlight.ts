import { toText } from 'hast-util-to-text';
import type { Element, ElementContent, Root } from 'hast';
import type { LanguageFn } from 'highlight.js';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import graphql from 'highlight.js/lib/languages/graphql';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { createLowlight } from 'lowlight';
import { visit } from 'unist-util-visit';

const betterChatHighlightLanguages = {
	bash,
	css,
	diff,
	go,
	graphql,
	javascript,
	json,
	markdown,
	plaintext,
	python,
	rust,
	sql,
	typescript,
	xml,
	yaml,
} satisfies Record<string, LanguageFn>;

const highlightSubset = Object.keys(betterChatHighlightLanguages);
const lowlight = createLowlight(betterChatHighlightLanguages);

const resolveCodeLanguage = (node: Element): false | string | undefined => {
	const classNames = node.properties.className;
	if (!Array.isArray(classNames)) {
		return undefined;
	}

	for (const className of classNames) {
		const normalizedClassName = String(className);
		if (normalizedClassName === 'no-highlight' || normalizedClassName === 'nohighlight') {
			return false;
		}

		if (normalizedClassName.startsWith('lang-')) {
			return normalizedClassName.slice(5);
		}

		if (normalizedClassName.startsWith('language-')) {
			return normalizedClassName.slice(9);
		}
	}

	return undefined;
};

const readCodeClassNames = (node: Element) => {
	const currentClassNames = node.properties.className;
	if (Array.isArray(currentClassNames)) {
		return currentClassNames.map((className) => String(className));
	}

	return [];
};

export const rehypeBetterChatHighlight = () => (tree: Root) => {
	visit(tree, 'element', (node, _index, parent) => {
		if (node.tagName !== 'code' || parent?.type !== 'element' || parent.tagName !== 'pre') {
			return;
		}

		const language = resolveCodeLanguage(node);
		if (language === false) {
			return;
		}

		const classNames = readCodeClassNames(node);
		if (!classNames.includes('hljs')) {
			classNames.unshift('hljs');
		}

		node.properties.className = classNames;

		try {
			const result = language
				? lowlight.highlight(language, toText(node, { whitespace: 'pre' }), { prefix: 'hljs-' })
				: lowlight.highlightAuto(toText(node, { whitespace: 'pre' }), {
					prefix: 'hljs-',
					subset: highlightSubset,
				});

			if (!language && result.data?.language && !classNames.includes(`language-${result.data.language}`)) {
				classNames.push(`language-${result.data.language}`);
			}

			if (result.children.length > 0) {
				node.children = result.children as ElementContent[];
			}
		} catch (error) {
			if (language && error instanceof Error && /Unknown language/u.test(error.message)) {
				return;
			}

			throw error;
		}
	});
};
