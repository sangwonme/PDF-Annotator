import type { PageInfo } from "./PdfRenderer";
import type { Annotation, PageSelector } from "./types";

export type CommentSaveCallback = (annotationId: string, newComment: string) => void;
export type AnnotationDeleteCallback = (annotationId: string) => void;
export type CommentClearCallback = (annotationId: string) => void;

interface HighlightEntry {
	elements: HTMLElement[];
	commentCard: HTMLElement | null;
}

export class AnnotationLayer {
	private entries: Map<string, HighlightEntry> = new Map();
	private onCommentSave: CommentSaveCallback | null = null;
	private onAnnotationDelete: AnnotationDeleteCallback | null = null;
	private onCommentClear: CommentClearCallback | null = null;

	setCommentSaveCallback(cb: CommentSaveCallback): void {
		this.onCommentSave = cb;
	}

	setAnnotationDeleteCallback(cb: AnnotationDeleteCallback): void {
		this.onAnnotationDelete = cb;
	}

	setCommentClearCallback(cb: CommentClearCallback): void {
		this.onCommentClear = cb;
	}

	renderHighlight(page: PageInfo, annotation: Annotation): void {
		const pageSelector = annotation.selectors.find(
			(s): s is PageSelector => s.type === "PageSelector"
		);
		if (!pageSelector) return;

		const { viewport, annotationLayerDiv, commentMargin } = page;
		const elements: HTMLElement[] = [];

		for (const rect of pageSelector.rects) {
			const highlightEl = document.createElement("div");
			highlightEl.className = "pdf-annotator-highlight";
			highlightEl.dataset.annotationId = annotation.id;

			highlightEl.style.left = `${rect.x1 * viewport.width}px`;
			highlightEl.style.top = `${rect.y1 * viewport.height}px`;
			highlightEl.style.width = `${(rect.x2 - rect.x1) * viewport.width}px`;
			highlightEl.style.height = `${(rect.y2 - rect.y1) * viewport.height}px`;
			highlightEl.style.backgroundColor = annotation.color;

			annotationLayerDiv.appendChild(highlightEl);
			elements.push(highlightEl);
		}

		// Comment card in the margin
		let commentCard: HTMLElement | null = null;
		if (annotation.comment) {
			commentCard = this.createCommentCard(annotation, pageSelector, viewport, commentMargin);
		}

		// Comment card hover → highlight active
		if (commentCard) {
			commentCard.addEventListener("mouseenter", () => this.setActive(annotation.id, true));
			commentCard.addEventListener("mouseleave", () => this.setActive(annotation.id, false));
		}

		this.entries.set(annotation.id, { elements, commentCard });
	}

	setActive(annotationId: string, active: boolean): void {
		const entry = this.entries.get(annotationId);
		if (entry) {
			entry.elements.forEach(el => el.classList.toggle("active", active));
			entry.commentCard?.classList.toggle("active", active);
		}
	}

	private createCommentCard(
		annotation: Annotation,
		pageSelector: PageSelector,
		viewport: { width: number; height: number },
		commentMargin: HTMLElement
	): HTMLElement {
		const firstRect = pageSelector.rects[0];
		const topPx = firstRect.y1 * viewport.height;
		return this.createCommentCardAt(annotation, topPx, commentMargin);
	}

