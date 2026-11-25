import { setIcon } from "obsidian";
import type { PdfRenderer } from "./PdfRenderer";
import type { AnnotationStore } from "./AnnotationStore";
import type { TocHeading } from "./types";

interface TocItem extends TocHeading {
	depth: number;
	/** Set for headings the user added (removable) */
	heading?: TocHeading;
}

/**
 * Left sidebar: the PDF's own bookmarks plus headings the user added from a
 * text selection. Clicking one scrolls to it. Hidden, with its header toggle,
 * while there is nothing to list.
 */
export class TocSidebar {
	private el: HTMLDivElement;
	private toggleBtn: HTMLDivElement;
	private outline: TocItem[] = [];
	private open = true;
	private loadToken = 0;

	constructor(
		header: HTMLElement,
		body: HTMLElement,
		private renderer: PdfRenderer,
		private store: AnnotationStore,
		private scrollEl: HTMLElement
	) {
		this.toggleBtn = header.createDiv({ cls: "clickable-icon pdf-annotator-toc-toggle", attr: { "aria-label": "Table of contents" } });
		setIcon(this.toggleBtn, "list");
		this.toggleBtn.addEventListener("click", () => {
			this.open = !this.open;
			this.render();
		});
		this.el = body.createDiv({ cls: "pdf-annotator-toc" });
		this.reset();
	}

	/** Call once the document and its annotation file are loaded. */
	async load(): Promise<void> {
		const token = ++this.loadToken;
		const outline = await this.renderer.getOutline().catch(() => []);
		if (token !== this.loadToken) return; // another file was opened meanwhile
		this.outline = outline;
		this.render();
	}

	/** Forget the document (file unloaded). */
	reset(): void {
		this.loadToken++;
		this.outline = [];
		this.el.empty();
		this.el.hide();
		this.toggleBtn.hide();
	}

	add(heading: TocHeading): void {
		this.store.toc.push(heading);
		void this.store.saveAnnotations();
		this.open = true;
		this.render();
	}

	private remove(heading: TocHeading): void {
		this.store.toc = this.store.toc.filter(h => h !== heading);
		void this.store.saveAnnotations();
		this.render();
	}

	private render(): void {
		// Added headings slot in by position; bookmarks keep their own order
		const items = [...this.outline];
		for (const h of this.store.toc) {
			const i = items.findIndex(e => e.page > h.page || (e.page === h.page && e.top > h.top));
			// Indent by section numbering: "2.1 Method" → depth 1
			const depth = (h.title.match(/^\d+(\.\d+)*/)?.[0].split(".").length ?? 1) - 1;
			items.splice(i === -1 ? items.length : i, 0, { ...h, depth, heading: h });
		}

		this.el.empty();
		this.toggleBtn.toggle(items.length > 0);
		this.toggleBtn.toggleClass("is-active", this.open);
		this.el.toggle(items.length > 0 && this.open);

		for (const item of items) {
			const row = this.el.createDiv({ cls: "pdf-annotator-toc-item" });
			row.style.paddingLeft = `${8 + item.depth * 14}px`;
			row.createSpan({ cls: "pdf-annotator-toc-title", text: item.title });
			row.addEventListener("click", () => this.jump(item));
			if (item.heading) {
				const heading = item.heading;
				const del = row.createDiv({ cls: "clickable-icon pdf-annotator-toc-remove", attr: { "aria-label": "Remove heading" } });
				setIcon(del, "x");
				del.addEventListener("click", (e) => {
					e.stopPropagation();
					this.remove(heading);
				});
			}
		}
	}

	private jump(item: TocItem): void {
		const info = this.renderer.getPageInfo(item.page);
		if (!info) return; // unresolved bookmark
		const view = this.scrollEl.getBoundingClientRect();
		const page = info.container.getBoundingClientRect();
		// Headroom: bookmark anchors sit anywhere from the heading's top to its baseline
		this.scrollEl.scrollTop += page.top + item.top * page.height - view.top - 40;
	}
}
