// Sérialisation CSV pour les exports (Excel FR) :
//   - séparateur « ; » (la virgule est le séparateur décimal en français) ;
//   - BOM UTF-8 pour qu'Excel détecte l'encodage ;
//   - échappement RFC 4180 (guillemets doublés, champ entre guillemets si besoin) ;
//   - CRLF entre les lignes ;
//   - injection de formules neutralisée : une cellule commençant par = + - @
//     (ou tabulation / retour chariot) est préfixée d'une apostrophe, sinon un
//     nom saisi par un acheteur (« =HYPERLINK(...) ») serait exécuté par le tableur.

export type CsvValue = string | number | boolean | Date | null | undefined;

const SEPARATOR = ';';
const BOM = String.fromCharCode(0xfeff);
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let text: string;
  if (value instanceof Date) text = value.toISOString();
  else if (typeof value === 'boolean') text = value ? 'oui' : 'non';
  else if (typeof value === 'number') return String(value);
  else text = value;

  if (FORMULA_START.test(text)) text = `'${text}`;
  return /[";\r\n]/.test(text) || text !== text.trim() ? `"${text.replace(/"/g, '""')}"` : text;
}

export function toCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(csvCell).join(SEPARATOR), ...rows.map((r) => r.map(csvCell).join(SEPARATOR))];
  return `${BOM}${lines.join('\r\n')}\r\n`;
}
