/** Fenced, indented and inline code spans that presentation filters must leave literal. */
export function codeRanges(value: string): Array<[number, number]> {
  const protectedRanges: Array<[number, number]> = [];
  let offset = 0, fence: { character: string; length: number; start: number } | undefined;
  for (const line of value.split(/(?<=\n)/u)) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
    if (delimiter) {
      if (!fence) fence = { character: delimiter[0], length: delimiter.length, start: offset };
      else if (delimiter[0] === fence.character && delimiter.length >= fence.length) { protectedRanges.push([fence.start, offset + line.length]); fence = undefined; }
    } else if (!fence) {
      if (/^(?: {4}|\t)/u.test(line)) protectedRanges.push([offset, offset + line.length]);
      else for (const match of line.matchAll(/(`+)[^\n]*?\1/gu)) protectedRanges.push([offset + match.index!, offset + match.index! + match[0].length]);
    }
    offset += line.length;
  }
  if (fence) protectedRanges.push([fence.start, value.length]);
  return protectedRanges;
}
