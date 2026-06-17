export const VIEW_TYPE_PDF_ANNOTATOR = "pdf-annotator-view";

export const HIGHLIGHT_COLORS: Record<string, string> = {
	yellow: "#FFEB3B",
	green: "#66BB6A",
	blue: "#42A5F5",
	pink: "#EC407A",
	orange: "#FFA726",
};

export interface TextQuoteSelector {
	type: "TextQuoteSelector";
	exact: string;
	prefix: string;
	suffix: string;
}

export interface TextPositionSelector {
	type: "TextPositionSelector";
	start: number;
	end: number;
}

export interface PageSelector {
	type: "PageSelector";
	pageNumber: number;
	rects: NormalizedRect[];
}

export interface NormalizedRect {
	x1: number;
	y1: number;
	x2: number;
	y2: number;
}

export type AnnotationSelector = TextQuoteSelector | TextPositionSelector | PageSelector;

export interface Annotation {
	id: string;
	type: "highlight";
	color: string;
	created: string;
	modified: string;
	pageNumber: number;
	selectors: AnnotationSelector[];
	comment: string;
}

export interface AnnotationFileData {
	version: number;
	annotations: Annotation[];
}
