import "./polyfill.js"; // do this before pdfjs
import { createRequire } from "node:module";
import path from "node:path";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import type { DocumentInitParameters, PDFDocumentProxy, PDFPageProxy, TextItem } from "pdfjs-dist/types/src/display/api.js";
import { NodeCanvasFactory } from "./canvasFactory.js";
import { parseInput } from "./parseInput.js";

const pdfjsPath = path.dirname(
  createRequire(import.meta.url).resolve("pdfjs-dist/package.json")
);

/** required since k-yle/pdf-to-img#58, the objects from pdfjs are weirdly structured */
const sanitize = (x: object) => {
  const object: Record<string, string> = JSON.parse(JSON.stringify(x));

  // remove UTF16 BOM and weird 0x0 character introduced in k-yle/pdf-to-img#138 and k-yle/pdf-to-img#184
  for (const key in object) {
    if (typeof object[key] === "string") {
      // eslint-disable-next-line no-control-regex -- this is deliberate
      object[key] = object[key].replaceAll(/(^þÿ|\u0000)/g, "");
    }
  }
  return object;
};

export type PdfMetadata = {
  Title?: string;
  Author?: string;
  // TODO: Subject?
  Producer?: string;
  Creator?: string;
  CreationDate?: string;
  ModDate?: string;
};

export type Options = {
  /** For cases where the PDF is encrypted with a password */
  password?: string;
  /** defaults to `1`. If you want high-resolution images, increase this */
  scale?: number;
  /** document init parameters which are passed to pdfjs.getDocument */
  docInitParams?: Partial<DocumentInitParameters>;
  /** how many chars to show for the search result around, default value is 20  */
  searchViewLength?: number;
};

/**
 * Converts a PDF to a series of images. This returns a `Symbol.asyncIterator`
 *
 * @param input Either (a) the path to a pdf file, or (b) a data url, or (b) a buffer, (c) a buffer, or (e) a ReadableStream.
 *
 * @example
 * ```js
 * import pdf from "pdf-to-img";
 *
 * for await (const page of await pdf("example.pdf")) {
 *   expect(page).toMatchImageSnapshot();
 * }
 *
 * // or if you want access to more details:
 *
 * const doc = await pdf("example.pdf");
 * expect(doc.length).toBe(1);
 * expect(doc.metadata).toEqual({ ... });
 *
 * for await (const page of doc) {
 *   expect(page).toMatchImageSnapshot();
 * }
 * ```
 */
export async function pdf(
  input: string | Uint8Array | Buffer | NodeJS.ReadableStream,
  options: Options = {}
): Promise<{
  doc: PDFDocumentProxy
  length: number;
  metadata: PdfMetadata;
  getPage(pageNumber: number): Promise<Buffer>;
  search(searchText:string): Promise<Array<{pageNum:number, lines: Array<string>}>>,
  searchInPage(searchText:string, page: PDFPageProxy): Promise<Array<string>>
  [Symbol.asyncIterator](): AsyncIterator<Buffer, void, void>;
}> {
  const data = await parseInput(input);

  const canvasFactory = new NodeCanvasFactory();
  const pdfDocument = await pdfjs.getDocument({
    password: options.password, // retain for backward compatibility, but ensure settings from docInitParams overrides this and others, if given.
    standardFontDataUrl: path.join(pdfjsPath, `standard_fonts${path.sep}`),
    cMapUrl: path.join(pdfjsPath, `cmaps${path.sep}`),
    cMapPacked: true,
    ...options.docInitParams,
    isEvalSupported: false,
    canvasFactory,
    data,
  }).promise;

  const metadata = await pdfDocument.getMetadata();
  const searchViewLength = options.searchViewLength || 20;

  async function getPage(pageNumber: number) {
    const page = await pdfDocument.getPage(pageNumber);

    const viewport = page.getViewport({ scale: options.scale ?? 1 });

    const { canvas, context } = canvasFactory.create(
      viewport.width,
      viewport.height
    );

    await page.render({
      canvasContext: context,
      viewport,
    }).promise;

    return canvas.toBuffer();
  }

  async function searchInPage(searchText:string, page: PDFPageProxy) {
    const content = await page.getTextContent({includeMarkedContent: false});
    const text = content.items.map(item => (item as TextItem).str).join('');
    const re = new RegExp(`(.{0,${searchViewLength}})` + searchText + `(.{0,${searchViewLength}})`, "gi");
    let m;
    const lines = [];
    while(m = re.exec(text)) {
        const line = (m[1] ? "..." : "") + m[0] + (m[2] ? "..." : "");
        lines.push(line);
    }
    return lines;
  }

  async function search(searchText:string) {
    const numOfPages = pdfDocument.numPages;
    const result = [];
    for(let i=0;i<numOfPages;i++) {
      const page = await pdfDocument.getPage(i);
      const lines = await searchInPage(searchText, page);
      result.push({ pageNum: i, lines });
    }
    return result;
  }

  return {
    doc: pdfDocument,
    search,
    searchInPage,
    length: pdfDocument.numPages,
    metadata: sanitize(metadata.info),
    getPage,
    [Symbol.asyncIterator]() {
      return {
        pg: 0,
        async next(this: { pg: number }) {
          if (this.pg < pdfDocument.numPages) {
            this.pg += 1;

            return { done: false, value: await getPage(this.pg) };
          }
          return { done: true, value: undefined };
        },
      };
    },
  };
}
