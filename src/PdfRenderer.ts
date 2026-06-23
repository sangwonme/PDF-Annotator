import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
// @ts-ignore - esbuild text loader
import pdfjsWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs";

const workerBlob = new Blob([pdfjsWorkerSrc], { type: "application/javascript" });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

export interface PageInfo {
	pageNumber: number;
	wrapper: HTMLDivElement;
	container: HTMLDivElement;
	annotationLayerDiv: HTMLDivElement;
	leftCommentMargin: HTMLDivElement;
	rightCommentMargin: HTMLDivElement;
	viewport: pdfjsLib.PageViewport;
}

export interface RenderedPage extends PageInfo {
	canvas: HTMLCanvasElement;
	textLayerDiv: HTMLDivElement;
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

		const page: PDFPageProxy = await this.pdfDoc.getPage(pageNumber);
		const viewport = page.getViewport({ scale: this.scale });

		// Wrapper (left margin + page + right margin)
		const wrapper = document.createElement("div");
		wrapper.className = "pdf-annotator-page-wrapper";
		wrapper.dataset.pageNumber = String(pageNumber);

		// Left comment margin
		const leftCommentMargin = document.createElement("div");
		leftCommentMargin.className = "pdf-annotator-comment-margin pdf-annotator-comment-margin-left";
		leftCommentMargin.style.minHeight = `${viewport.height}px`;
		wrapper.appendChild(leftCommentMargin);

		// Page container
		const container = document.createElement("div");
		container.className = "pdf-annotator-page";
		container.dataset.pageNumber = String(pageNumber);
		container.style.width = `${viewport.width}px`;
		container.style.height = `${viewport.height}px`;
		container.style.position = "relative";
		wrapper.appendChild(container);

		// Right comment margin
		const rightCommentMargin = document.createElement("div");
		rightCommentMargin.className = "pdf-annotator-comment-margin pdf-annotator-comment-margin-right";
		rightCommentMargin.style.minHeight = `${viewport.height}px`;
		wrapper.appendChild(rightCommentMargin);

		// Annotation layer (will sit between canvas and text layer once rendered)
		const annotationLayerDiv = document.createElement("div");
		annotationLayerDiv.className = "pdf-annotator-annotation-layer";
		container.appendChild(annotationLayerDiv);

		const info: PageInfo = {
			pageNumber, wrapper, container, annotationLayerDiv, leftCommentMargin, rightCommentMargin, viewport,
		};
		this.pages.set(pageNumber, info);
		return info;
	}

	/**
	 * Render the actual canvas + text layer for a page that already has a
	 * placeholder. No-op if the page is already rendered.
	 */
	async renderPageContent(pageNumber: number): Promise<RenderedPage> {
		if (!this.pdfDoc) throw new Error("No document loaded");

		const existing = this.renderedPages.get(pageNumber);
		if (existing) return existing;

		const info = this.pages.get(pageNumber);
		if (!info) throw new Error(`No placeholder for page ${pageNumber}`);

		const page: PDFPageProxy = await this.pdfDoc.getPage(pageNumber);
		const viewport = page.getViewport({ scale: this.scale });

		// Canvas layer — insert before annotation layer
		const canvas = document.createElement("canvas");
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		info.container.insertBefore(canvas, info.annotationLayerDiv);

		const ctx = canvas.getContext("2d")!;
		await page.render({ canvasContext: ctx, viewport }).promise;

		// Text layer — append after annotation layer (topmost for selection)
		const textLayerDiv = document.createElement("div");
		textLayerDiv.className = "textLayer";
		textLayerDiv.style.setProperty("--scale-factor", String(this.scale));
		info.container.appendChild(textLayerDiv);

		const textContent = await page.getTextContent();
		const textLayer = new TextLayer({
			textContentSource: textContent,
			container: textLayerDiv,
			viewport,
		});
		await textLayer.render();

		info.viewport = viewport;

		const rendered: RenderedPage = {
			...info, canvas, textLayerDiv, viewport,
		};
		this.renderedPages.set(pageNumber, rendered);
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
	 * Re-render a single page at the current scale.
	 * Canvas is re-drawn from the PDF (vector quality), text layer rebuilt.
	 */
	async reRenderPage(rendered: RenderedPage): Promise<void> {
		if (!this.pdfDoc) return;

		const page = await this.pdfDoc.getPage(rendered.pageNumber);
		const viewport = page.getViewport({ scale: this.scale });

		// Update container size
		rendered.container.style.width = `${viewport.width}px`;
		rendered.container.style.height = `${viewport.height}px`;
		rendered.leftCommentMargin.style.minHeight = `${viewport.height}px`;
		rendered.rightCommentMargin.style.minHeight = `${viewport.height}px`;

		// Re-render canvas
		const canvas = rendered.canvas;
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		const ctx = canvas.getContext("2d")!;
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		await page.render({ canvasContext: ctx, viewport }).promise;

		// Rebuild text layer
		rendered.textLayerDiv.innerHTML = "";
		rendered.textLayerDiv.style.setProperty("--scale-factor", String(this.scale));
		const textContent = await page.getTextContent();
		const textLayer = new TextLayer({
			textContentSource: textContent,
			container: rendered.textLayerDiv,
			viewport: viewport,
		});
		await textLayer.render();

		// Update viewport reference
		rendered.viewport = viewport;

		// Sync viewport to base page info
		const info = this.pages.get(rendered.pageNumber);
		if (info) info.viewport = viewport;
	}

	/** Re-render only currently-rendered (visible) pages at the new scale. */
	async reRenderAllPages(): Promise<void> {
		for (const rendered of this.renderedPages.values()) {
			await this.reRenderPage(rendered);
		}
	}

	/** Update placeholder dimensions for non-rendered pages after a scale change. */
	async updateAllPlaceholders(): Promise<void> {
		if (!this.pdfDoc) return;
		for (const [pageNumber, info] of this.pages) {
			if (this.renderedPages.has(pageNumber)) continue;
			const page = await this.pdfDoc.getPage(pageNumber);
			const viewport = page.getViewport({ scale: this.scale });
			info.container.style.width = `${viewport.width}px`;
			info.container.style.height = `${viewport.height}px`;
			info.leftCommentMargin.style.minHeight = `${viewport.height}px`;
			info.rightCommentMargin.style.minHeight = `${viewport.height}px`;
			info.viewport = viewport;
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

	getAllRenderedPages(): RenderedPage[] {
		return Array.from(this.renderedPages.values());
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
