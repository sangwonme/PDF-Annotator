import { App, Menu, TFile } from "obsidian";
import type { PdfRenderer, RenderedPage } from "./PdfRenderer";
import type { AnnotationStore } from "./AnnotationStore";
import type { AnnotationLayer } from "./AnnotationLayer";
import type { Annotation, NormalizedRect, AnnotationSelector } from "./types";
import { HIGHLIGHT_COLORS } from "./types";
import { ColorPicker } from "./ColorPicker";
import { NoteModal } from "./NoteModal";

function generateId(): string {
	return Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
}

export class HighlightManager {
	private renderer: PdfRenderer;
	private store: AnnotationStore;
	private annotationLayer: AnnotationLayer;
	private app: App;
	private colorPicker: ColorPicker;
	private scrollContainer: HTMLElement | null = null;
	private file: TFile | null = null;
	private abortController: AbortController | null = null;

	constructor(
		renderer: PdfRenderer,
		store: AnnotationStore,
		annotationLayer: AnnotationLayer,
		app: App
	) {
		this.renderer = renderer;
		this.store = store;
		this.annotationLayer = annotationLayer;
		this.app = app;
		this.colorPicker = new ColorPicker();
	}

	setup(scrollContainer: HTMLElement, file: TFile): void {
		this.scrollContainer = scrollContainer;
		this.file = file;
		this.abortController = new AbortController();
		const signal = this.abortController.signal;

		// Inline comment edit callback
		this.annotationLayer.setCommentSaveCallback((annotationId, newComment) => {
			this.store.updateAnnotation(annotationId, { comment: newComment });
			this.store.saveAnnotations();
		});

		// Delete highlight + comment
		this.annotationLayer.setAnnotationDeleteCallback((annotationId) => {
			this.store.removeAnnotation(annotationId);
			this.annotationLayer.removeHighlight(annotationId);
			this.store.saveAnnotations();
		});

		// Clear comment only (keep highlight)
		this.annotationLayer.setCommentClearCallback((annotationId) => {
			this.store.updateAnnotation(annotationId, { comment: "" });
			this.annotationLayer.updateHighlightComment(annotationId, false, "");
			this.store.saveAnnotations();
		});

		// Text selection → color picker
		scrollContainer.addEventListener("mouseup", (e) => {
			setTimeout(() => this.handleTextSelection(e), 10);
		}, { signal });

		// Highlight click → context menu (use elementsFromPoint since highlights are below text layer)
		scrollContainer.addEventListener("click", (e) => {
			const highlightEl = this.findHighlightAt(e.clientX, e.clientY);
			if (highlightEl) {
				const annotationId = highlightEl.dataset.annotationId;
				if (annotationId) {
					this.showAnnotationMenu(e, annotationId);
				}
			}
		}, { signal });
		// Hover tracking for highlights below text layer
		let lastHoveredId: string | null = null;
		scrollContainer.addEventListener("mousemove", (e) => {
			const highlightEl = this.findHighlightAt(e.clientX, e.clientY);
			const id = highlightEl?.dataset.annotationId ?? null;
			if (id !== lastHoveredId) {
				if (lastHoveredId) this.annotationLayer.setActive(lastHoveredId, false);
				if (id) this.annotationLayer.setActive(id, true);
				lastHoveredId = id;
			}
			// Change cursor based on whether hovering a highlight
			scrollContainer.style.cursor = id ? "pointer" : "";
		}, { signal });

		scrollContainer.addEventListener("mouseleave", () => {
			if (lastHoveredId) {
				this.annotationLayer.setActive(lastHoveredId, false);
				lastHoveredId = null;
			}
		}, { signal });
	}

	private findHighlightAt(x: number, y: number): HTMLElement | null {
		const elements = document.elementsFromPoint(x, y);
		for (const el of elements) {
			if (el.classList.contains("pdf-annotator-highlight")) {
				return el as HTMLElement;
			}
		}
		return null;
	}

	private handleTextSelection(e: MouseEvent): void {
		const selection = window.getSelection();
		if (!selection || selection.isCollapsed || !selection.toString().trim()) return;

		// Find which page the selection is in
		const range = selection.getRangeAt(0);
		const pageContainer = (range.startContainer as HTMLElement).closest?.(".pdf-annotator-page")
			?? (range.startContainer.parentElement)?.closest(".pdf-annotator-page");

		if (!pageContainer || !(pageContainer instanceof HTMLElement)) return;

		const pageNumber = parseInt(pageContainer.dataset.pageNumber ?? "0");
		if (!pageNumber) return;

		// Show color picker near the selection
		const rect = range.getBoundingClientRect();
		this.colorPicker.show(
			rect.left + rect.width / 2 - 60,
			rect.bottom + 5,
			(color) => this.createHighlight(selection, pageNumber, color)
		);
	}

