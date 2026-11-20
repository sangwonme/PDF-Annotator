import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
// @ts-ignore - esbuild text loader
import pdfjsWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs";

const workerBlob = new Blob([pdfjsWorkerSrc], { type: "application/javascript" });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

export interface PageInfo {
	pageNumber: number;
	pdfPage: PDFPageProxy;
	wrapper: HTMLDivElement;
	container: HTMLDivElement;
	annotationLayerDiv: HTMLDivElement;
	leftCommentMargin: HTMLDivElement;
	rightCommentMargin: HTMLDivElement;
}

export interface RenderedPage extends PageInfo {
	canvas: HTMLCanvasElement;
	textLayerDiv: HTMLDivElement;
	textLayer: TextLayer;
}

export class PdfRenderer {
	private pdfDoc: PDFDocumentProxy | null = null;
	private pages: Map<number, PageInfo> = new Map();
	private renderedPages: Map<number, RenderedPage> = new Map();
	private scale = 1.5;
	private readonly MIN_SCALE = 0.5;
	private readonly MAX_SCALE = 5.0;
	private readonly SCALE_STEP = 0.25;

	async loadDocument(data: ArrayBuffer): Promise<number> {
		const loadingTask = pdfjsLib.getDocument({ data });
		this.pdfDoc = await loadingTask.promise;
		return this.pdfDoc.numPages;
	}

	/**
	 * Create a correctly-sized placeholder (wrapper + container + comment margins)
	 * without rendering any canvas or text layer. This is cheap and establishes
	 * the full scroll height for all pages.
	 */
	async createPlaceholder(pageNumber: number): Promise<PageInfo> {
		if (!this.pdfDoc) throw new Error("No document loaded");

		const pdfPage: PDFPageProxy = await this.pdfDoc.getPage(pageNumber);

		// Wrapper (left margin + page + right margin)
		const wrapper = document.createElement("div");
		wrapper.className = "pdf-annotator-page-wrapper";
		wrapper.dataset.pageNumber = String(pageNumber);

		// Left comment margin
		const leftCommentMargin = document.createElement("div");
		leftCommentMargin.className = "pdf-annotator-comment-margin pdf-annotator-comment-margin-left";
		wrapper.appendChild(leftCommentMargin);

		// Page container
		const container = document.createElement("div");
		container.className = "pdf-annotator-page";
		container.dataset.pageNumber = String(pageNumber);
		container.style.position = "relative";
		wrapper.appendChild(container);

		// Right comment margin
		const rightCommentMargin = document.createElement("div");
		rightCommentMargin.className = "pdf-annotator-comment-margin pdf-annotator-comment-margin-right";
		wrapper.appendChild(rightCommentMargin);

		// Annotation layer (will sit between canvas and text layer once rendered)
		const annotationLayerDiv = document.createElement("div");
		annotationLayerDiv.className = "pdf-annotator-annotation-layer";
		container.appendChild(annotationLayerDiv);

		const info: PageInfo = {
			pageNumber, pdfPage, wrapper, container, annotationLayerDiv, leftCommentMargin, rightCommentMargin,
		};
		this.applySize(info);
		this.pages.set(pageNumber, info);
		return info;
	}

	/** Size a page box and its comment margins for the current scale. */
	private applySize(info: PageInfo): void {
		const { width, height } = info.pdfPage.getViewport({ scale: this.scale });
		info.container.style.width = `${width}px`;
		info.container.style.height = `${height}px`;
		info.leftCommentMargin.style.minHeight = `${height}px`;
		info.rightCommentMargin.style.minHeight = `${height}px`;
	}

	/** Draw a page into a new canvas backed by devicePixelRatio pixels; CSS sizes it to the page box. */
	private async drawCanvas(pdfPage: PDFPageProxy, viewport: pdfjsLib.PageViewport): Promise<HTMLCanvasElement> {
		const canvas = document.createElement("canvas");
		const dpr = window.devicePixelRatio || 1;
		canvas.width = viewport.width * dpr;
		canvas.height = viewport.height * dpr;
		const ctx = canvas.getContext("2d")!;
		ctx.scale(dpr, dpr);
		await pdfPage.render({ canvasContext: ctx, viewport }).promise;
		return canvas;
	}

