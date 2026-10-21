/** Minimal surface of the already locked sax 1.4.1 streaming parser. */
declare module 'sax' {
  export type SaxNode = { name: string; local: string; uri: string; attributes: Record<string, { value: string; local: string; uri: string }> };
  export type SaxParser = {
    onopentag?: (node: SaxNode) => void;
    onclosetag?: (name: string) => void;
    ontext?: (text: string) => void;
    oncdata?: (text: string) => void;
    ondoctype?: (text: string) => void;
    onprocessinginstruction?: (instruction: { name: string; body: string }) => void;
    onerror?: (error: Error) => void;
    write(text: string): SaxParser;
    close(): SaxParser;
  };
  export function parser(strict: boolean, options: { xmlns: true }): SaxParser;
}