	private createHighlight(selection: Selection, pageNumber: number, color: string): void {
		const range = selection.getRangeAt(0);
		const renderedPage = this.renderer.getRenderedPage(pageNumber);
		if (!renderedPage) return;

		const selectors = this.buildSelectors(selection, range, renderedPage);
		const now = new Date().toISOString();

		const annotation: Annotation = {
			id: generateId(),
			type: "highlight",
			color,
			created: now,
			modified: now,
			pageNumber,
			selectors,
			comment: "",
		};

		this.store.addAnnotation(annotation);
		this.annotationLayer.renderHighlight(renderedPage, annotation);
		this.store.saveAnnotations();

		selection.removeAllRanges();
	}

	private buildSelectors(selection: Selection, range: Range, renderedPage: RenderedPage): AnnotationSelector[] {
		const { textLayerDiv, viewport, container } = renderedPage;
		const exact = selection.toString();

		// TextQuoteSelector
		const fullText = textLayerDiv.textContent ?? "";
		const { startOffset, endOffset } = this.calculateTextOffsets(range, textLayerDiv);
		const prefix = fullText.substring(Math.max(0, startOffset - 30), startOffset);
		const suffix = fullText.substring(endOffset, Math.min(fullText.length, endOffset + 30));

		// PageSelector - normalized rects
		const clientRects = range.getClientRects();
		const pageRect = container.getBoundingClientRect();
		const rects: NormalizedRect[] = this.mergeRects(
			Array.from(clientRects).map(r => ({
				x1: (r.left - pageRect.left) / pageRect.width,
				y1: (r.top - pageRect.top) / pageRect.height,
				x2: (r.right - pageRect.left) / pageRect.width,
				y2: (r.bottom - pageRect.top) / pageRect.height,
			}))
		);

		return [
			{ type: "TextQuoteSelector", exact, prefix, suffix },
			{ type: "TextPositionSelector", start: startOffset, end: endOffset },
			{ type: "PageSelector", pageNumber: renderedPage.pageNumber, rects },
		];
	}

	private calculateTextOffsets(range: Range, textLayerDiv: HTMLElement): { startOffset: number; endOffset: number } {
		const walker = document.createTreeWalker(textLayerDiv, NodeFilter.SHOW_TEXT);
		let charCount = 0;
		let startOffset = 0;
		let endOffset = 0;
		let node: Node | null;

		while ((node = walker.nextNode())) {
			const textNode = node as Text;
			if (node === range.startContainer) {
				startOffset = charCount + range.startOffset;
			}
			if (node === range.endContainer) {
				endOffset = charCount + range.endOffset;
				break;
			}
			charCount += textNode.length;
		}

		return { startOffset, endOffset };
	}

	private mergeRects(rects: NormalizedRect[]): NormalizedRect[] {
		if (rects.length === 0) return [];

		// Filter out zero-size rects
		const filtered = rects.filter(r => (r.x2 - r.x1) > 0.001 && (r.y2 - r.y1) > 0.001);
		if (filtered.length === 0) return rects.slice(0, 1);

		// Merge rects on the same line (similar y values)
		const merged: NormalizedRect[] = [];
		let current = { ...filtered[0] };

		for (let i = 1; i < filtered.length; i++) {
			const r = filtered[i];
			// Same line if y overlap is significant
			if (Math.abs(r.y1 - current.y1) < 0.005 && Math.abs(r.y2 - current.y2) < 0.005) {
				current.x1 = Math.min(current.x1, r.x1);
				current.x2 = Math.max(current.x2, r.x2);
				current.y1 = Math.min(current.y1, r.y1);
				current.y2 = Math.max(current.y2, r.y2);
			} else {
				merged.push(current);
				current = { ...r };
			}
		}
		merged.push(current);

		return merged;
	}

	private showAnnotationMenu(e: MouseEvent, annotationId: string): void {
		const annotation = this.store.getAnnotation(annotationId);
		if (!annotation) return;

		const menu = new Menu();

		menu.addItem((item) => {
			item.setTitle("Note")
				.setIcon("edit")
				.onClick(() => this.editNote(annotationId));
		});

		// Color submenu
		for (const [name, hex] of Object.entries(HIGHLIGHT_COLORS)) {
			menu.addItem((item) => {
				item.setTitle(`Color: ${name}`)
					.onClick(() => {
						this.store.updateAnnotation(annotationId, { color: hex });
						this.annotationLayer.updateHighlightColor(annotationId, hex);
						this.store.saveAnnotations();
					});
			});
		}

		menu.addSeparator();

		menu.addItem((item) => {
			item.setTitle("Delete")
				.setIcon("trash")
				.onClick(() => {
					this.store.removeAnnotation(annotationId);
					this.annotationLayer.removeHighlight(annotationId);
					this.store.saveAnnotations();
				});
		});

		menu.showAtMouseEvent(e);
	}

	private editNote(annotationId: string): void {
		const annotation = this.store.getAnnotation(annotationId);
		if (!annotation) return;

		new NoteModal(this.app, annotation.comment, (newComment) => {
			this.store.updateAnnotation(annotationId, { comment: newComment });
			this.annotationLayer.updateHighlightComment(annotationId, !!newComment, newComment);
			this.store.saveAnnotations();
		}).open();
	}

	destroy(): void {
		this.abortController?.abort();
		this.abortController = null;
		this.colorPicker.hide();
		this.scrollContainer = null;
		this.file = null;
	}
}