	/**
	 * Render the actual canvas + text layer for a page that already has a
	 * placeholder. No-op if the page is already rendered.
	 */
	async renderPageContent(pageNumber: number): Promise<RenderedPage> {
		const existing = this.renderedPages.get(pageNumber);
		if (existing) return existing;

		const info = this.pages.get(pageNumber);
		if (!info) throw new Error(`No placeholder for page ${pageNumber}`);

		const viewport = info.pdfPage.getViewport({ scale: this.scale });

		// Canvas layer — insert before annotation layer
		const canvas = await this.drawCanvas(info.pdfPage, viewport);
		info.container.insertBefore(canvas, info.annotationLayerDiv);

		// Text layer — append after annotation layer (topmost for selection)
		const textLayerDiv = document.createElement("div");
		textLayerDiv.className = "textLayer";
		textLayerDiv.style.setProperty("--scale-factor", String(viewport.scale));
		info.container.appendChild(textLayerDiv);

		const textLayer = new TextLayer({
			textContentSource: await info.pdfPage.getTextContent(),
			container: textLayerDiv,
			viewport,
		});
		await textLayer.render();

		const rendered: RenderedPage = { ...info, canvas, textLayerDiv, textLayer };
		this.renderedPages.set(pageNumber, rendered);

		// Zoomed while this page was rendering: bring it up to the new scale
		if (viewport.scale !== this.scale) void this.reRenderPage(rendered);
		return rendered;
	}

	/**
	 * Free the canvas and text layer for a page, keeping the placeholder
	 * structure intact so scroll position is preserved.
	 */
	unrenderPageContent(pageNumber: number): void {
		const rendered = this.renderedPages.get(pageNumber);
		if (!rendered) return;

		// Free canvas backing-store memory
		rendered.canvas.width = 0;
		rendered.canvas.height = 0;
		rendered.canvas.remove();

		// Remove text layer
		rendered.textLayerDiv.remove();

		this.renderedPages.delete(pageNumber);
	}

	isPageRendered(pageNumber: number): boolean {
		return this.renderedPages.has(pageNumber);
	}

	/**
	 * Resize every page to the current scale. Synchronous and cheap: rendered
	 * canvases are CSS-stretched, and text layers are hidden, since restyling
	 * their ~2000 spans costs ~10ms per page on every zoom step. Follow with
	 * reRenderAllPages(), which redraws the canvases and reveals the text layers.
	 */
	resizePages(): void {
		for (const info of this.pages.values()) this.applySize(info);
		for (const rendered of this.renderedPages.values()) {
			rendered.textLayerDiv.style.display = "none";
		}
	}

	/**
	 * Redraw a rendered page sharply at the current scale. The new canvas is
	 * drawn off-screen and swapped in, so the stretched one stays visible meanwhile.
	 */
	async reRenderPage(rendered: RenderedPage): Promise<void> {
		const viewport = rendered.pdfPage.getViewport({ scale: this.scale });
		rendered.textLayerDiv.style.setProperty("--scale-factor", String(viewport.scale));
		rendered.textLayer.update({ viewport });
		rendered.textLayerDiv.style.display = "";

		const canvas = await this.drawCanvas(rendered.pdfPage, viewport);

		// Stale: zoomed again, or the page was unrendered while drawing
		if (viewport.scale !== this.scale || this.renderedPages.get(rendered.pageNumber) !== rendered) {
			canvas.width = 0;
			canvas.height = 0;
			return;
		}

		rendered.canvas.replaceWith(canvas);
		rendered.canvas.width = 0;
		rendered.canvas.height = 0;
		rendered.canvas = canvas;
	}

	/** Re-render only currently-rendered (visible) pages at the current scale. */
	async reRenderAllPages(): Promise<void> {
		for (const rendered of this.renderedPages.values()) {
			await this.reRenderPage(rendered);
		}
	}

	zoomIn(): number {
		this.scale = Math.min(this.MAX_SCALE, this.scale + this.SCALE_STEP);
		return this.scale;
	}

	zoomOut(): number {
		this.scale = Math.max(this.MIN_SCALE, this.scale - this.SCALE_STEP);
		return this.scale;
	}

	setScale(scale: number): number {
		this.scale = Math.max(this.MIN_SCALE, Math.min(this.MAX_SCALE, scale));
		return this.scale;
	}

	getRenderedPage(pageNumber: number): RenderedPage | undefined {
		return this.renderedPages.get(pageNumber);
	}

	getPageInfo(pageNumber: number): PageInfo | undefined {
		return this.pages.get(pageNumber);
	}

	getAllPageInfos(): PageInfo[] {
		return Array.from(this.pages.values());
	}

	getScale(): number {
		return this.scale;
	}

	destroy(): void {
		this.pdfDoc?.destroy();
		this.pdfDoc = null;
		this.renderedPages.clear();
		this.pages.clear();
	}
}
