import { describe, expect, it } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Focus Indicator CSS Validation Tests
 * Issues #4 & #7: Focus Indicator CSS fixes
 * 
 * These tests verify that focus indicators are visible and meet WCAG 2.1
 * requirements (3:1 contrast ratio minimum).
 */

describe('Focus Indicator CSS', () => {
	const cssFilePath = path.join(__dirname, 'TimelineView.module.css');
	const cssContent = fs.readFileSync(cssFilePath, 'utf-8');

	describe('Issue #4: messageActionButton:focus-visible', () => {
		it('should have visible outline property (not just box-shadow with 10% accent)', () => {
			// Find the .messageActionButton:focus-visible block
			const focusBlockMatch = cssContent.match(
				/\.messageActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			expect(focusBlockMatch).not.toBeNull();

			const focusBlock = focusBlockMatch![1];

			// Should have outline property with visible width
			const hasOutline = /outline:\s*\d+px\s+solid/.test(focusBlock);
			expect(hasOutline).toBe(true);

			// Should use var(--accent) at full strength (not 10%)
			const hasFullAccent = focusBlock.includes('var(--accent)');
			expect(hasFullAccent).toBe(true);

			// Should NOT rely solely on 10% accent box-shadow
			const hasWeakBoxShadow = focusBlock.includes('var(--accent) 10%');
			expect(hasWeakBoxShadow).toBe(false);
		});

		it('should have outline-offset for visibility', () => {
			const focusBlockMatch = cssContent.match(
				/\.messageActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			expect(focusBlockMatch).not.toBeNull();

			const focusBlock = focusBlockMatch![1];
			const hasOutlineOffset = /outline-offset:\s*\d+px/.test(focusBlock);
			expect(hasOutlineOffset).toBe(true);
		});

		it('should maintain existing background and color properties', () => {
			const focusBlockMatch = cssContent.match(
				/\.messageActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			expect(focusBlockMatch).not.toBeNull();

			const focusBlock = focusBlockMatch![1];
			expect(focusBlock).toInclude('background:');
			expect(focusBlock).toInclude('color:');
		});
	});

	describe('Issue #7: deliveryActionButton:focus-visible', () => {
		it('should NOT use outline: none (removes focus indicator)', () => {
			const focusBlockMatch = cssContent.match(
				/\.deliveryActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			expect(focusBlockMatch).not.toBeNull();

			const focusBlock = focusBlockMatch![1];

			// Should NOT have outline: none
			const hasOutlineNone = /outline:\s*none/.test(focusBlock);
			expect(hasOutlineNone).toBe(false);
		});

		it('should have visible outline property', () => {
			const focusBlockMatch = cssContent.match(
				/\.deliveryActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			expect(focusBlockMatch).not.toBeNull();

			const focusBlock = focusBlockMatch![1];

			// Should have outline property with visible width
			const hasOutline = /outline:\s*\d+px\s+solid/.test(focusBlock);
			expect(hasOutline).toBe(true);

			// Should use var(--accent)
			const hasAccent = focusBlock.includes('var(--accent)');
			expect(hasAccent).toBe(true);
		});

		it('should have outline-offset for visibility', () => {
			const focusBlockMatch = cssContent.match(
				/\.deliveryActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			expect(focusBlockMatch).not.toBeNull();

			const focusBlock = focusBlockMatch![1];
			const hasOutlineOffset = /outline-offset:\s*\d+px/.test(focusBlock);
			expect(hasOutlineOffset).toBe(true);
		});

		it('should maintain existing color change as supplementary indicator', () => {
			const focusBlockMatch = cssContent.match(
				/\.deliveryActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			expect(focusBlockMatch).not.toBeNull();

			const focusBlock = focusBlockMatch![1];
			expect(focusBlock).toInclude('color:');
			expect(focusBlock).toInclude('var(--text-strong)');
		});
	});

	describe('WCAG 2.1 Compliance', () => {
		it('focus indicators should use strong accent color for 3:1 contrast', () => {
			// Both focus blocks should use var(--accent) at full strength
			// This is a proxy test for contrast ratio
			const messageActionBlock = cssContent.match(
				/\.messageActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			const deliveryActionBlock = cssContent.match(
				/\.deliveryActionButton:focus-visible\s*\{([^}]+)\}/,
			);

			expect(messageActionBlock).not.toBeNull();
			expect(deliveryActionBlock).not.toBeNull();

			// Both should use solid outline with var(--accent) (not mixed with transparency)
			expect(messageActionBlock![1]).toMatch(/outline:\s*2px\s+solid\s+var\(--accent\)/);
			expect(deliveryActionBlock![1]).toMatch(/outline:\s*2px\s+solid\s+var\(--accent\)/);
		});

		it('focus indicators should have sufficient size (2px)', () => {
			// WCAG recommends at least 2px for focus indicators
			const messageActionBlock = cssContent.match(
				/\.messageActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			const deliveryActionBlock = cssContent.match(
				/\.deliveryActionButton:focus-visible\s*\{([^}]+)\}/,
			);

			expect(messageActionBlock).not.toBeNull();
			expect(deliveryActionBlock).not.toBeNull();

			const messageOutlineMatch = messageActionBlock![1].match(/outline:\s*(\d+)px/);
			const deliveryOutlineMatch = deliveryActionBlock![1].match(/outline:\s*(\d+)px/);

			expect(messageOutlineMatch).not.toBeNull();
			expect(deliveryOutlineMatch).not.toBeNull();

			expect(parseInt(messageOutlineMatch![1])).toBeGreaterThanOrEqual(2);
			expect(parseInt(deliveryOutlineMatch![1])).toBeGreaterThanOrEqual(2);
		});
	});

	describe('Consistency between fixed focus styles', () => {
		it('messageActionButton and deliveryActionButton should use consistent patterns', () => {
			// Both fixed buttons should use the same focus indicator pattern
			const messageActionBlock = cssContent.match(
				/\.messageActionButton:focus-visible\s*\{([^}]+)\}/,
			);
			const deliveryActionBlock = cssContent.match(
				/\.deliveryActionButton:focus-visible\s*\{([^}]+)\}/,
			);

			expect(messageActionBlock).not.toBeNull();
			expect(deliveryActionBlock).not.toBeNull();

			const messageBlock = messageActionBlock![1];
			const deliveryBlock = deliveryActionBlock![1];

			// Both should use 2px solid outline with var(--accent)
			expect(messageBlock).toMatch(/outline:\s*2px\s+solid\s+var\(--accent\)/);
			expect(deliveryBlock).toMatch(/outline:\s*2px\s+solid\s+var\(--accent\)/);

			// Both should have outline-offset: 2px
			expect(messageBlock).toMatch(/outline-offset:\s*2px/);
			expect(deliveryBlock).toMatch(/outline-offset:\s*2px/);

			// Both should maintain color change for supplementary indication
			expect(messageBlock).toInclude('color: var(--text-strong)');
			expect(deliveryBlock).toInclude('color: var(--text-strong)');
		});
	});
});
