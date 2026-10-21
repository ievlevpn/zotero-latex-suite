/* Keeping tabstops valid in the plain-text editors.
 *
 * Annotation comments and text annotations hold flat text, and tabstops in
 * them are plain offsets. They are kept valid by diffing the text on every
 * input: one changed span between a common prefix and suffix, which is what a
 * keystroke produces.
 */
import { Range } from "./buffer";

const watched = new WeakMap<HTMLElement, string>();

/** `read` gives the element's text, the way its buffer counts offsets. */
export function watchText(element: HTMLElement, read: () => string, remap: (map: (range: Range) => Range) => void) {
	if (watched.has(element)) {
		watched.set(element, read());
		return;
	}
	watched.set(element, read());

	element.addEventListener("input", () => {
		const before = watched.get(element) ?? "";
		const after = read();
		watched.set(element, after);
		if (before === after) return;

		let prefix = 0;
		while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
		let suffix = 0;
		while (
			suffix < before.length - prefix &&
			suffix < after.length - prefix &&
			before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
		) suffix++;

		const oldEnd = before.length - suffix;
		const newEnd = after.length - suffix;
		const delta = after.length - before.length;

		// A tabstop's start holds still and its end follows the text, so typing
		// into a placeholder grows it — including an empty one, where both ends
		// sit exactly where the text is being inserted and only the bias tells
		// them apart. Same rule as CodeMirror's `mapPos`.
		const move = (offset: number, bias: -1 | 1) => {
			if (offset < prefix) return offset;
			if (offset > oldEnd) return offset + delta;
			return bias < 0 ? prefix : newEnd;
		};
		remap((range) => ({ from: move(range.from, -1), to: move(range.to, 1) }));
	});
}
