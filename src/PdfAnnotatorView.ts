import { FileView, TFile, WorkspaceLeaf } from "obsidian";
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
	}

	async onClose(): Promise<void> {
		this.highlightManager.destroy();
		this.renderer.destroy();
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
