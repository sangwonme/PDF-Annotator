import type { Annotation } from "./types";
import type { AnnotationStore } from "./AnnotationStore";
import type { AnnotationLayer } from "./AnnotationLayer";
import type { PdfRenderer } from "./PdfRenderer";

/**
 * Command interface for undo/redo operations
 */
export interface Command {
	execute(): void;
	undo(): void;
	description: string;
}

/**
 * Command for creating a highlight
 */
export class CreateHighlightCommand implements Command {
	description = "Create highlight";

	constructor(
		private annotation: Annotation,
		private store: AnnotationStore,
		private layer: AnnotationLayer,
		private renderer: PdfRenderer
	) {}

	execute(): void {
		this.store.addAnnotation(this.annotation);
		const page = this.renderer.getRenderedPage(this.annotation.pageNumber);
		if (page) {
			this.layer.renderHighlight(page, this.annotation);
		}
		this.store.saveAnnotations();
	}

	undo(): void {
		this.store.removeAnnotation(this.annotation.id);
		this.layer.removeHighlight(this.annotation.id);
		this.store.saveAnnotations();
	}
}

/**
 * Command for deleting a highlight
 */
export class DeleteHighlightCommand implements Command {
	description = "Delete highlight";

	constructor(
		private annotation: Annotation,
		private store: AnnotationStore,
		private layer: AnnotationLayer,
		private renderer: PdfRenderer
	) {}

	execute(): void {
		this.store.removeAnnotation(this.annotation.id);
		this.layer.removeHighlight(this.annotation.id);
		this.store.saveAnnotations();
	}

	undo(): void {
		this.store.addAnnotation(this.annotation);
		const page = this.renderer.getRenderedPage(this.annotation.pageNumber);
		if (page) {
			this.layer.renderHighlight(page, this.annotation);
		}
		this.store.saveAnnotations();
	}
}

/**
 * Command for editing a comment
 */
export class EditCommentCommand implements Command {
	description = "Edit comment";

	constructor(
		private annotationId: string,
		private oldComment: string,
		private newComment: string,
		private store: AnnotationStore,
		private layer: AnnotationLayer
	) {}

	execute(): void {
		this.store.updateAnnotation(this.annotationId, { comment: this.newComment });
		this.layer.updateHighlightComment(this.annotationId, !!this.newComment, this.newComment);
		this.store.saveAnnotations();
	}

	undo(): void {
		this.store.updateAnnotation(this.annotationId, { comment: this.oldComment });
		this.layer.updateHighlightComment(this.annotationId, !!this.oldComment, this.oldComment);
		this.store.saveAnnotations();
	}
}

/**
 * Command for clearing a comment (keeping highlight)
 */
export class ClearCommentCommand implements Command {
	description = "Clear comment";

	constructor(
		private annotationId: string,
		private oldComment: string,
		private store: AnnotationStore,
		private layer: AnnotationLayer
	) {}

	execute(): void {
		this.store.updateAnnotation(this.annotationId, { comment: "" });
		this.layer.updateHighlightComment(this.annotationId, false, "");
		this.store.saveAnnotations();
	}

	undo(): void {
		this.store.updateAnnotation(this.annotationId, { comment: this.oldComment });
		this.layer.updateHighlightComment(this.annotationId, true, this.oldComment);
		this.store.saveAnnotations();
	}
}

/**
 * Command for changing highlight color
 */
export class ChangeColorCommand implements Command {
	description = "Change color";

	constructor(
		private annotationId: string,
		private oldColor: string,
		private newColor: string,
		private store: AnnotationStore,
		private layer: AnnotationLayer
	) {}

	execute(): void {
		this.store.updateAnnotation(this.annotationId, { color: this.newColor });
		this.layer.updateHighlightColor(this.annotationId, this.newColor);
		this.store.saveAnnotations();
	}

	undo(): void {
		this.store.updateAnnotation(this.annotationId, { color: this.oldColor });
		this.layer.updateHighlightColor(this.annotationId, this.oldColor);
		this.store.saveAnnotations();
	}
}

/**
 * Manages undo/redo operations
 */
export class UndoManager {
	private undoStack: Command[] = [];
	private redoStack: Command[] = [];
	private maxStackSize = 50;

	/**
	 * Execute a command and add it to the undo stack
	 */
	execute(command: Command): void {
		command.execute();
		this.undoStack.push(command);

		// Limit stack size
		if (this.undoStack.length > this.maxStackSize) {
			this.undoStack.shift();
		}

		// Clear redo stack when new command is executed
		this.redoStack = [];
	}

	/**
	 * Undo the last command
	 */
	undo(): void {
		const command = this.undoStack.pop();
		if (command) {
			command.undo();
			this.redoStack.push(command);
		}
	}

	/**
	 * Redo the last undone command
	 */
	redo(): void {
		const command = this.redoStack.pop();
		if (command) {
			command.execute();
			this.undoStack.push(command);
		}
	}

	/**
	 * Check if undo is available
	 */
	canUndo(): boolean {
		return this.undoStack.length > 0;
	}

	/**
	 * Check if redo is available
	 */
	canRedo(): boolean {
		return this.redoStack.length > 0;
	}

	/**
	 * Clear all undo/redo history
	 */
	clear(): void {
		this.undoStack = [];
		this.redoStack = [];
	}

	/**
	 * Get the description of the next undo action
	 */
	getUndoDescription(): string | null {
		const command = this.undoStack[this.undoStack.length - 1];
		return command ? command.description : null;
	}

	/**
	 * Get the description of the next redo action
	 */
	getRedoDescription(): string | null {
		const command = this.redoStack[this.redoStack.length - 1];
		return command ? command.description : null;
	}
}
