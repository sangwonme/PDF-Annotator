import { FileView, TFile, WorkspaceLeaf, Notice } from "obsidian";
import { VIEW_TYPE_PDF_ANNOTATOR } from "./types";
import type { Annotation } from "./types";
import { PdfRenderer, type RenderedPage } from "./PdfRenderer";
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

			// Re-render all pages at new scale (vector re-render)
			await this.renderer.reRenderAllPages();

			// Re-render all annotations at new positions
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

			// Load annotations
			await this.store.loadAnnotations(file);

			// Remove loading
			loading.remove();

			// Render all pages
			for (let i = 1; i <= numPages; i++) {
				const rendered = await this.renderer.renderPage(i);
				this.scrollContainer.appendChild(rendered.wrapper);

				// Render existing annotations for this page
				const pageAnnotations = this.store.getAnnotationsForPage(i);
				for (const annotation of pageAnnotations) {
					this.annotationLayer.renderHighlight(rendered, annotation);
				}
			}

			// Set up highlight manager for text selection
			this.highlightManager.setup(this.scrollContainer, file);
		} catch (e) {
			loading.setText(`Failed to load PDF: ${e}`);
		}
	}

	async onUnloadFile(file: TFile): Promise<void> {
		this.highlightManager.destroy();
		this.renderer.destroy();
		if (this.scrollContainer) {
			this.scrollContainer.empty();
		}
		await super.onUnloadFile(file);
	}
}