	private createCommentCardAt(
		annotation: Annotation,
		topPx: number,
		commentMargin: HTMLElement
	): HTMLElement {
		const card = document.createElement("div");
		card.className = "pdf-annotator-comment-card";
		card.dataset.annotationId = annotation.id;
		card.style.top = `${topPx}px`;

		// Color indicator
		const colorBar = document.createElement("div");
		colorBar.className = "pdf-annotator-comment-color-bar";
		colorBar.style.backgroundColor = annotation.color;
		card.appendChild(colorBar);

		// Body (text + actions)
		const body = document.createElement("div");
		body.className = "pdf-annotator-comment-body";
		card.appendChild(body);

		// Comment text
		const text = document.createElement("div");
		text.className = "pdf-annotator-comment-text";
		text.textContent = annotation.comment;
		body.appendChild(text);

		// Action buttons container
		const actions = document.createElement("div");
		actions.className = "pdf-annotator-comment-actions";
		body.appendChild(actions);

		// Edit button (pencil)
		const editBtn = document.createElement("button");
		editBtn.className = "pdf-annotator-comment-action-btn";
		editBtn.setAttribute("aria-label", "Edit comment");
		editBtn.title = "Edit comment";
		editBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></svg>`;
		actions.appendChild(editBtn);

		editBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.enterEditMode(card, annotation.id, annotation.comment, commentMargin);
		});

		// Clear comment button (eraser) - removes comment only, keeps highlight
		const clearBtn = document.createElement("button");
		clearBtn.className = "pdf-annotator-comment-action-btn";
		clearBtn.setAttribute("aria-label", "Clear comment");
		clearBtn.title = "Clear comment";
		clearBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="m5 11 9 9"/></svg>`;
		actions.appendChild(clearBtn);

		clearBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.onCommentClear?.(annotation.id);
		});

		// Delete button (trash) - removes highlight and comment
		const deleteBtn = document.createElement("button");
		deleteBtn.className = "pdf-annotator-comment-action-btn pdf-annotator-comment-action-btn--danger";
		deleteBtn.setAttribute("aria-label", "Delete highlight");
		deleteBtn.title = "Delete highlight and comment";
		deleteBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/><line x1="10" x2="10" y1="11" y2="17"/><line x1="14" x2="14" y1="11" y2="17"/></svg>`;
		actions.appendChild(deleteBtn);

		deleteBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.onAnnotationDelete?.(annotation.id);
		});

		commentMargin.appendChild(card);
		this.resolveOverlaps(commentMargin);
		return card;
	}

	private enterEditMode(card: HTMLElement, annotationId: string, currentText: string, commentMargin: HTMLElement): void {
		const body = card.querySelector(".pdf-annotator-comment-body")!;
		const textEl = body.querySelector(".pdf-annotator-comment-text")!;
		const actionsEl = body.querySelector(".pdf-annotator-comment-actions")!;

		// Hide text + actions
		(textEl as HTMLElement).style.display = "none";
		(actionsEl as HTMLElement).style.display = "none";

		// Textarea
		const textarea = document.createElement("textarea");
		textarea.className = "pdf-annotator-comment-textarea";
		textarea.value = currentText;
		body.insertBefore(textarea, textEl);

		// Save button
		const saveBtn = document.createElement("button");
		saveBtn.className = "pdf-annotator-comment-save-btn";
		saveBtn.setAttribute("aria-label", "Save");
		saveBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>`;
		body.appendChild(saveBtn);

		card.classList.add("editing");

		setTimeout(() => {
			textarea.focus();
			textarea.setSelectionRange(textarea.value.length, textarea.value.length);
		}, 10);

		const save = () => {
			const newText = textarea.value;
			textarea.remove();
			saveBtn.remove();
			(textEl as HTMLElement).style.display = "";
			(actionsEl as HTMLElement).style.display = "";
			textEl.textContent = newText;
			card.classList.remove("editing");
			this.onCommentSave?.(annotationId, newText);
			this.resolveOverlaps(commentMargin);
		};

		saveBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			save();
		});

		textarea.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				save();
			}
		});
	}

	/**
	 * Reposition comment cards in a margin so none overlap.
	 */
	private resolveOverlaps(commentMargin: HTMLElement): void {
		const cards = Array.from(
			commentMargin.querySelectorAll<HTMLElement>(".pdf-annotator-comment-card")
		);
		if (cards.length < 2) return;

		// Sort by desired top position
		cards.sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top));

		const GAP = 6; // px between cards
		let nextAvailableTop = 0;

		for (const card of cards) {
			const desiredTop = parseFloat(card.style.top);
			const actualTop = Math.max(desiredTop, nextAvailableTop);
			card.style.top = `${actualTop}px`;
			nextAvailableTop = actualTop + card.offsetHeight + GAP;
		}
	}

	removeHighlight(annotationId: string): void {
		const entry = this.entries.get(annotationId);
		if (entry) {
			const margin = entry.commentCard?.parentElement;
			entry.elements.forEach(el => el.remove());
			entry.commentCard?.remove();
			this.entries.delete(annotationId);
			if (margin) this.resolveOverlaps(margin);
		}
	}

	updateHighlightColor(annotationId: string, color: string): void {
		const entry = this.entries.get(annotationId);
		if (entry) {
			entry.elements.forEach(el => {
				el.style.backgroundColor = color;
			});
			const colorBar = entry.commentCard?.querySelector(".pdf-annotator-comment-color-bar") as HTMLElement;
			if (colorBar) colorBar.style.backgroundColor = color;
		}
	}

	updateHighlightComment(annotationId: string, hasComment: boolean, comment: string): void {
		const entry = this.entries.get(annotationId);
		if (!entry) return;

		// Remove old comment card
		entry.commentCard?.remove();
		entry.commentCard = null;

		if (hasComment && comment) {
			const firstEl = entry.elements[0];
			if (!firstEl) return;

			const wrapper = firstEl.closest(".pdf-annotator-page-wrapper");
			const commentMargin = wrapper?.querySelector(".pdf-annotator-comment-margin") as HTMLElement;
			if (!commentMargin) return;

			const topPx = parseFloat(firstEl.style.top);
			const fakeAnnotation: Annotation = {
				id: annotationId,
				type: "highlight",
				color: firstEl.style.backgroundColor,
				created: "",
				modified: "",
				pageNumber: 0,
				selectors: [{ type: "PageSelector", pageNumber: 0, rects: [{ x1: 0, y1: topPx, x2: 0, y2: 0 }] }],
				comment,
			};
			// Use topPx directly
			const card = this.createCommentCardAt(fakeAnnotation, topPx, commentMargin);
			entry.commentCard = card;

			// Re-bind hover
			card.addEventListener("mouseenter", () => this.setActive(annotationId, true));
			card.addEventListener("mouseleave", () => this.setActive(annotationId, false));
		}
	}

	clear(): void {
		this.entries.forEach(entry => {
			entry.elements.forEach(el => el.remove());
			entry.commentCard?.remove();
		});
		this.entries.clear();
	}
}
