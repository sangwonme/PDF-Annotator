import { FileView, TFile, WorkspaceLeaf, Notice } from "obsidian";
import { VIEW_TYPE_PDF_ANNOTATOR } from "./types";
import type { Annotation } from "./types";
import { PdfRenderer, type PageInfo } from "./PdfRenderer";
import { AnnotationStore } from "./AnnotationStore";
import { HighlightManager } from "./HighlightManager";
import { AnnotationLayer } from "./AnnotationLayer";
import type PdfAnnotatorPlugin from "./main";

export class PdfAnnotatorView extends FileView {
	private renderer: PdfRenderer;
	private store: AnnotationStore;
	private highlightManager: HighlightManager;
	private annotationLayer: AnnotationLayer;
	private scrollContainer: HTMLDivElement | null = null;
	private plugin: PdfAnnotatorPlugin;
	private zoomAbortController: AbortController | null = null;
	private isZooming = false;
	private intersectionObserver: IntersectionObserver | null = null;
	private renderingPages: Set<number> = new Set();

	constructor(leaf: WorkspaceLeaf, plugin: PdfAnnotatorPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.renderer = new PdfRenderer();
		this.store = new AnnotationStore(this.app);
		this.annotationLayer = new AnnotationLayer();
		this.highlightManager = new HighlightManager(
			this.renderer,
			this.store,
			this.annotationLayer,
			this.app
		);
	}

	getViewType(): string {
		return VIEW_TYPE_PDF_ANNOTATOR;
	}

	getDisplayText(): string {
		return this.file?.basename ?? "PDF Annotator";
	}

	getIcon(): string {
		return "file-text";
	}

	canAcceptExtension(extension: string): boolean {
		return extension === "pdf";
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("pdf-annotator-container");

		this.scrollContainer = container.createDiv({ cls: "pdf-annotator-scroll" });
		this.setupZoomHandlers();
	}

	async onClose(): Promise<void> {
		this.intersectionObserver?.disconnect();
		this.intersectionObserver = null;
		this.zoomAbortController?.abort();
		this.highlightManager.destroy();
		this.renderer.destroy();
	}

