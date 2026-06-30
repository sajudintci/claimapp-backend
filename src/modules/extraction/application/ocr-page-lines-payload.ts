import type { AbbyyBox, OcrPagePayload } from "@/modules/extraction/application/ocr-preprocess";

export type OcrPageLineEntry = {
  text: string;
  region?: AbbyyBox;
  id?: string;
};

/** Serializable per-page OCR layout for PDF highlight (matches frontend `parseOcrPagesFromPayload`). */
export type OcrPageLinesPayloadEntry = {
  page: number;
  width?: number;
  height?: number;
  lines: OcrPageLineEntry[];
};

/**
 * Build `ocrPageLines` for extraction payload from ABBYY-preprocessed pages.
 * Uses one entry per OCR block with aligned text + region for `ocr_coords` highlights.
 */
export function buildOcrPageLinesPayload(
  pages: OcrPagePayload[],
): OcrPageLinesPayloadEntry[] {
  const result: OcrPageLinesPayloadEntry[] = [];

  for (const page of pages) {
    const lines: OcrPageLineEntry[] = [];
    for (const block of page.blocks) {
      const text = block.text.replace(/\s+/g, " ").trim();
      if (text.length < 2) continue;
      lines.push({
        text,
        ...(block.region ? { region: block.region } : {}),
        ...(block.id ? { id: block.id } : {}),
      });
    }
    if (lines.length === 0) continue;

    result.push({
      page: page.page,
      ...(page.width != null && page.width > 0 ? { width: page.width } : {}),
      ...(page.height != null && page.height > 0 ? { height: page.height } : {}),
      lines,
    });
  }

  return result;
}
