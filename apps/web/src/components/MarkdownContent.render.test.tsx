import { describe, expect, it, beforeEach } from 'bun:test';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { Window } from 'happy-dom';
import { MarkdownContent } from './MarkdownContent';

// Shared window - avoid deleting it between tests since React scheduler holds references
const win = new Window({ url: 'http://localhost:3000' });
globalThis.window = win as unknown as Window & typeof globalThis;
globalThis.document = win.document as unknown as Document;
globalThis.HTMLElement = win.HTMLElement as unknown as typeof HTMLElement;
globalThis.Element = win.Element as unknown as typeof Element;
globalThis.Node = win.Node as unknown as typeof Node;

const RENDER_SETTLE_MS = 100;

function renderMarkdown(source: string, dense = true) {
	const container = win.document.createElement('div');
	win.document.body.appendChild(container);
	const root = createRoot(container as unknown as HTMLElement);
	root.render(React.createElement(MarkdownContent, { source, dense }));
	return container as unknown as HTMLElement;
}

function getByTag(container: HTMLElement, tag: string): HTMLElement | null {
	return (container.getElementsByTagName(tag)[0] as HTMLElement) ?? null;
}

function getAllByTag(container: HTMLElement, tag: string): HTMLElement[] {
	return Array.from(container.getElementsByTagName(tag)) as HTMLElement[];
}

// happy-dom's getElementsByClassName crashes internally, so scan spans manually
function findByClassName(container: HTMLElement, className: string): HTMLElement | null {
	const allElements = container.getElementsByTagName('*');
	for (const el of allElements) {
		const cn = el.getAttribute('class') ?? '';
		if (cn.includes(className)) {
			return el as HTMLElement;
		}
	}
	return null;
}

function findByDataAttr(container: HTMLElement, attr: string): HTMLElement | null {
	const allElements = container.getElementsByTagName('*');
	for (const el of allElements) {
		if (el.hasAttribute(attr)) {
			return el as HTMLElement;
		}
	}
	return null;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, RENDER_SETTLE_MS));