	private setupZoomHandlers(): void {
		if (!this.scrollContainer) return;
		this.zoomAbortController = new AbortController();
		const signal = this.zoomAbortController.signal;

		// Ctrl/Cmd + scroll → zoom
		this.scrollContainer.addEventListener("wheel", (e) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault();
				if (e.deltaY < 0) {
					this.zoom("in");
				} else if (e.deltaY > 0) {
					this.zoom("out");
				}
			}
		}, { signal, passive: false });

		// Ctrl/Cmd + +/- → zoom
		this.containerEl.addEventListener("keydown", (e) => {
			if (e.ctrlKey || e.metaKey) {
				if (e.key === "=" || e.key === "+") {
					e.preventDefault();
					this.zoom("in");
				} else if (e.key === "-") {
					e.preventDefault();
					this.zoom("out");
				} else if (e.key === "0") {
					e.preventDefault();
					this.zoom("reset");
				}
			}
		}, { signal });
	}

	private async zoom(direction: "in" | "out" | "reset"): Promise<void> {
		if (this.isZooming) return;
		this.isZooming = true;

		try {
			const scrollEl = this.scrollContainer!;
			// Remember scroll position as a ratio
			const scrollRatio = scrollEl.scrollHeight > 0
				? scrollEl.scrollTop / scrollEl.scrollHeight
				: 0;

			if (direction === "reset") {
				this.renderer.setScale(1.5);
			} else if (direction === "in") {
				this.renderer.zoomIn();
			} else {
				this.renderer.zoomOut();
			}

			const scale = this.renderer.getScale();
			new Notice(`Zoom: ${Math.round(scale * 100 / 1.5)}%`);

			// Update sizes for all pages: re-render visible, resize placeholders
			await this.renderer.updateAllPlaceholders();
			await this.renderer.reRenderAllPages();

			// Re-render all annotations at new viewport positions
			this.annotationLayer.clear();
			for (const pageInfo of this.renderer.getAllPageInfos()) {
				const pageAnnotations = this.store.getAnnotationsForPage(pageInfo.pageNumber);
				for (const annotation of pageAnnotations) {
					this.annotationLayer.renderHighlight(pageInfo, annotation);
				}
			}

			// Restore scroll position
			scrollEl.scrollTop = scrollRatio * scrollEl.scrollHeight;
		} finally {
			this.isZooming = false;
		}
	}

	async onLoadFile(file: TFile): Promise<void> {
		await super.onLoadFile(file);

		if (!this.scrollContainer) return;
		this.scrollContainer.empty();

		// Show loading
		const loading = this.scrollContainer.createDiv({ cls: "pdf-annotator-loading" });
		loading.setText("Loading PDF...");

		try {
			// Load PDF
			const data = await this.app.vault.readBinary(file);
			const numPages = await this.renderer.loadDocument(data);

			// Load annotations
			await this.store.loadAnnotations(file);

			// Remove loading
			loading.remove();

			// Create lightweight placeholders for all pages (correct scroll height,
			// no canvas/text layer — prevents renderer crash on large documents)
			for (let i = 1; i <= numPages; i++) {
				const pageInfo = await this.renderer.createPlaceholder(i);
				this.scrollContainer.appendChild(pageInfo.wrapper);

				// Render existing annotations on placeholder (positioned correctly
				// even without canvas; mix-blend-mode on white bg looks fine)
				const pageAnnotations = this.store.getAnnotationsForPage(i);
				for (const annotation of pageAnnotations) {
					this.annotationLayer.renderHighlight(pageInfo, annotation);
				}
			}

			// Lazy-render pages as they scroll into/near the viewport
			this.setupIntersectionObserver();

			// Set up highlight manager for text selection
			this.highlightManager.setup(this.scrollContainer, file);
		} catch (e) {
			loading.setText(`Failed to load PDF: ${e}`);
		}
	}

	/**
	 * Observe page wrappers: render canvas when near viewport,
	 * free canvas memory when far away.
	 */
	private setupIntersectionObserver(): void {
		if (!this.scrollContainer) return;

		this.intersectionObserver?.disconnect();

		this.intersectionObserver = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					const pageNumber = parseInt(
						(entry.target as HTMLElement).dataset.pageNumber ?? "0"
					);
					if (!pageNumber) continue;

					if (entry.isIntersecting) {
						this.lazyRenderPage(pageNumber);
					} else {
						this.lazyUnrenderPage(pageNumber);
					}
				}
			},
			{
				root: this.scrollContainer,
				rootMargin: "100% 0px", // pre-render ±1 viewport height
			}
		);

		for (const pageInfo of this.renderer.getAllPageInfos()) {
			this.intersectionObserver.observe(pageInfo.wrapper);
		}
	}

	private async lazyRenderPage(pageNumber: number): Promise<void> {
		if (this.renderingPages.has(pageNumber)) return;
		if (this.renderer.isPageRendered(pageNumber)) return;

		this.renderingPages.add(pageNumber);
		try {
			await this.renderer.renderPageContent(pageNumber);
		} catch (e) {
			console.error(`PDF Annotator: failed to render page ${pageNumber}:`, e);
		} finally {
			this.renderingPages.delete(pageNumber);
		}
	}

	private lazyUnrenderPage(pageNumber: number): void {
		this.renderer.unrenderPageContent(pageNumber);
	}

	async onUnloadFile(file: TFile): Promise<void> {
		this.intersectionObserver?.disconnect();
		this.intersectionObserver = null;
		this.highlightManager.destroy();
		this.renderer.destroy();
		if (this.scrollContainer) {
			this.scrollContainer.empty();
		}
		await super.onUnloadFile(file);
	}
}
