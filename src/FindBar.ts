import { debounce, setIcon } from "obsidian";
import type { PdfRenderer } from "./PdfRenderer";

interface PageText {
	/** Text item strings joined, with a space after each line end */
	text: string;
	/** Offset of each text item in `text`; item i is text layer span i */
	starts: number[];
}

interface Match {
	page: number;
	start: number;
	end: number;
	/** Set while the page's text layer exists */
	range?: Range;
}

/** Highlight names are global to the document, so views share one Highlight each and add/remove their own ranges. */
function sharedHighlight(name: string, priority: number): Highlight {
	let highlight = CSS.highlights.get(name);
	if (!highlight) {
		highlight = new Highlight();
		highlight.priority = priority;
		CSS.highlights.set(name, highlight);
	}
	return highlight;
}

/**
 * Ctrl+F search over the whole PDF. Matches are painted with the CSS Custom
 * Highlight API on the text layer, so they follow zoom with no extra work.
 */
export class FindBar {
	private el: HTMLDivElement;
	private input: HTMLInputElement;
	private countEl: HTMLSpanElement;
	private texts: Map<number, PageText> = new Map();
	private matches: Match[] = [];
	private current = -1;
	private query = "";
	private searchToken = 0;
	private pendingScroll = false;
	private currentRange: Range | null = null;
	private allHighlight = sharedHighlight("pdf-annotator-find", 0);
	private currentHighlight = sharedHighlight("pdf-annotator-find-current", 1);