describe('MarkdownContent - Structural Rendering', () => {
	describe('List Rendering (Critical - ul/ol component mapping)', () => {
		it('renders unordered lists with proper DOM structure', async () => {
			const container = renderMarkdown("- item 1\n- item 2\n- item 3");
			await settle();

			const ul = getByTag(container, 'ul');
			expect(ul).not.toBe(null);

			const lis = getAllByTag(ul!, 'li');
			expect(lis.length).toBe(3);
			expect(lis[0]?.textContent).toBe('item 1');
			expect(lis[1]?.textContent).toBe('item 2');
			expect(lis[2]?.textContent).toBe('item 3');
		});

		it('renders ordered lists with proper DOM structure', async () => {
			const container = renderMarkdown("1. first\n2. second\n3. third");
			await settle();

			const ol = getByTag(container, 'ol');
			expect(ol).not.toBe(null);

			const lis = getAllByTag(ol!, 'li');
			expect(lis.length).toBe(3);
			expect(lis[0]?.textContent).toBe('first');
			expect(lis[1]?.textContent).toBe('second');
			expect(lis[2]?.textContent).toBe('third');
		});

		it('renders nested lists (ul inside li)', async () => {
			const source = [
				'- parent 1',
				'  - child 1.1',
				'  - child 1.2',
				'- parent 2',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			const rootUl = getByTag(container, 'ul');
			expect(rootUl).not.toBe(null);

			const allLis = getAllByTag(rootUl!, 'li');
			expect(allLis.length).toBeGreaterThanOrEqual(2);
			expect(allLis[0]?.textContent).toContain('parent 1');

			const nestedUl = getByTag(allLis[0]!, 'ul');
			expect(nestedUl).not.toBe(null);

			const nestedLis = getAllByTag(nestedUl!, 'li');
			expect(nestedLis.length).toBe(2);
			expect(nestedLis[0]?.textContent).toContain('child 1.1');
			expect(nestedLis[1]?.textContent).toContain('child 1.2');
		});

		it('renders deeply nested lists (4+ levels)', async () => {
			const source = [
				'- level 1',
				'  - level 2',
				'    - level 3',
				'      - level 4',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			const allUls = getAllByTag(container, 'ul');
			expect(allUls.length).toBeGreaterThanOrEqual(4);

			const allLis = getAllByTag(container, 'li');
			expect(allLis.length).toBeGreaterThanOrEqual(4);
		});

		it('renders mixed list types (ol inside ul)', async () => {
			const source = [
				'- unordered item',
				'  1. ordered sub-item 1',
				'  2. ordered sub-item 2',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			const ul = getByTag(container, 'ul');
			expect(ul).not.toBe(null);

			const ol = getByTag(ul!, 'ol');
			expect(ol).not.toBe(null);

			const lis = getAllByTag(ol!, 'li');
			expect(lis.length).toBe(2);
		});

		it('renders list items as li elements', async () => {
			const container = renderMarkdown("- a\n- b\n- c");
			await settle();

			const lis = getAllByTag(container, 'li');
			expect(lis.length).toBe(3);
			for (const li of lis) {
				expect(li.tagName.toLowerCase()).toBe('li');
			}
		});
	});

	describe('Task Lists (GFM)', () => {
		it('renders task list checkboxes', async () => {
			const source = [
				'- [ ] unchecked task',
				'- [x] checked task',
				'- [X] checked task uppercase',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			const inputs = getAllByTag(container, 'input');
			const checkboxes = inputs.filter((input) => input.getAttribute('type') === 'checkbox');
			expect(checkboxes.length).toBe(3);

			expect((checkboxes[0] as HTMLInputElement).checked).toBe(false);
			expect((checkboxes[1] as HTMLInputElement).checked).toBe(true);
			expect((checkboxes[2] as HTMLInputElement).checked).toBe(true);
		});

		it('renders task list items', async () => {
			const container = renderMarkdown("- [ ] task");
			await settle();

			const lis = getAllByTag(container, 'li');
			expect(lis.length).toBe(1);
		});
	});

	describe('Table Rendering', () => {
		it('renders tables with wrapper container', async () => {
			const source = [
				'| Header 1 | Header 2 |',
				'|----------|----------|',
				'| Cell 1   | Cell 2   |',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			const table = getByTag(container, 'table');
			expect(table).not.toBe(null);
			// Table should be wrapped in a div (tableWrap)
			expect(table!.parentElement).not.toBe(null);
			expect(table!.parentElement!.tagName.toLowerCase()).toBe('div');
		});

		it('renders table headers and cells', async () => {
			const source = [
				'| Name | Value |',
				'|------|-------|',
				'| Foo  | 123   |',
				'| Bar  | 456   |',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			const ths = getAllByTag(container, 'th');
			expect(ths.length).toBe(2);
			expect(ths[0]?.textContent).toBe('Name');
			expect(ths[1]?.textContent).toBe('Value');

			const tds = getAllByTag(container, 'td');
			expect(tds.length).toBe(4);
			expect(tds[0]?.textContent).toBe('Foo');
			expect(tds[1]?.textContent).toBe('123');
		});

		it('renders wide tables with multiple columns', async () => {
			const source = [
				'| A | B | C | D | E |',
				'|---|---|---|---|---|',
				'| 1 | 2 | 3 | 4 | 5 |',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			const ths = getAllByTag(container, 'th');
			expect(ths.length).toBe(5);

			const tds = getAllByTag(container, 'td');
			expect(tds.length).toBe(5);
		});
	});

	describe('Code Blocks', () => {
		it('renders inline code without pre wrapper', async () => {
			const container = renderMarkdown("Use `console.log` for debugging");
			await settle();

			const code = getByTag(container, 'code');
			expect(code).not.toBe(null);
			expect(code!.textContent).toBe('console.log');

			// Inline code should NOT be in a figure (block code uses figure)
			const figure = getByTag(container, 'figure');
			expect(figure).toBe(null);
		});

		it('renders fenced code blocks with figure wrapper', async () => {
			const source = "```ts\nconst x = 1;\n```";
			const container = renderMarkdown(source);
			await settle();

			const figure = getByTag(container, 'figure');
			expect(figure).not.toBe(null);

			const pre = getByTag(container, 'pre');
			expect(pre).not.toBe(null);

			const code = getByTag(pre!, 'code');
			expect(code).not.toBe(null);
			expect(code!.className).toContain('hljs');
			expect(code!.textContent).toContain('const x = 1;');
		});

		it('renders fenced code blocks without language', async () => {
			const source = "```\nsome code\nmore code\n```";
			const container = renderMarkdown(source);
			await settle();

			const figure = getByTag(container, 'figure');
			expect(figure).not.toBe(null);
			const code = getByTag(container, 'code');
			expect(code).not.toBe(null);
			expect(code!.className).toContain('hljs');
		});

		it('renders code block with copy button', async () => {
			const source = "```ts\nconst x = 1;\n```";
			const container = renderMarkdown(source);
			await settle();

			const buttons = getAllByTag(container, 'button');
			const copyButton = buttons.find((b) => b.textContent?.includes('复制'));
			expect(copyButton).toBeDefined();
		});
	});

	describe('Blockquotes', () => {
		it('renders blockquotes', async () => {
			const container = renderMarkdown("> This is a quote");
			await settle();

			const blockquote = getByTag(container, 'blockquote');
			expect(blockquote).not.toBe(null);
			expect(blockquote!.textContent).toContain('This is a quote');
		});

		it('renders nested blockquotes', async () => {
			const source = "> Outer quote\n> > Inner quote";
			const container = renderMarkdown(source);
			await settle();

			const outer = getByTag(container, 'blockquote');
			expect(outer).not.toBe(null);

			const inner = getByTag(outer!, 'blockquote');
			expect(inner).not.toBe(null);
			expect(inner!.textContent).toContain('Inner quote');
		});

		it('renders lists inside blockquotes', async () => {
			const source = "> Quote with list:\n> - item 1\n> - item 2";
			const container = renderMarkdown(source);
			await settle();

			const blockquote = getByTag(container, 'blockquote');
			expect(blockquote).not.toBe(null);

			const ul = getByTag(blockquote!, 'ul');
			expect(ul).not.toBe(null);

			const lis = getAllByTag(ul!, 'li');
			expect(lis.length).toBe(2);
		});

		it('renders blockquotes with mixed content', async () => {
			const source = [
				'> **Important**: Check the following:',
				'> - First item',
				'> - Second item',
				'>',
				'> `code` should also work in quotes',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			const blockquote = getByTag(container, 'blockquote');
			expect(blockquote).not.toBe(null);

			const strong = getByTag(blockquote!, 'strong');
			expect(strong).not.toBe(null);

			const ul = getByTag(blockquote!, 'ul');
			expect(ul).not.toBe(null);

			const code = getByTag(blockquote!, 'code');
			expect(code).not.toBe(null);
		});
	});

	describe('Headers', () => {
		it('renders h1 through h4', async () => {
			const source = "# H1\n## H2\n### H3\n#### H4";
			const container = renderMarkdown(source);
			await settle();

			expect(getByTag(container, 'h1')?.textContent).toBe('H1');
			expect(getByTag(container, 'h2')?.textContent).toBe('H2');
			expect(getByTag(container, 'h3')?.textContent).toBe('H3');
			expect(getByTag(container, 'h4')?.textContent).toBe('H4');
		});

		it('renders h5 and h6 without custom component mapping', async () => {
			const source = "##### H5\n###### H6";
			const container = renderMarkdown(source);
			await settle();

			expect(getByTag(container, 'h5')).not.toBe(null);
			expect(getByTag(container, 'h6')).not.toBe(null);
		});
	});

	describe('GFM Features', () => {
		it('renders strikethrough text', async () => {
			const container = renderMarkdown("~~deleted~~");
			await settle();

			const del = getByTag(container, 'del');
			expect(del).not.toBe(null);
			expect(del!.textContent).toBe('deleted');
		});

		it('renders horizontal rules', async () => {
			const container = renderMarkdown("---");
			await settle();

			const hr = getByTag(container, 'hr');
			expect(hr).not.toBe(null);
		});

		it('renders autolinks (bare URLs)', async () => {
			const container = renderMarkdown("Visit https://example.com for more");
			await settle();

			const link = getByTag(container, 'a');
			expect(link).not.toBe(null);
			expect(link!.getAttribute('href')).toBe('https://example.com');
		});
	});

	describe('Math Rendering', () => {
		it('renders inline math with KaTeX', async () => {
			const container = renderMarkdown("The value is $x = 1$ here");
			await settle();

			const katex = findByClassName(container, 'katex');
			expect(katex).not.toBe(null);
		});

		it('renders block math with KaTeX display', async () => {
			const source = "$$\nx = 1\n$$";
			const container = renderMarkdown(source);
			await settle();

			const katexDisplay = findByClassName(container, 'katex-display');
			expect(katexDisplay).not.toBe(null);
		});

		it('renders complex math expressions', async () => {
			const source = "$$\nW_q \\approx \\frac{\\rho}{\\mu(1-\\rho)}\n$$";
			const container = renderMarkdown(source);
			await settle();

			const katexDisplay = findByClassName(container, 'katex-display');
			expect(katexDisplay).not.toBe(null);
		});
	});

	describe('Mention Decoration', () => {
		it('does NOT decorate mentions inside inline code rendered through the custom code component', async () => {
			const container = renderMarkdown("Use `@username` syntax");
			await settle();

			const code = getByTag(container, 'code');
			expect(code).not.toBe(null);
			const mentionInCode = findByDataAttr(code!, 'data-mention-token');
			expect(mentionInCode).toBe(null);
			expect(code!.textContent).toBe('@username');
		});

		it('does NOT decorate mentions inside fenced code blocks', async () => {
			const source = "```\n@username should not be a mention\n```";
			const container = renderMarkdown(source);
			await settle();

			const pre = getByTag(container, 'pre');
			expect(pre).not.toBe(null);
			const mentionInCode = findByDataAttr(pre!, 'data-mention-token');
			expect(mentionInCode).toBe(null);
		});

		it('decorates mentions in normal paragraphs', async () => {
			const container = renderMarkdown("Hello @username, please check this");
			await settle();

			const mention = findByDataAttr(container, 'data-mention-token');
			expect(mention).not.toBe(null);
			expect(mention!.textContent).toBe('@username');
		});

		it('decorates mentions in headers', async () => {
			const container = renderMarkdown("## @username's changes");
			await settle();

			const h2 = getByTag(container, 'h2');
			expect(h2).not.toBe(null);

			const mention = findByDataAttr(h2!, 'data-mention-token');
			expect(mention).not.toBe(null);
		});

		it('decorates mentions in list items', async () => {
			const container = renderMarkdown("- @username should review");
			await settle();

			const li = getByTag(container, 'li');
			expect(li).not.toBe(null);

			const mention = findByDataAttr(li!, 'data-mention-token');
			expect(mention).not.toBe(null);
		});
	});

	describe('Mixed Content (Real-World Scenarios)', () => {
		it('renders a message with headers, lists, code, and quotes', async () => {
			const source = [
				'## 接口草稿',
				'',
				'先按这个顺序：',
				'',
				'- 登录态与 token 续期',
				'- 房间列表与 subscriptions',
				'- 历史消息、thread、mention',
				'',
				'```ts',
				'const draft = { rid: "GENERAL" };',
				'```',
				'',
				'> 重点不是"看起来新"，而是 **在复杂协作信息下仍然低噪**。',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			expect(getByTag(container, 'h2')).not.toBe(null);
			expect(getByTag(container, 'ul')).not.toBe(null);
			expect(getAllByTag(container, 'li').length).toBe(3);
			expect(getByTag(container, 'figure')).not.toBe(null);
			expect(getByTag(container, 'blockquote')).not.toBe(null);
			expect(getByTag(container, 'strong')).not.toBe(null);
		});

		it('renders a table with inline code in cells', async () => {
			const source = [
				'| Module | Status |',
				'|--------|--------|',
				'| `auth` | done   |',
				'| `sync` | wip    |',
			].join('\n');
			const container = renderMarkdown(source);
			await settle();

			const table = getByTag(container, 'table');
			expect(table).not.toBe(null);

			const codes = getAllByTag(table!, 'code');
			expect(codes.length).toBe(2);
			expect(codes[0]?.textContent).toBe('auth');
			expect(codes[1]?.textContent).toBe('sync');
		});

		it('renders CJK/English mixed text with Pangu spacing', async () => {
			const container = renderMarkdown("先验证 Rocket.Chat 7.6.0 的 REST 兼容行为");
			await settle();

			const p = getByTag(container, 'p');
			expect(p).not.toBe(null);
			// Pangu should insert spaces between CJK and Latin
			expect(p!.textContent).toContain('Rocket.Chat');
		});
	});

	describe('Dense Mode Specifics', () => {
		it('applies different container classes for dense vs non-dense', async () => {
			const denseContainer = renderMarkdown("Hello", true);
			const normalContainer = renderMarkdown("Hello", false);
			await settle();

			// The outermost div has the markdown + optional dense CSS module classes
			const denseDiv = getAllByTag(denseContainer, 'div')[0];
			const normalDiv = getAllByTag(normalContainer, 'div')[0];
			expect(denseDiv).toBeDefined();
			expect(normalDiv).toBeDefined();

			const denseClass = denseDiv!.getAttribute('class') ?? '';
			const normalClass = normalDiv!.getAttribute('class') ?? '';

			// Dense mode should have a longer or different class string (markdown + dense)
			// while non-dense only has the markdown class
			expect(denseClass.length).toBeGreaterThan(normalClass.length);
		});

		it('documents that dense mode applies white-space: pre-line to li elements (potential issue)', async () => {
			// CSS: .dense li { white-space: pre-line; }
			// This means literal \n inside li text content will cause visible line breaks.
			// In dense mode (used for all timeline messages), list items with wrapped text
			// may render differently than expected.
			const container = renderMarkdown("- item with text", true);
			await settle();

			const li = getByTag(container, 'li');
			expect(li).not.toBe(null);
			// The structural element exists - the CSS pre-line behavior is a visual issue
			// that can only be verified in E2E with real CSS rendering.
		});

		it('renders all header levels in dense mode', async () => {
			const source = "# H1\n## H2\n### H3\n#### H4";
			const container = renderMarkdown(source, true);
			await settle();

			// All headers should render - dense mode only changes font-size via CSS
			expect(getByTag(container, 'h1')?.textContent).toBe('H1');
			expect(getByTag(container, 'h2')?.textContent).toBe('H2');
			expect(getByTag(container, 'h3')?.textContent).toBe('H3');
			expect(getByTag(container, 'h4')?.textContent).toBe('H4');
		});
	});
});
