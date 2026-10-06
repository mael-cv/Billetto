import { scanBatchSchema, scanSchema } from './checkin.controller';

const scan = {
  clientScanId: '8b0f6f8e-3f43-4b8a-9d6c-2f1f4b0a9e11',
  payload: 'BT1.x.y',
  evenementId: 3,
  scanneA: '2026-10-06T20:00:00.000Z',
};

describe('validation du check-in', () => {
  it('scan : identifiant client UUID, heure du téléphone convertie, champs inconnus refusés', () => {
    expect(scanSchema.parse(scan)).toMatchObject({ evenementId: 3, scanneA: new Date(scan.scanneA) });
    expect(scanSchema.safeParse({ ...scan, clientScanId: 'pas-un-uuid' }).success).toBe(false);
    expect(scanSchema.safeParse({ ...scan, payload: '   ' }).success).toBe(false);
    expect(scanSchema.safeParse({ ...scan, payload: 'x'.repeat(201) }).success).toBe(false);
    expect(scanSchema.safeParse({ ...scan, resultat: 'ok' }).success).toBe(false);
  });

  it('lot : 1 à 200 scans', () => {
    expect(scanBatchSchema.safeParse({ scans: [scan] }).success).toBe(true);
    expect(scanBatchSchema.safeParse({ scans: [] }).success).toBe(false);
    expect(scanBatchSchema.safeParse({ scans: Array.from({ length: 201 }, () => scan) }).success).toBe(false);
  });
});
