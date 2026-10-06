import { csvCell, toCsv } from './csv';

describe('export CSV', () => {
  it('valeurs simples, nombres, booléens, dates, vides', () => {
    expect(csvCell('Alix')).toBe('Alix');
    expect(csvCell(25.5)).toBe('25.5');
    expect(csvCell(true)).toBe('oui');
    expect(csvCell(new Date('2026-10-06T20:00:00Z'))).toBe('2026-10-06T20:00:00.000Z');
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('échappement RFC 4180 : séparateur, guillemets, retours ligne, espaces de bord', () => {
    expect(csvCell('Durand; Alix')).toBe('"Durand; Alix"');
    expect(csvCell('Le "Grand" Rex')).toBe('"Le ""Grand"" Rex"');
    expect(csvCell('ligne1\nligne2')).toBe('"ligne1\nligne2"');
    expect(csvCell(' espace')).toBe('" espace"');
  });

  it('injection de formules neutralisée', () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell('+33 6')).toBe("'+33 6");
    expect(csvCell('-1')).toBe("'-1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    // Un nombre négatif réel n'est pas une saisie utilisateur : conservé.
    expect(csvCell(-1)).toBe('-1');
  });

  it('document : BOM, en-têtes, CRLF, séparateur « ; »', () => {
    const csv = toCsv(['nom', 'prix'], [
      ['Alix', 20],
      ['Bao', 25.5],
    ]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1).split('\r\n')).toEqual(['nom;prix', 'Alix;20', 'Bao;25.5', '']);
  });
});
