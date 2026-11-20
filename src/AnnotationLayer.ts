import type { PageInfo } from "./PdfRenderer";
import type { Annotation, PageSelector } from "./types";

export type CommentSaveCallback = (annotationId: string, newComment: string) => void;
export type AnnotationDeleteCallback = (annotationId: string) => void;
export type CommentClearCallback = (annotationId: string) => void;
export type StarToggleCallback = (annotationId: string) => void;

interface HighlightEntry {
	elements: HTMLElement[];
	commentCard: HTMLElement | null;
	/** Margin on the highlight's side of the page, where its comment card lives */
	commentMargin: HTMLElement;
	/** Normalized top of the highlight: where its card wants to sit */
	anchorY: number;
	color: string;
	starred: boolean;
	/** Excluded by the active filter */
	hidden: boolean;
}

export class AnnotationLayer {
	private entries: Map<string, HighlightEntry> = new Map();
	private onCommentSave: CommentSaveCallback | null = null;
	private onAnnotationDelete: AnnotationDeleteCallback | null = null;
	private onCommentClear: CommentClearCallback | null = null;
	private onStarToggle: StarToggleCallback | null = null;
	private overlapRAFs: Map<HTMLElement, number> = new Map();
	/** Header filters, OR-ed together; none active = show everything */
	private filter = { starred: false, colors: new Set<string>() };

	setCommentSaveCallback(cb: CommentSaveCallback): void {
		this.onCommentSave = cb;
	}

	setAnnotationDeleteCallback(cb: AnnotationDeleteCallback): void {
		this.onAnnotationDelete = cb;
	}

	setCommentClearCallback(cb: CommentClearCallback): void {
		this.onCommentClear = cb;
	}

	setStarToggleCallback(cb: StarToggleCallback): void {
		this.onStarToggle = cb;
	}

	renderHighlight(page: PageInfo, annotation: Annotation): void {
		const pageSelector = annotation.selectors.find(
			(s): s is PageSelector => s.type === "PageSelector"
		);
		const firstRect = pageSelector?.rects[0];
		if (!pageSelector || !firstRect) return;

		// Percent of the page box, so highlights follow zoom without re-rendering
		const elements = pageSelector.rects.map(rect => {
			const highlightEl = document.createElement("div");
			highlightEl.className = "pdf-annotator-highlight";
			highlightEl.dataset.annotationId = annotation.id;
			highlightEl.style.left = `${rect.x1 * 100}%`;
			highlightEl.style.top = `${rect.y1 * 100}%`;
			highlightEl.style.width = `${(rect.x2 - rect.x1) * 100}%`;
			highlightEl.style.height = `${(rect.y2 - rect.y1) * 100}%`;
			highlightEl.style.backgroundColor = annotation.color;
			return highlightEl;
		});
		page.annotationLayerDiv.append(...elements);

		const entry: HighlightEntry = {
			elements,
			commentCard: null,
			commentMargin: firstRect.x1 < 0.5 ? page.leftCommentMargin : page.rightCommentMargin,
			anchorY: firstRect.y1,
			color: annotation.color,
			starred: !!annotation.starred,
			hidden: false,
		};
		this.entries.set(annotation.id, entry);

		if (annotation.comment) {
			entry.commentCard = this.createCommentCard(annotation.id, entry.color, annotation.comment, entry.commentMargin, entry.starred);
		}
		entry.hidden = !this.passesFilter(entry);
		this.applyVisibility(entry);
	}

	/** Show only starred and/or the given colors (OR); nothing selected shows everything. */
	setFilter(starred: boolean, colors: Iterable<string>): void {
		this.filter = { starred, colors: new Set([...colors].map(c => c.toUpperCase())) };
		const margins = new Set<HTMLElement>();
		for (const entry of this.entries.values()) {
			entry.hidden = !this.passesFilter(entry);
			this.applyVisibility(entry);
			margins.add(entry.commentMargin);
		}
		margins.forEach(m => this.resolveOverlaps(m));
	}

	private passesFilter(entry: HighlightEntry): boolean {
		const { starred, colors } = this.filter;
		if (!starred && colors.size === 0) return true;
		return (starred && entry.starred) || colors.has(entry.color.toUpperCase());
	}

	private applyVisibility(entry: HighlightEntry): void {
		const display = entry.hidden ? "none" : "";
		entry.elements.forEach(el => el.style.display = display);
		if (entry.commentCard) entry.commentCard.style.display = display;
	}

