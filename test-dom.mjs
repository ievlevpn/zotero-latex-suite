/* The contenteditable layer, against a real DOM.
 *
 * Every bug in this plugin so far has been here — offsets, ranges, and what
 * survives a render/unrender round trip — and none of it was reachable from the
 * other suites. jsdom has no layout, so anything measuring rectangles is out of
 * scope; everything structural is not.
 */
import assert from "node:assert";
import { JSDOM } from "jsdom";
import * as ls from "./build/test-exports.mjs";

/** Stands in for KaTeX: enough to tell rendered output from source. */
const katex = { render: (tex, element) => { element.textContent = `«${tex}»`; } };

function field(html) {
	const dom = new JSDOM(`<body><div class="comment"><div class="content" contenteditable="true">${html}</div></div></body>`);
	const el = dom.window.document.querySelector(".content");
	return { dom, el, window: dom.window };
}

export async function run() {
	/* --- the text model --- */
	{
		const { el } = field("abc $x$ def");
		assert.strictEqual(ls.segmentsOf(el).text, "abc $x$ def");

		const withBreak = field("a<br>b").el;
		assert.strictEqual(ls.segmentsOf(withBreak).text, "a\nb", "a <br> is one character");

		// Enter in a Gecko contenteditable starts a <div>, not a <br>.
		assert.strictEqual(ls.segmentsOf(field("foo<div>m</div>").el).text, "foo\nm", "a block starts a line");
		assert.strictEqual(ls.segmentsOf(field("<div>foo</div><div>m</div>").el).text, "foo\nm");
		assert.strictEqual(ls.segmentsOf(field("<div>foo</div>").el).text, "foo", "not before the first line");
		assert.strictEqual(ls.segmentsOf(field("a<br><div>b</div>").el).text, "a\nb", "one break, not two");

		const withMarkup = field("a<b>bc</b>d").el;
		assert.strictEqual(ls.segmentsOf(withMarkup).text, "abcd", "markup is transparent to the text model");
	}

	/* --- offsets round-trip at every position, before and after an equation --- */
	{
		const { el } = field("abc $x$ def");
		ls.renderMath(el, katex);

		const { segments, text } = ls.segmentsOf(el);
		assert.strictEqual(text, "abc $x$ def", "a rendered equation still reads as its source");

		// Offsets outside the equation round-trip exactly. Ones inside it cannot:
		// it is an atom, so they snap to the nearer side — 4 and 7 here.
		const snapped = { 5: 4, 6: 7 };
		for (let offset = 0; offset <= text.length; offset++) {
			const point = ls.domPointAt(el, segments, offset);
			assert.ok(point.node, `offset ${offset} has a DOM point`);
			assert.strictEqual(
				ls.offsetOfPoint(el, point.node, point.offset),
				snapped[offset] ?? offset,
				`offset ${offset} maps as expected`,
			);
		}
	}

	/* --- offsets round-trip across lines made by Enter --- */
	{
		const { el } = field("<div>foo</div><div>bar</div>");
		const { segments, text } = ls.segmentsOf(el);
		assert.strictEqual(text, "foo\nbar");
		for (let offset = 0; offset <= text.length; offset++) {
			const point = ls.domPointAt(el, segments, offset);
			assert.strictEqual(ls.offsetOfPoint(el, point.node, point.offset), offset, `offset ${offset} round-trips`);
		}
	}

	/* --- a snippet at the start of such a line keeps the line --- */
	{
		const dom = new JSDOM(
			`<body><div id="reader-ui"></div><div class="comment"><div class="content" contenteditable="true">foo<div>m</div></div></div></body>`);
		const win = dom.window;
		const el = win.document.querySelector(".content");
		Object.defineProperty(el, "isContentEditable", { value: true });
		el.focus();
		ls.setCaret(el, 5, 5);

		const settings = ls.processSettings({
			...ls.DEFAULT_SETTINGS,
			snippets: `export default [{trigger: "m", replacement: "$$0$", options: "t"}]`,
			snippetVariables: "export default {}",
		});
		assert.strictEqual(ls.runSnippets(win, { snippets: settings.snippets }, settings, ls.currentBuffer(win)), true);
		assert.strictEqual(ls.segmentsOf(el).text, "foo\n$$", "the line break survives the expansion");
		assert.deepStrictEqual(ls.selectionOffsets(el), { from: 5, to: 5 }, "caret between the dollars");
		ls.clearTabstops();
	}

	/* --- rendering, and putting it back exactly --- */
	{
		const { el } = field("abc $x$ def");
		assert.strictEqual(ls.renderMath(el, katex), true);
		assert.strictEqual(el.querySelectorAll("[data-latex-suite-source]").length, 1);
		assert.strictEqual(el.textContent, "abc «x» def", "the equation shows rendered");

		assert.strictEqual(ls.unrenderMath(el), true);
		assert.strictEqual(el.innerHTML, "abc $x$ def", "and comes back byte for byte");
	}

	/* --- an equation spanning inline markup keeps that markup --- */
	{
		const { el } = field("say $a<b>x</b>b$ ok");
		assert.strictEqual(ls.segmentsOf(el).text, "say $axb$ ok");
		ls.renderMath(el, katex);
		assert.strictEqual(el.querySelectorAll("[data-latex-suite-source]").length, 1, "it renders");

		ls.unrenderMath(el);
		assert.strictEqual(el.innerHTML, "say $a<b>x</b>b$ ok", "the <b> survives the round trip");
	}

	/* --- text either side of an equation behaves the same --- */
	{
		const { el } = field("abc $x$ def");
		ls.renderMath(el, katex);
		const { segments } = ls.segmentsOf(el);

		const before = ls.domPointAt(el, segments, 2);   // inside "abc"
		const after = ls.domPointAt(el, segments, 9);    // inside "def"
		assert.strictEqual(before.node.nodeType, 3, "before the equation is a text node");
		assert.strictEqual(after.node.nodeType, 3, "after the equation is a text node");
		assert.strictEqual(ls.offsetOfPoint(el, before.node, before.offset), 2);
		assert.strictEqual(ls.offsetOfPoint(el, after.node, after.offset), 9);

		// the boundaries either side of the atom
		const justBefore = ls.domPointAt(el, segments, 4);
		const justAfter = ls.domPointAt(el, segments, 7);
		assert.strictEqual(ls.offsetOfPoint(el, justBefore.node, justBefore.offset), 4, "boundary before the equation");
		assert.strictEqual(ls.offsetOfPoint(el, justAfter.node, justAfter.offset), 7, "boundary after the equation");
	}

	/* --- the caret's own equation is left as source, on either side --- */
	{
		const text = "abc $x$ def";
		const rendered = (caret) => {
			const { el } = field(text);
			ls.renderMath(el, katex, caret);
			return el.querySelectorAll("[data-latex-suite-source]").length;
		};
		assert.strictEqual(rendered(2), 1, "caret well before: renders");
		assert.strictEqual(rendered(9), 1, "caret well after: renders");
		assert.strictEqual(rendered(5), 0, "caret inside: stays source");
		assert.strictEqual(rendered(4), 0, "caret at the opening delimiter: stays source");
		assert.strictEqual(rendered(7), 0, "caret at the closing delimiter: stays source");
	}

	/* --- a snippet in a comment, from expansion to the caret leaving it ---
	 *
	 * The whole comment is one buffer, so nothing about the buffer changes when
	 * the caret steps out of the equation. That is what left the placeholder
	 * marks painted over the rendered result. */
	{
		const dom = new JSDOM(
			`<body><div id="reader-ui"></div><div class="comment"><div class="content" contenteditable="true">see $x/</div></div></body>`);
		const win = dom.window;
		const el = win.document.querySelector(".content");
		// jsdom does not implement it, and currentBuffer checks it.
		Object.defineProperty(el, "isContentEditable", { value: true });
		el.focus();
		ls.setCaret(el, 7, 7);

		const settings = ls.processSettings({
			...ls.DEFAULT_SETTINGS,
			snippets: `export default [{trigger: "/", replacement: "\\\\frac{$0}{$1}$2", options: "mA"}]`,
			snippetVariables: "export default {}",
		});
		const automatic = settings.snippets.filter((s) => s.options.automatic);

		assert.strictEqual(ls.runSnippets(win, { snippets: automatic, key: "/" }, settings, ls.currentBuffer(win)), true);
		assert.strictEqual(ls.segmentsOf(el).text, "see $x/\\frac{}{}");
		assert.deepStrictEqual(ls.selectionOffsets(el), { from: 13, to: 13 }, "the numerator is selected");
		assert.strictEqual(ls.hasTabstops(), true);

		// Typing into the empty placeholder has to grow it, not step out of it.
		ls.currentBuffer(win).replaceRange(13, 13, "y");
		assert.strictEqual(ls.segmentsOf(el).text, "see $x/\\frac{y}{}");
		ls.clearTabstopsIfElsewhere(ls.currentBuffer(win));
		assert.strictEqual(ls.hasTabstops(), true, "still filling in the numerator");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.currentBuffer(win), false), true);
		assert.deepStrictEqual(ls.selectionOffsets(el), { from: 16, to: 16 }, "Tab reaches the denominator");

		// Out of the equation, into the prose before it — same buffer throughout.
		ls.setCaret(el, 2, 2);
		ls.clearTabstopsIfElsewhere(ls.currentBuffer(win));
		assert.strictEqual(ls.hasTabstops(), false, "leaving math mode finishes the snippet");
		ls.clearTabstops();
	}

	/* --- the popup's enlarge button --- */
	{
		// Zotero's markup: the popup div is React's, classes and inline transform included.
		const popupHTML = `<div class="view-popup annotation-popup page-popup-bottom-center" style="transform: translate(10px, 20px)">
			<div class="preview"><header><div class="start"></div><div class="end"><button class="more"></button></div></header>
			<div class="comment"><div class="content" contenteditable="true"></div></div></div></div>`;
		const dom = new JSDOM(`<body><div id="reader-ui"></div>${popupHTML}</body>`);
		const doc = dom.window.document;
		const stop = ls.installPopupEnlarge(dom.window);

		const popup = doc.querySelector(".annotation-popup");
		const button = doc.querySelector(".latex-suite-enlarge");
		assert.ok(button, "an open popup gets the button");
		assert.strictEqual(button.previousElementSibling.className, "more", "it sits past Zotero's own menu, in the corner");
		assert.strictEqual(popup.hasAttribute("data-latex-suite-big"), false, "normal size by default");

		button.click();
		assert.strictEqual(popup.hasAttribute("data-latex-suite-big"), true, "click enlarges");
		assert.strictEqual(button.getAttribute("aria-pressed"), "true");
		assert.ok(popup.classList.contains("page-popup-bottom-center"), "React's classes are left alone");
		button.click();
		assert.strictEqual(popup.hasAttribute("data-latex-suite-big"), false, "click again restores");

		// A popup opened later — the usual case — gets one too, and only one.
		doc.body.insertAdjacentHTML("beforeend", popupHTML);
		await new Promise((resolve) => setTimeout(resolve, 0));
		assert.strictEqual(doc.querySelectorAll(".latex-suite-enlarge").length, 2, "one button per popup");

		button.click();
		stop();
		assert.strictEqual(doc.querySelectorAll(".latex-suite-enlarge").length, 0, "uninstall removes the buttons");
		assert.strictEqual(doc.querySelectorAll("[data-latex-suite-big]").length, 0, "and restores enlarged popups");
		assert.strictEqual(doc.getElementById("latex-suite-popup-enlarge"), null, "and its stylesheet");
	}

	/* --- text annotations: a textarea in the PDF view's own iframe --- */
	const pdfView = (textareas) => {
		const dom = new JSDOM(`<body><div id="reader-ui"></div><iframe></iframe></body>`);
		const inner = dom.window.document.querySelector("iframe").contentDocument;
		// Zotero's markup (src/pdf/page.js): the textarea sits in a layer in the page div.
		inner.body.innerHTML = `<div class="page"><div class="customAnnotationLayer">${textareas}</div></div>`;
		return { win: dom.window, inner, dom };
	};
	const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

	{
		const { win, inner } = pdfView(`<textarea class="textAnnotation" data-id="A">see $x/</textarea>`);
		const textarea = inner.querySelector("textarea");
		let saved = 0;
		textarea.addEventListener("input", () => saved++);
		textarea.focus();
		textarea.setSelectionRange(7, 7);

		const buffer = ls.currentBuffer(win);
		assert.ok(buffer instanceof ls.TextareaBuffer, "focus one frame down is found from the reader window");
		assert.strictEqual(buffer.kind, "math_inline");

		const settings = ls.processSettings({
			...ls.DEFAULT_SETTINGS,
			snippets: `export default [{trigger: "/", replacement: "\\\\frac{$0}{$1}$2", options: "mA"}]`,
			snippetVariables: "export default {}",
		});
		const automatic = settings.snippets.filter((s) => s.options.automatic);
		assert.strictEqual(ls.runSnippets(win, { snippets: automatic, key: "/" }, settings, buffer), true);
		assert.strictEqual(textarea.value, "see $x/\\frac{}{}");
		assert.deepStrictEqual([textarea.selectionStart, textarea.selectionEnd], [13, 13], "the numerator is selected");
		assert.ok(saved > 0, "the reader hears about the edit, so it saves it");

		ls.currentBuffer(win).replaceRange(13, 13, "y");
		assert.strictEqual(ls.setSelectionToNextTabstop(ls.currentBuffer(win), false), true);
		assert.deepStrictEqual([textarea.selectionStart, textarea.selectionEnd], [16, 16], "Tab reaches the denominator");
		ls.clearTabstops();

		textarea.disabled = true;
		assert.strictEqual(ls.currentBuffer(win), null, "a read-only annotation is left alone");
	}

	/* --- markdown emphasis in text annotations --- */
	{
		// Flattened to a string so the cases read at a glance: <b>, <i>, [math].
		const show = (nodes, text) => nodes.map((node) => {
			if (node.type === "text") return node.text;
			if (node.type === "math") return `[${text.slice(node.bounds.outer_start, node.bounds.outer_end)}]`;
			const tag = node.type === "strong" ? "b" : "i";
			return `<${tag}>${show(node.children, text)}</${tag}>`;
		}).join("");
		const md = (text) => show(ls.parseInline(text), text);

		assert.strictEqual(md("**bold** and *it*"), "<b>bold</b> and <i>it</i>");
		assert.strictEqual(md("2 * 3 * 4"), "2 * 3 * 4", "a star with space on both sides is a star");
		assert.strictEqual(md("a*b*c"), "a<i>b</i>c", "intraword, as in CommonMark");
		assert.strictEqual(md("**the bound $x$ holds**"), "<b>the bound [$x$] holds</b>", "emphasis wraps an equation");
		assert.strictEqual(md("$a*b*c$ and $x^**$"), "[$a*b*c$] and [$x^**$]", "stars in math are math");
		assert.strictEqual(md("*a **b** c*"), "<i>a <b>b</b> c</i>");
		assert.strictEqual(md("***both***"), "<i><b>both</b></i>");
		assert.strictEqual(md("**x*"), "*<i>x</i>", "spare stars stay as typed");
		assert.strictEqual(md("\\*not\\* *yes*"), "*not* <i>yes</i>", "an escaped star is literal");
		assert.strictEqual(md("*open\n\nclosed*"), "*open\n\nclosed*", "a blank line ends emphasis");
		assert.strictEqual(md("*two\nlines*"), "<i>two\nlines</i>", "a single line break does not");
		assert.strictEqual(md("**unclosed"), "**unclosed");
		assert.strictEqual(md("$5 and $10 * 2"), "$5 and $10 * 2");
	}

	{
		const katexCalls = [];
		const countingKatex = { render: (tex, element) => { katexCalls.push(tex); element.textContent = `«${tex}»`; } };
		const { inner } = pdfView(
			`<textarea class="textAnnotation" data-id="A" style="left: 10px">see $x$ and $y$</textarea>` +
			`<textarea class="textAnnotation" data-id="B">no math, $5 and $10</textarea>`);
		const [a, b] = inner.querySelectorAll("textarea");
		const stop = ls.installTextAnnotationRendering(inner, countingKatex);
		const mirrors = () => Array.from(inner.querySelectorAll(".latex-suite-text-layer > *"));

		assert.strictEqual(mirrors().length, 1, "only the annotation with an equation gets a mirror");
		const [mirror] = mirrors();
		assert.strictEqual(mirror.textContent, "see «x» and «y»");
		assert.strictEqual(mirror.parentNode.parentNode, inner.querySelector(".page"), "beside the reader's layer, not in it");
		assert.ok(mirror.getAttribute("style").endsWith("left: 10px"), "placed by the textarea's own style");
		assert.ok(a.classList.contains("latex-suite-text-hidden"), "the source underneath is hidden");
		assert.strictEqual(a.value, "see $x$ and $y$", "the textarea itself is never touched");
		assert.strictEqual(b.classList.contains("latex-suite-text-hidden"), false);

		a.focus();
		assert.strictEqual(mirrors().length, 0, "editing shows the source");
		assert.strictEqual(a.classList.contains("latex-suite-text-hidden"), false);
		a.blur();
		assert.strictEqual(mirrors()[0]?.textContent, "see «x» and «y»", "leaving renders again");

		// The reader moves a box by rewriting its style; the mirror follows.
		a.setAttribute("style", "left: 20px");
		await tick();
		assert.ok(mirrors()[0].getAttribute("style").endsWith("left: 20px"));
		const calls = katexCalls.length;
		a.setAttribute("style", "left: 30px");
		await tick();
		assert.strictEqual(katexCalls.length, calls, "moving a box does not re-render it");

		// An edit from elsewhere (the sidebar) arrives as a new value and data-comment.
		a.value = "now $z$";
		a.setAttribute("data-comment", "now $z$");
		await tick();
		assert.strictEqual(mirrors()[0].textContent, "now «z»");

		a.value = "a **bold** word";
		a.setAttribute("data-comment", "a **bold** word");
		await tick();
		assert.strictEqual(mirrors()[0].innerHTML, "a <b>bold</b> word", "emphasis alone is enough to render");

		a.remove();
		await tick();
		assert.strictEqual(mirrors().length, 0, "a deleted annotation takes its mirror with it");

		inner.querySelector(".customAnnotationLayer").insertAdjacentHTML("beforeend",
			`<textarea class="textAnnotation" data-id="C">new $w$</textarea>`);
		await tick();
		assert.strictEqual(mirrors()[0]?.textContent, "new «w»", "a new annotation is picked up");

		stop();
		assert.strictEqual(inner.querySelectorAll(".latex-suite-text-layer").length, 0, "uninstall removes the mirrors");
		assert.strictEqual(inner.querySelectorAll(".latex-suite-text-hidden").length, 0, "and shows the source again");
		assert.strictEqual(inner.getElementById("latex-suite-text-annotations"), null, "and its stylesheet");
	}

	{
		const { win, dom } = pdfView("");
		const seen = [];
		const stop = ls.trackViewDocuments(win, (doc) => {
			seen.push(doc);
			return () => seen.splice(seen.indexOf(doc), 1);
		});
		assert.strictEqual(seen.length, 1, "a view already open is attached");

		const second = dom.window.document.createElement("iframe");
		dom.window.document.body.append(second); // split view
		await new Promise((resolve) => setTimeout(resolve, 20));
		assert.strictEqual(seen.length, 2, "a view opened later is attached when it loads");
		assert.ok(seen.includes(second.contentDocument));

		stop();
		assert.strictEqual(seen.length, 0, "uninstall detaches every view");
	}

	/* --- the popup steps aside while a text box is typed into --- */
	{
		const { win, inner } = pdfView(`<textarea class="textAnnotation" data-id="A">abc</textarea>`);
		const root = win.document.documentElement;
		const stop = ls.installTextPopupHiding(win);
		const textarea = inner.querySelector("textarea");
		const editing = () => root.hasAttribute("data-latex-suite-text-editing");

		assert.strictEqual(editing(), false);
		textarea.focus();
		assert.strictEqual(editing(), true, "hidden while editing");
		textarea.blur();
		assert.strictEqual(editing(), false, "back once the box loses focus");

		textarea.focus();
		stop();
		assert.strictEqual(editing(), false, "uninstall never leaves it hidden");
		assert.strictEqual(win.document.getElementById("latex-suite-text-popup"), null);
	}

	console.log("dom-layer tests passed");
}
