import { Plugin, TFile, TAbstractFile, Menu } from "obsidian";
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

		// Move annotation file when PDF is renamed/moved
		this.registerEvent(
			this.app.vault.on("rename", (file: TAbstractFile, oldPath: string) => {
				if (file instanceof TFile && file.extension === "pdf") {
					this.moveAnnotationFile(oldPath, file.path);
				}
			})
		);

		// Delete annotation file when PDF is deleted
		this.registerEvent(
			this.app.vault.on("delete", (file: TAbstractFile) => {
				if (file instanceof TFile && file.extension === "pdf") {
					this.deleteAnnotationFile(file.path);
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

		// Command: undo annotation
		this.addCommand({
			id: "pdf-annotator-undo",
			name: "Undo annotation",
			checkCallback: (checking) => {
				const activeView = this.app.workspace.getActiveViewOfType(PdfAnnotatorView);
				if (activeView && activeView.canUndo()) {
					if (!checking) activeView.undo();
					return true;
				}
				return false;
			},
			hotkeys: [{ modifiers: ["Mod"], key: "z" }],
		});

		// Command: redo annotation
		this.addCommand({
			id: "pdf-annotator-redo",
			name: "Redo annotation",
			checkCallback: (checking) => {
				const activeView = this.app.workspace.getActiveViewOfType(PdfAnnotatorView);
				if (activeView && activeView.canRedo()) {
					if (!checking) activeView.redo();
					return true;
				}
				return false;
			},
			hotkeys: [{ modifiers: ["Mod", "Shift"], key: "z" }],
		});
	}

	async openPdfAnnotator(file: TFile): Promise<void> {
		const leaf = this.app.workspace.getLeaf("tab");
		await leaf.setViewState({
			type: VIEW_TYPE_PDF_ANNOTATOR,
			state: { file: file.path },
		});
	}

	private async moveAnnotationFile(oldPdfPath: string, newPdfPath: string): Promise<void> {
		const oldAnnotationPath = oldPdfPath + ".annotations.json";
		const newAnnotationPath = newPdfPath + ".annotations.json";
		const annotationFile = this.app.vault.getAbstractFileByPath(oldAnnotationPath);
		if (annotationFile instanceof TFile) {
			await this.app.fileManager.renameFile(annotationFile, newAnnotationPath);
		}
	}

	private async deleteAnnotationFile(pdfPath: string): Promise<void> {
		const annotationPath = pdfPath + ".annotations.json";
		const annotationFile = this.app.vault.getAbstractFileByPath(annotationPath);
		if (annotationFile instanceof TFile) {
			await this.app.vault.delete(annotationFile);
		}
	}

	async onunload(): Promise<void> {
	}
}
