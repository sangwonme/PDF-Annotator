import * as pdfjsLib from "pdfjs-dist";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { TextLayer } from "pdfjs-dist";
// @ts-ignore - esbuild text loader
import pdfjsWorkerSrc from "pdfjs-dist/build/pdf.worker.min.mjs";

const workerBlob = new Blob([pdfjsWorkerSrc], { type: "application/javascript" });
pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(workerBlob);

export interface RenderedPage {
	pageNumber: number;
	wrapper: HTMLDivElement;
	container: HTMLDivElement;
	canvas: HTMLCanvasElement;
	textLayerDiv: HTMLDivElement;
	annotationLayerDiv: HTMLDivElement;
	commentMargin: HTMLDivElement;
	viewport: pdfjsLib.PageViewport;
}

export class PdfRenderer {
	private pdfDoc: PDFDocumentProxy | null = null;
	private renderedPages: Map<number, RenderedPage> = new Map();
	private scale = 1.5;

	async loadDocument(data: ArrayBuffer): Promise<number> {
		const loadingTask = pdfjsLib.getDocument({ data });
		this.pdfDoc = await loadingTask.promise;
		return this.pdfDoc.numPages;
	}

	async renderPage(pageNumber: number): Promise<RenderedPage> {
		if (!this.pdfDoc) throw new Error("No document loaded");

		const page: PDFPageProxy = await this.pdfDoc.getPage(pageNumber);
		const viewport = page.getViewport({ scale: this.scale });

		// Wrapper (page + comment margin)
		const wrapper = document.createElement("div");
		wrapper.className = "pdf-annotator-page-wrapper";

		// Page container
		const container = document.createElement("div");
		container.className = "pdf-annotator-page";
		container.dataset.pageNumber = String(pageNumber);
		container.style.width = `${viewport.width}px`;
		container.style.height = `${viewport.height}px`;
		container.style.position = "relative";
		wrapper.appendChild(container);

		// Comment margin (right side)
		const commentMargin = document.createElement("div");
		commentMargin.className = "pdf-annotator-comment-margin";
		commentMargin.style.minHeight = `${viewport.height}px`;
		wrapper.appendChild(commentMargin);

		// Canvas layer
		const canvas = document.createElement("canvas");
		canvas.width = viewport.width;
		canvas.height = viewport.height;
		container.appendChild(canvas);

		const ctx = canvas.getContext("2d")!;
		await page.render({ canvasContext: ctx, viewport }).promise;

		// Annotation layer (between canvas and text layer)
		const annotationLayerDiv = document.createElement("div");
		annotationLayerDiv.className = "pdf-annotator-annotation-layer";
		container.appendChild(annotationLayerDiv);

		// Text layer
		const textLayerDiv = document.createElement("div");
		textLayerDiv.className = "textLayer";
		// pdfjs 4.x uses --scale-factor CSS variable for text positioning
		textLayerDiv.style.setProperty("--scale-factor", String(this.scale));
		container.appendChild(textLayerDiv);

		const textContent = await page.getTextContent();
		const textLayer = new TextLayer({
			textContentSource: textContent,
			container: textLayerDiv,
			viewport: viewport,
		});
		await textLayer.render();

		const rendered: RenderedPage = {
			pageNumber,
			wrapper,
			container,
			canvas,
			textLayerDiv,
			annotationLayerDiv,
			commentMargin,
			viewport,
		};

		this.renderedPages.set(pageNumber, rendered);
		return rendered;
	}

	getRenderedPage(pageNumber: number): RenderedPage | undefined {
		return this.renderedPages.get(pageNumber);
	}

	getAllRenderedPages(): RenderedPage[] {
		return Array.from(this.renderedPages.values());
	}

	getScale(): number {
		return this.scale;
	}

	destroy(): void {
		this.pdfDoc?.destroy();
		this.pdfDoc = null;
		this.renderedPages.clear();
	}
}
