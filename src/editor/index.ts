/* Which editor is the cursor in?
 *
 * One bundle serves both windows Zotero renders in an iframe: the note editor
 * (ProseMirror) and the reader (React, with plain contenteditable annotation
 * comments, and a textarea for each text annotation on the page). The window
 * itself says which, so there is nothing to configure.
 */
import { Buffer } from "./buffer";
import { currentBuffer as currentPMBuffer } from "./pm";
import { currentTextBuffer, recoverCommentFocus, trackCommentSelection } from "./contenteditable";
import { currentTextareaBuffer } from "./textarea";

export { recoverCommentFocus, trackCommentSelection };

export function isReaderWindow(win: any): boolean {
	return !!win.document?.getElementById?.("reader-ui");
}

export function currentBuffer(win: any): Buffer | null {
	if (isReaderWindow(win)) return currentTextBuffer(win) ?? currentTextareaBuffer(win);
	return currentPMBuffer(win);
}
