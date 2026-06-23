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
	private pageTrackingObserver: IntersectionObserver | null = null;
	private renderingPages: Set<number> = new Set();
	private pageIndicator: HTMLDivElement | null = null;
	private currentPage = 1;
	private totalPages = 0;

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

		// Header with page indicator
		const header = container.createDiv({ cls: "pdf-annotator-header" });
		this.setupPageIndicator(header);

		// Scroll container for PDF content
		this.scrollContainer = container.createDiv({ cls: "pdf-annotator-scroll" });
		this.setupZoomHandlers();
	}

	async onClose(): Promise<void> {
		this.intersectionObserver?.disconnect();
		this.intersectionObserver = null;
		this.pageTrackingObserver?.disconnect();
		this.pageTrackingObserver = null;
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

	private setupPageIndicator(header: HTMLElement): void {
		this.pageIndicator = header.createDiv({ cls: "pdf-annotator-page-indicator" });
		this.pageIndicator.setText("0 / 0");
	}

	private updatePageIndicator(): void {
		if (!this.pageIndicator) return;
		this.pageIndicator.setText(`${this.currentPage} / ${this.totalPages}`);
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

			// Re-render annotations only for rendered pages (not placeholders)
			this.annotationLayer.clear();
			for (const rendered of this.renderer.getAllRenderedPages()) {
				const pageAnnotations = this.store.getAnnotationsForPage(rendered.pageNumber);
				for (const annotation of pageAnnotations) {
					this.annotationLayer.renderHighlight(rendered, annotation);
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

			// Initialize page tracking
			this.totalPages = numPages;
			this.currentPage = 1;
			this.updatePageIndicator();

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

		// Observer for lazy rendering (wide margin for pre-rendering)
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
				rootMargin: "150% 0px", // pre-render ±1.5 viewport heights
			}
		);

		// Separate observer for accurate page tracking (no margin, high threshold)
		this.pageTrackingObserver = new IntersectionObserver(
			(entries) => {
				// Find the page with highest intersection ratio (most visible)
				let maxRatio = 0;
				let mostVisiblePage = this.currentPage;

				for (const entry of entries) {
					if (entry.isIntersecting && entry.intersectionRatio > maxRatio) {
						const pageNumber = parseInt(
							(entry.target as HTMLElement).dataset.pageNumber ?? "0"
						);
						if (pageNumber) {
							maxRatio = entry.intersectionRatio;
							mostVisiblePage = pageNumber;
						}
					}
				}

				if (mostVisiblePage !== this.currentPage && maxRatio > 0) {
					this.currentPage = mostVisiblePage;
					this.updatePageIndicator();
				}
			},
			{
				root: this.scrollContainer,
				rootMargin: "0px", // exact viewport boundaries
				threshold: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0], // track visibility percentage
			}
		);

		for (const pageInfo of this.renderer.getAllPageInfos()) {
			this.intersectionObserver.observe(pageInfo.wrapper);
			this.pageTrackingObserver.observe(pageInfo.wrapper);
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
		this.pageTrackingObserver?.disconnect();
		this.pageTrackingObserver = null;
		this.highlightManager.destroy();
		this.renderer.destroy();
		if (this.scrollContainer) {
			this.scrollContainer.empty();
		}
		await super.onUnloadFile(file);
	}
}