	constructor(
		parent: HTMLElement,
		private renderer: PdfRenderer,
		private scrollEl: HTMLElement,
		private getCurrentPage: () => number
	) {
		this.el = parent.createDiv({ cls: "pdf-annotator-find-bar" });
		this.el.hide();
		this.input = this.el.createEl("input", { type: "text", placeholder: "Find in PDF" });
		this.countEl = this.el.createSpan({ cls: "pdf-annotator-find-count" });
		this.addButton("chevron-up", "Previous (Shift+Enter)", () => this.step(-1));
		this.addButton("chevron-down", "Next (Enter)", () => this.step(1));
		this.addButton("x", "Close (Esc)", () => this.close());

		const searchSoon = debounce(() => void this.search(this.input.value), 200, true);
		this.input.addEventListener("input", () => searchSoon());
		this.input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				if (this.input.value !== this.query) {
					// Typed and hit Enter before the debounce fired
					searchSoon.cancel();
					void this.search(this.input.value);
				} else {
					this.step(e.shiftKey ? -1 : 1);
				}
			} else if (e.key === "Escape") {
				e.preventDefault();
				this.close();
			}
		});
	}

	private addButton(icon: string, label: string, onClick: () => void): void {
		const btn = this.el.createDiv({ cls: "clickable-icon", attr: { "aria-label": label } });
		setIcon(btn, icon);
		btn.addEventListener("click", onClick);
	}

	open(): void {
		const wasHidden = !this.el.isShown();
		this.el.show();
		this.input.focus();
		this.input.select();
		if (wasHidden && this.input.value) void this.search(this.input.value);
	}

	close(): void {
		this.el.hide();
		this.searchToken++; // abandon a search still in progress
		this.clearPaint();
		this.matches = [];
		this.current = -1;
		this.query = "";
		this.countEl.setText("");
	}

	/** Forget the document (file unloaded). */
	reset(): void {
		this.close();
		this.texts.clear();
	}

	private async pageText(pageNumber: number): Promise<PageText> {
		const cached = this.texts.get(pageNumber);
		if (cached) return cached;

		const { items } = await this.renderer.getPageInfo(pageNumber)!.pdfPage.getTextContent();
		let text = "";
		const starts: number[] = [];
		for (const item of items) {
			if (!("str" in item)) continue; // marked content: no text layer span
			starts.push(text.length);
			text += item.str + (item.hasEOL ? " " : "");
		}
		const pageText = { text, starts };
		this.texts.set(pageNumber, pageText);
		return pageText;
	}

	private async search(query: string): Promise<void> {
		const token = ++this.searchToken;
		this.clearPaint();
		this.query = query;
		this.matches = [];
		this.current = -1;

		const trimmed = query.trim();
		if (trimmed) {
			// Literal and case-insensitive; whitespace matches any whitespace run, including line ends
			const pattern = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
			const re = new RegExp(pattern, "gi");
			const found: Match[] = [];
			for (const info of this.renderer.getAllPageInfos()) {
				const { text } = await this.pageText(info.pageNumber);
				if (token !== this.searchToken) return; // superseded by a newer search
				for (const m of text.matchAll(re)) {
					found.push({ page: info.pageNumber, start: m.index, end: m.index + m[0].length });
				}
			}
			this.matches = found;
		}

		for (const page of new Set(this.matches.map(m => m.page))) this.paintPage(page);

		if (this.matches.length) {
			// Start from the page being read
			const next = this.matches.findIndex(m => m.page >= this.getCurrentPage());
			this.goTo(next === -1 ? 0 : next);
		} else {
			this.updateCount();
		}
	}

	private step(direction: 1 | -1): void {
		if (!this.matches.length) return;
		this.goTo((this.current + direction + this.matches.length) % this.matches.length);
	}

	private goTo(index: number): void {
		this.current = index;
		this.pendingScroll = true;
		this.updateCount();
		this.markCurrent();
	}

	private updateCount(): void {
		this.countEl.setText(
			!this.query.trim() ? ""
				: this.matches.length ? `${this.current + 1}/${this.matches.length}`
				: "No results"
		);
	}

	/**
	 * (Re)build the match ranges of a page. Called after search and whenever
	 * the page's text layer is (re)created by lazy rendering.
	 */
	paintPage(pageNumber: number): void {
		const rendered = this.renderer.getRenderedPage(pageNumber);
		const pageText = this.texts.get(pageNumber);

		for (const m of this.matches) {
			if (m.page !== pageNumber) continue;
			if (m.range) this.allHighlight.delete(m.range);
			m.range = rendered && pageText
				? this.rangeFor(m, rendered.textLayer.textDivs, pageText.starts)
				: undefined;
			if (m.range) this.allHighlight.add(m.range);
		}

		if (this.matches[this.current]?.page === pageNumber) this.markCurrent();
	}

	private rangeFor(match: Match, textDivs: HTMLElement[], starts: number[]): Range {
		const range = new Range();
		range.setStart(...this.domPoint(match.start, textDivs, starts));
		range.setEnd(...this.domPoint(match.end, textDivs, starts));
		return range;
	}

	/** Text offset → (text node, offset) in the text layer. */
	private domPoint(offset: number, textDivs: HTMLElement[], starts: number[]): [Node, number] {
		// Last item starting at or before offset; skip empty items, which pdf.js never attaches to the DOM
		let i = starts.length - 1;
		while (i > 0 && (starts[i] > offset || !textDivs[i].firstChild)) i--;
		const node = textDivs[i].firstChild ?? textDivs[i];
		// Clamp: an offset on the virtual line-end space maps to the end of the item
		return [node, Math.min(offset - starts[i], node.textContent?.length ?? 0)];
	}

	/** Emphasize the current match; on a pending jump, scroll to it (or to its page, to get it rendered). */
	private markCurrent(): void {
		if (this.currentRange) this.currentHighlight.delete(this.currentRange);
		this.currentRange = null;

		const match = this.matches[this.current];
		if (!match) return;
		if (match.range) {
			this.currentRange = match.range;
			this.currentHighlight.add(match.range);
		}
		if (!this.pendingScroll) return;

		const view = this.scrollEl.getBoundingClientRect();
		if (match.range) {
			const r = match.range.getBoundingClientRect();
			this.scrollEl.scrollTop += r.top - view.top - view.height / 3;
			if (r.left < view.left || r.right > view.right) {
				this.scrollEl.scrollLeft += r.left - view.left - view.width / 2;
			}
			this.pendingScroll = false;
		} else {
			// Not rendered yet: scroll its page in; paintPage() comes back here once it renders
			const wrapper = this.renderer.getPageInfo(match.page)!.wrapper;
			this.scrollEl.scrollTop += wrapper.getBoundingClientRect().top - view.top;
		}
	}

	private clearPaint(): void {
		for (const m of this.matches) {
			if (m.range) this.allHighlight.delete(m.range);
			m.range = undefined;
		}
		if (this.currentRange) this.currentHighlight.delete(this.currentRange);
		this.currentRange = null;
	}
}
