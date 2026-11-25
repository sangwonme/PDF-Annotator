import { setIcon } from "obsidian";
import { HIGHLIGHT_COLORS } from "./types";

export class ColorPicker {
	private containerEl: HTMLDivElement | null = null;
	private onSelect: ((color: string) => void) | null = null;
	private onDictionary: (() => void) | null = null;

	show(x: number, y: number, onSelect: (color: string) => void, onDictionary?: () => void, onHeading?: () => void): void {
		this.hide();
		this.onSelect = onSelect;
		this.onDictionary = onDictionary ?? null;

		this.containerEl = document.createElement("div");
		this.containerEl.className = "pdf-annotator-color-picker";
		this.containerEl.style.left = `${x}px`;
		this.containerEl.style.top = `${y}px`;

		for (const [name, hex] of Object.entries(HIGHLIGHT_COLORS)) {
			const btn = document.createElement("button");
			btn.className = "pdf-annotator-color-btn";
			btn.style.backgroundColor = hex;
			btn.setAttribute("aria-label", name);
			btn.title = name;
			btn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.onSelect?.(hex);
				this.hide();
			});
			this.containerEl.appendChild(btn);
		}

		if (onDictionary) {
			const separator = document.createElement("div");
			separator.className = "pdf-annotator-color-picker-separator";
			this.containerEl.appendChild(separator);

			const dictBtn = document.createElement("button");
			dictBtn.className = "pdf-annotator-color-btn pdf-annotator-dict-btn";
			dictBtn.setAttribute("aria-label", "사전 검색");
			dictBtn.title = "영한사전 검색 후 자동 노트";
			dictBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/><path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/></svg>`;
			dictBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				const cb = this.onDictionary;
				this.hide();
				cb?.();
			});
			this.containerEl.appendChild(dictBtn);
		}

		if (onHeading) {
			const headingBtn = document.createElement("button");
			headingBtn.className = "pdf-annotator-color-btn pdf-annotator-dict-btn";
			headingBtn.setAttribute("aria-label", "Add to table of contents");
			setIcon(headingBtn, "list-plus");
			headingBtn.addEventListener("click", (e) => {
				e.stopPropagation();
				this.hide();
				onHeading();
			});
			this.containerEl.appendChild(headingBtn);
		}

		document.body.appendChild(this.containerEl);

		// Close on click outside
		setTimeout(() => {
			document.addEventListener("mousedown", this.handleOutsideClick);
		}, 0);
	}

	private handleOutsideClick = (e: MouseEvent): void => {
		if (this.containerEl && !this.containerEl.contains(e.target as Node)) {
			this.hide();
		}
	};

	hide(): void {
		document.removeEventListener("mousedown", this.handleOutsideClick);
		this.containerEl?.remove();
		this.containerEl = null;
		this.onSelect = null;
	}
}
