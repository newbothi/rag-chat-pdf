import { extractText, getDocumentProxy } from 'unpdf';

/** Extrae el texto de un PDF página por página (para poder citar el número de página). */
export async function extractPdfPages(buffer: ArrayBuffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { totalPages, text } = await extractText(pdf, { mergePages: false });
  return { totalPages, pages: text };
}
