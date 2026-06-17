import { HIGHLIGHT_COLORS } from "./types";

export class ColorPicker {
	private containerEl: HTMLDivElement | null = null;
	private onSelect: ((color: string) => void) | null = null;

	show(x: number, y: number, onSelect: (color: string) => void): void {
		this.hide();
		this.onSelect = onSelect;

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

	isVisible(): boolean {
		return this.containerEl !== null;
	}
}
