import { App, TFile } from "obsidian";
import type { Annotation, AnnotationFileData } from "./types";

export class AnnotationStore {
	private annotations: Annotation[] = [];
	private file: TFile | null = null;
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	private getAnnotationPath(pdfFile: TFile): string {
		return pdfFile.path + ".annotations.json";
	}

	async loadAnnotations(pdfFile: TFile): Promise<void> {
		this.file = pdfFile;
		this.annotations = [];

		const path = this.getAnnotationPath(pdfFile);
		const existingFile = this.app.vault.getAbstractFileByPath(path);

		if (existingFile instanceof TFile) {
			try {
				const content = await this.app.vault.read(existingFile);
				const data: AnnotationFileData = JSON.parse(content);
				if (data.version === 1 && Array.isArray(data.annotations)) {
					this.annotations = data.annotations;
				}
			} catch (e) {
				console.error("Failed to load annotations:", e);
			}
		}
	}

	async saveAnnotations(): Promise<void> {
		if (!this.file) return;

		const path = this.getAnnotationPath(this.file);
		const data: AnnotationFileData = {
			version: 1,
			annotations: this.annotations,
		};
		const content = JSON.stringify(data, null, "\t");

		const existingFile = this.app.vault.getAbstractFileByPath(path);
		if (existingFile instanceof TFile) {
			await this.app.vault.modify(existingFile, content);
		} else {
			await this.app.vault.create(path, content);
		}
	}

	addAnnotation(annotation: Annotation): void {
		this.annotations.push(annotation);
	}

	removeAnnotation(id: string): void {
		this.annotations = this.annotations.filter(a => a.id !== id);
	}

	updateAnnotation(id: string, updates: Partial<Annotation>): void {
		const idx = this.annotations.findIndex(a => a.id === id);
		if (idx !== -1) {
			this.annotations[idx] = { ...this.annotations[idx], ...updates, modified: new Date().toISOString() };
		}
	}

	getAnnotation(id: string): Annotation | undefined {
		return this.annotations.find(a => a.id === id);
	}

	getAnnotationsForPage(pageNumber: number): Annotation[] {
		return this.annotations.filter(a => a.pageNumber === pageNumber);
	}

	getAllAnnotations(): Annotation[] {
		return [...this.annotations];
	}
}
