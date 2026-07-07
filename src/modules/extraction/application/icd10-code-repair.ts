import type { TracedField } from "@/modules/extraction/domain/extraction-schema";

const ICD10_CODE_VALUE_RE = /^[A-Z]\d{2}(?:\.\d{1,4})?$/;

const ICD10_LABELED_RE =
  /(?:icd[\s-]*(?:10|x)?|diagnos(?:is|a)?|kode\s+(?:icd|diagnosis))\s*[:\-]?\s*([A-Za-z]\d{2}(?:[.,]\d{1,4})?)/gi;

const ICD10_INLINE_RE = /\b([A-Za-z]\d{2}(?:[.,]\d{1,4})?)\b/g;

const ICD10_CONTEXT_LINE_RE = /(?:icd|diagnos)/i;

export function normalizeIcd10Code(raw: string): string {
  return raw.trim().toUpperCase().replace(",", ".");
}

export function isPlausibleIcd10Code(value: string): boolean {
  return ICD10_CODE_VALUE_RE.test(normalizeIcd10Code(value));
}

export function extractLeadingIcd10Code(text: string): string | null {
  const match = text.trim().match(/^([A-Za-z]\d{2}(?:[.,]\d{1,4})?)\b/);
  if (!match) return null;
  const code = normalizeIcd10Code(match[1]!);
  return isPlausibleIcd10Code(code) ? code : null;
}

type Icd10OcrMatch = {
  code: string;
  source_text: string;
};

function pushMatch(matches: Icd10OcrMatch[], seen: Set<string>, code: string, source_text: string): void {
  const normalized = normalizeIcd10Code(code);
  if (!isPlausibleIcd10Code(normalized)) return;
  if (seen.has(normalized)) return;
  seen.add(normalized);
  matches.push({ code: normalized, source_text: source_text.trim() });
}

/** Finds ICD-10 codes explicitly present in OCR plain text (labeled lines first). */
export function discoverIcd10CodesInOcr(plainText: string): Icd10OcrMatch[] {
  const matches: Icd10OcrMatch[] = [];
  const seen = new Set<string>();

  for (const match of plainText.matchAll(ICD10_LABELED_RE)) {
    pushMatch(matches, seen, match[1]!, match[0]);
  }

  for (const line of plainText.split(/\r?\n/)) {
    if (!ICD10_CONTEXT_LINE_RE.test(line)) continue;
    for (const match of line.matchAll(ICD10_INLINE_RE)) {
      pushMatch(matches, seen, match[1]!, match[0]);
    }
  }

  return matches;
}

export function repairIcd10CodeField(
  field: TracedField,
  options: {
    plainText: string;
    descriptionField?: TracedField;
  },
): TracedField {
  if (field.value !== "not_found") return field;

  const discovered = discoverIcd10CodesInOcr(options.plainText);
  if (discovered.length > 0) {
    const best = discovered[0]!;
    return {
      value: best.code,
      source_text: best.source_text,
      page: null,
      confidence: 0.85,
      value_origin: "ocr",
    };
  }

  const descriptionValue = String(options.descriptionField?.value ?? "").trim();
  if (descriptionValue && descriptionValue !== "not_found") {
    const fromDescription = extractLeadingIcd10Code(descriptionValue);
    if (fromDescription && options.plainText.toUpperCase().includes(fromDescription)) {
      const source =
        options.descriptionField?.source_text.trim() ||
        descriptionValue.slice(0, Math.min(descriptionValue.length, 120));
      return {
        value: fromDescription,
        source_text: source,
        page: options.descriptionField?.page ?? null,
        confidence: 0.8,
        value_origin: "ocr",
      };
    }
  }

  return field;
}
