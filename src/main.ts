import { Plugin, TFile, Menu } from "obsidian";
import { VIEW_TYPE_PDF_ANNOTATOR } from "./types";
import { PdfAnnotatorView } from "./PdfAnnotatorView";

export default class PdfAnnotatorPlugin extends Plugin {
	async onload(): Promise<void> {
		this.registerView(
			VIEW_TYPE_PDF_ANNOTATOR,
			(leaf) => new PdfAnnotatorView(leaf, this)
		);

		// File menu: "Open with PDF Annotator"
		this.registerEvent(
			this.app.workspace.on("file-menu", (menu: Menu, file) => {
				if (file instanceof TFile && file.extension === "pdf") {
					menu.addItem((item) => {
						item.setTitle("Open with PDF Annotator")
							.setIcon("highlighter")
							.onClick(() => this.openPdfAnnotator(file));
					});
				}
			})
		);

		// Command: open current PDF in annotator
		this.addCommand({
			id: "open-pdf-annotator",
			name: "Open current PDF with PDF Annotator",
			checkCallback: (checking) => {
				const file = this.app.workspace.getActiveFile();
				if (file?.extension === "pdf") {
					if (!checking) this.openPdfAnnotator(file);
					return true;
				}
				return false;
			},
		});
	}

	async openPdfAnnotator(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_PDF_ANNOTATOR,
			state: { file: file.path },
		});
	}

	async onunload(): Promise<void> {
	}
}
