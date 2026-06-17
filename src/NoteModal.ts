import { App, Modal } from "obsidian";

export class NoteModal extends Modal {
	private result: string;
	private onSubmit: (result: string) => void;
	private initialValue: string;

	constructor(app: App, initialValue: string, onSubmit: (result: string) => void) {
		super(app);
		this.initialValue = initialValue;
		this.result = initialValue;
		this.onSubmit = onSubmit;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pdf-annotator-note-modal");

		contentEl.createEl("h3", { text: "Annotation Note" });

		const textarea = contentEl.createEl("textarea", {
			cls: "pdf-annotator-note-textarea",
		});
		textarea.value = this.initialValue;
		textarea.placeholder = "Add a note...";
		textarea.addEventListener("input", () => {
			this.result = textarea.value;
		});

		// Focus and select all on open
		setTimeout(() => {
			textarea.focus();
			if (this.initialValue) {
				textarea.select();
			}
		}, 10);

		// Submit on Ctrl/Cmd+Enter
		textarea.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				this.submit();
			}
		});

		const btnContainer = contentEl.createDiv({ cls: "pdf-annotator-note-buttons" });

		const saveBtn = btnContainer.createEl("button", {
			text: "Save",
			cls: "mod-cta",
		});
		saveBtn.addEventListener("click", () => this.submit());

		const cancelBtn = btnContainer.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
	}

	private submit(): void {
		this.onSubmit(this.result);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