	/** Re-check one highlight against the filter after its star/color changed. */
	private refreshVisibility(entry: HighlightEntry): void {
		const hidden = !this.passesFilter(entry);
		if (hidden === entry.hidden) return;
		entry.hidden = hidden;
		this.applyVisibility(entry);
		this.scheduleOverlapResolve(entry.commentMargin);
	}

	setStarred(annotationId: string, starred: boolean): void {
		const entry = this.entries.get(annotationId);
		if (!entry) return;
		entry.starred = starred;
		entry.commentCard?.classList.toggle("starred", starred);
		this.refreshVisibility(entry);
	}

	setActive(annotationId: string, active: boolean): void {
		const entry = this.entries.get(annotationId);
		if (entry) {
			entry.elements.forEach(el => el.classList.toggle("active", active));
			entry.commentCard?.classList.toggle("active", active);
		}
	}

	/**
	 * Start editing a comment card (for inline editing on new highlights).
	 * @param clearText If true, starts with empty textarea (for new highlights)
	 */
	startEditingCard(annotationId: string, clearText = false): void {
		const entry = this.entries.get(annotationId);
		if (!entry?.commentCard) return;

		// A note being written stays visible even if the active filter excludes it
		if (entry.hidden) {
			entry.hidden = false;
			this.applyVisibility(entry);
			this.scheduleOverlapResolve(entry.commentMargin);
		}

		const textEl = entry.commentCard.querySelector(".pdf-annotator-comment-text");
		const currentText = clearText ? "" : (textEl?.textContent ?? "");

		this.enterEditMode(entry.commentCard, annotationId, currentText, entry.commentMargin);
	}

