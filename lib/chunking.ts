export type Chunk = {
  content: string;
  page: number;
  index: number;
};

// De mayor a menor: párrafo, línea, oración, palabra
const SEPARATORS = ['\n\n', '\n', '. ', ' '];

function normalize(text: string) {
  return text
    .replace(/\r/g, '')
    .replace(/(\w)-\n(\w)/g, '$1$2') // une palabras cortadas con guion al final de línea
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Divide recursivamente: intenta cortar por el separador más "natural";
 * si un trozo sigue siendo muy grande, baja al siguiente separador.
 */
function splitRecursive(text: string, size: number, seps = SEPARATORS): string[] {
  if (text.length <= size) return [text];

  const [sep, ...rest] = seps;
  if (sep === undefined) {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
    return out;
  }

  const out: string[] = [];
  let current = '';
  for (const part of text.split(sep)) {
    const candidate = current ? current + sep + part : part;
    if (candidate.length <= size) {
      current = candidate;
      continue;
    }
    if (current) out.push(current);
    if (part.length > size) {
      out.push(...splitRecursive(part, size, rest));
      current = '';
    } else {
      current = part;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * Convierte las páginas del PDF en fragmentos de ~`size` caracteres
 * con `overlap` caracteres de solapamiento para no perder contexto en los bordes.
 */
export function chunkPages(
  pages: string[],
  { size = 1000, overlap = 150, minLength = 40 } = {},
): Chunk[] {
  const result: Omit<Chunk, 'index'>[] = [];

  pages.forEach((raw, i) => {
    const text = normalize(raw);
    if (!text) return;

    const pieces = splitRecursive(text, size - overlap);
    pieces.forEach((piece, j) => {
      const prevTail = j > 0 ? pieces[j - 1].slice(-overlap) : '';
      const content = (prevTail ? prevTail + ' ' : '') + piece;
      if (content.trim().length >= minLength) {
        result.push({ content: content.trim(), page: i + 1 });
      }
    });
  });

  return result.map((c, index) => ({ ...c, index }));
}
