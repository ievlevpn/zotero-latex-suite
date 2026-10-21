/* The inline markup a text annotation can carry: equations, and `**bold**` /
 * `*italic*`.
 *
 * Zotero stores a text annotation as plain text — its sidebar editor has rich
 * text switched off — so emphasis can only be a convention in the text, the
 * way `$…$` is. This is markdown's, asterisks only: underscores turn up in
 * ordinary text (snake_case, file names) far more than in emphasis.
 *
 * The rules are a cut-down CommonMark. A run of `*` can open emphasis if
 * something other than whitespace follows it, and close it if something other
 * than whitespace precedes it, so `2 * 3 * 4` stays as typed. Closers pair with
 * the nearest opener, two stars at a time while both sides have two. `\*` is a
 * literal star. Equations are opaque, so a `*` inside one is never markup, and
 * emphasis can wrap one: `**the bound $x$ holds**`. A blank line ends any
 * emphasis still open.
 */
import { MathBounds, renderableEquations } from "src/utils/math_bounds";

export type InlineNode =
	| { type: "text"; text: string }
	| { type: "math"; bounds: MathBounds }
	| { type: "em" | "strong"; children: InlineNode[] };

type Delimiter = { type: "delim"; count: number; canOpen: boolean; canClose: boolean };
type Barrier = { type: "barrier"; text: string };
type Token = InlineNode | Delimiter | Barrier;

const isSpace = (ch: string | undefined) => ch === undefined || /\s/.test(ch);

function tokenize(text: string, equations: MathBounds[]): Token[] {
	const tokens: Token[] = [];
	let plain = "";
	const flush = () => {
		if (plain) tokens.push({ type: "text", text: plain });
		plain = "";
	};

	let next = 0; // index into equations
	let i = 0;
	while (i < text.length) {
		const equation = equations[next];
		if (equation && i === equation.outer_start) {
			flush();
			tokens.push({ type: "math", bounds: equation });
			i = equation.outer_end;
			next++;
			continue;
		}

		const ch = text[i];
		if (ch === "\\" && text[i + 1] === "*") {
			plain += "*";
			i += 2;
			continue;
		}
		if (ch === "*") {
			let end = i;
			while (text[end] === "*") end++;
			flush();
			tokens.push({
				type: "delim",
				count: end - i,
				canOpen: !isSpace(text[end]),
				canClose: !isSpace(text[i - 1]),
			});
			i = end;
			continue;
		}
		const blank = ch === "\n" ? /^\n[^\S\n]*\n\s*/.exec(text.slice(i)) : null;
		if (blank) {
			flush();
			tokens.push({ type: "barrier", text: blank[0] });
			i += blank[0].length;
			continue;
		}
		plain += ch;
		i++;
	}
	flush();
	return tokens;
}

/** Turn whatever is left of the markup back into the text it was. */
function settle(tokens: Token[]): InlineNode[] {
	const nodes: InlineNode[] = [];
	for (const token of tokens) {
		let node: InlineNode | null;
		if (token.type === "delim") node = token.count ? { type: "text", text: "*".repeat(token.count) } : null;
		else if (token.type === "barrier") node = { type: "text", text: token.text };
		else node = token;
		if (!node) continue;
		const last = nodes[nodes.length - 1];
		if (node.type === "text" && last?.type === "text") last.text += node.text;
		else nodes.push(node);
	}
	return nodes;
}

export function parseInline(text: string, equations: MathBounds[] = renderableEquations(text)): InlineNode[] {
	const tokens = tokenize(text, equations);

	let i = 0;
	while (i < tokens.length) {
		const closer = tokens[i];
		if (closer.type !== "delim" || !closer.canClose || closer.count === 0) {
			i++;
			continue;
		}

		let j = i - 1;
		for (; j >= 0; j--) {
			const token = tokens[j];
			if (token.type === "barrier") {
				j = -1;
				break;
			}
			if (token.type === "delim" && token.canOpen && token.count > 0) break;
		}
		if (j < 0) {
			i++;
			continue;
		}

		const opener = tokens[j] as Delimiter;
		const use = opener.count >= 2 && closer.count >= 2 ? 2 : 1;
		opener.count -= use;
		closer.count -= use;
		const inner = settle(tokens.slice(j + 1, i));
		tokens.splice(j + 1, i - j - 1, { type: use === 2 ? "strong" : "em", children: inner });
		// The closer is now just past what it closed; it may have stars to spare.
		i = j + 2;
	}

	return settle(tokens);
}

/** Does this text need rendering at all? */
export function hasInlineMarkup(nodes: InlineNode[]): boolean {
	return nodes.some((node) => node.type !== "text");
}

/** Build `nodes` as DOM, equations drawn by `equation`. */
export function buildInline(
	doc: Document,
	nodes: InlineNode[],
	equation: (bounds: MathBounds) => Node,
): DocumentFragment {
	const fragment = doc.createDocumentFragment();
	for (const node of nodes) {
		if (node.type === "text") fragment.append(node.text);
		else if (node.type === "math") fragment.append(equation(node.bounds));
		else {
			const element = doc.createElement(node.type === "strong" ? "b" : "i");
			element.append(buildInline(doc, node.children, equation));
			fragment.append(element);
		}
	}
	return fragment;
}