	private createCommentCard(
		annotationId: string,
		color: string,
		comment: string,
		commentMargin: HTMLElement,
		starred: boolean
	): HTMLElement {
		const card = document.createElement("div");
		card.className = "pdf-annotator-comment-card";
		card.dataset.annotationId = annotationId;

		// Color indicator
		const colorBar = document.createElement("div");
		colorBar.className = "pdf-annotator-comment-color-bar";
		colorBar.style.backgroundColor = color;
		card.appendChild(colorBar);

		// Body (text + actions)
		const body = document.createElement("div");
		body.className = "pdf-annotator-comment-body";
		card.appendChild(body);

		// Comment text
		const text = document.createElement("div");
		text.className = "pdf-annotator-comment-text";
		text.textContent = comment;
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
			this.enterEditMode(card, annotationId, comment, commentMargin);
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
			this.onCommentClear?.(annotationId);
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
			this.onAnnotationDelete?.(annotationId);
		});

		// Star toggle: own column on the right, always visible, never over the text
		const starBtn = document.createElement("button");
		starBtn.className = "pdf-annotator-comment-star";
		starBtn.setAttribute("aria-label", "Star");
		starBtn.title = "Star";
		starBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>`;
		card.appendChild(starBtn);
		card.classList.toggle("starred", starred);

		starBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.onStarToggle?.(annotationId);
		});

		// Card hover → highlight active
		card.addEventListener("mouseenter", () => this.setActive(annotationId, true));
		card.addEventListener("mouseleave", () => this.setActive(annotationId, false));

		// Click toggles full text + action buttons (not while editing or selecting its text)
		card.addEventListener("click", () => {
			if (card.classList.contains("editing") || !window.getSelection()?.isCollapsed) return;
			card.classList.toggle("expanded");
			this.scheduleOverlapResolve(commentMargin);
		});

		commentMargin.appendChild(card);
		this.scheduleOverlapResolve(commentMargin);
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
			const newText = textarea.value.trim();
			textarea.remove();
			saveBtn.remove();
			(textEl as HTMLElement).style.display = "";
			(actionsEl as HTMLElement).style.display = "";
			card.classList.remove("editing");

			if (newText === "") {
				// Empty comment - clear it (remove card, keep highlight)
				this.onCommentClear?.(annotationId);
			} else {
				// Save non-empty comment
				textEl.textContent = newText;
				this.onCommentSave?.(annotationId, newText);
				this.scheduleOverlapResolve(commentMargin);
			}
		};

		const cancel = () => {
			textarea.remove();
			saveBtn.remove();
			(textEl as HTMLElement).style.display = "";
			(actionsEl as HTMLElement).style.display = "";
			card.classList.remove("editing");

			// If original text was empty (new highlight), clear the comment
			if (currentText === "" || currentText.trim() === "") {
				this.onCommentClear?.(annotationId);
			}
		};

		saveBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			save();
		});

		// ESC to cancel, Ctrl+Enter to save
		textarea.addEventListener("keydown", (e) => {
			if (e.key === "Escape") {
				e.preventDefault();
				cancel();
			} else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				save();
			}
		});
	}

	/**
	 * Schedule overlap resolution with requestAnimationFrame batching.
	 * Multiple calls for the same margin within a frame are batched into one.
	 */
	private scheduleOverlapResolve(commentMargin: HTMLElement): void {
		if (this.overlapRAFs.has(commentMargin)) return;

		const rafId = requestAnimationFrame(() => {
			this.resolveOverlaps(commentMargin);
			this.overlapRAFs.delete(commentMargin);
		});
		this.overlapRAFs.set(commentMargin, rafId);
	}

	/** Lay out a page's comment cards now, e.g. after zoom or when it scrolls into view. */
	layoutPage(page: PageInfo): void {
		this.resolveOverlaps(page.leftCommentMargin);
		this.resolveOverlaps(page.rightCommentMargin);
	}

	/**
	 * Place a margin's cards next to their highlights, pushing later cards down
	 * so none overlap, and grow the margin if they run past the page bottom.
	 */
	private resolveOverlaps(commentMargin: HTMLElement): void {
		// Hidden (e.g. background tab): nothing to measure; layoutPage() runs when it scrolls into view
		if (!commentMargin.offsetParent) return;

		const cards: { el: HTMLElement; anchorY: number }[] = [];
		for (const entry of this.entries.values()) {
			if (entry.commentCard && !entry.hidden && entry.commentMargin === commentMargin) {
				cards.push({ el: entry.commentCard, anchorY: entry.anchorY });
			}
		}
		cards.sort((a, b) => a.anchorY - b.anchorY);

		const pageEl = commentMargin.parentElement?.querySelector<HTMLElement>(".pdf-annotator-page");
		const pageHeight = pageEl?.offsetHeight ?? 0;

		// Read all heights before writing any top, to avoid a forced layout per card
		const heights = cards.map(c => c.el.offsetHeight);

		const GAP = 6; // px between cards
		let nextAvailableTop = 0;
		cards.forEach((c, i) => {
			const top = Math.max(c.anchorY * pageHeight, nextAvailableTop);
			c.el.style.top = `${top}px`;
			nextAvailableTop = top + heights[i] + GAP;
		});

		// min-height (set by the renderer) keeps the page height; this only grows past it
		commentMargin.style.height = `${nextAvailableTop}px`;
	}

	removeHighlight(annotationId: string): void {
		const entry = this.entries.get(annotationId);
		if (!entry) return;

		entry.elements.forEach(el => el.remove());
		entry.commentCard?.remove();
		this.entries.delete(annotationId);
		this.scheduleOverlapResolve(entry.commentMargin);
	}

	updateHighlightColor(annotationId: string, color: string): void {
		const entry = this.entries.get(annotationId);
		if (entry) {
			entry.color = color;
			entry.elements.forEach(el => {
				el.style.backgroundColor = color;
			});
			const colorBar = entry.commentCard?.querySelector(".pdf-annotator-comment-color-bar") as HTMLElement;
			if (colorBar) colorBar.style.backgroundColor = color;
			this.refreshVisibility(entry);
		}
	}

	updateHighlightComment(annotationId: string, hasComment: boolean, comment: string): void {
		const entry = this.entries.get(annotationId);
		if (!entry) return;

		// Saving an edit recreates the card; keep it open if it was
		const wasExpanded = entry.commentCard?.classList.contains("expanded") ?? false;
		entry.commentCard?.remove();
		entry.commentCard = null;

		if (hasComment && comment) {
			entry.commentCard = this.createCommentCard(annotationId, entry.color, comment, entry.commentMargin, entry.starred);
			entry.commentCard.classList.toggle("expanded", wasExpanded);
			this.applyVisibility(entry);
		}
		this.scheduleOverlapResolve(entry.commentMargin);
	}

	/** Forget all highlights; their DOM goes away with the view's page elements. */
	clear(): void {
		this.entries.clear();
		this.overlapRAFs.forEach(rafId => cancelAnimationFrame(rafId));
		this.overlapRAFs.clear();
	}
}
