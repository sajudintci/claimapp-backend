export type FieldLabelKind =
  | "patient_name"
  | "monetary"
  | "date"
  | "id_number"
  | "text";

/** Full-line printed labels with no value on the same line. */
export const LABEL_ONLY_LINE_PATTERNS: RegExp[] = [
  /^(?:patient\s*name|nama\s*pasien|nama\s*tertanggung|insured\s*name)$/i,
  /^(?:nama|name|patient|pasien)$/i,
  /^(?:nominal|jumlah(?:\s+tagihan)?|total(?:\s+bayar)?|grand\s+total|sub\s*total|amount\s+due|total\s+due|biaya|tagihan)$/i,
  /^(?:tanggal\s+lahir|tgl\.?\s*lahir|date\s+of\s+birth|dob)$/i,
  /^(?:tanggal\s+masuk|tgl\.?\s*masuk|admission(?:\s+date)?|tgl\s+rawat\s+in)$/i,
  /^(?:tanggal\s+keluar|tgl\.?\s*keluar|tgl\.?\s*pulang|discharge(?:\s+date)?)$/i,
  /^(?:no\.?\s*polis|policy(?:\s+number)?|polis)$/i,
  /^(?:no\.?\s*klaim|claim(?:\s+number)?|klaim(?:\s+no)?)$/i,
  /^(?:diagnosis|icd(?:\s*10)?|icd10)$/i,
  /^(?:provider|dokter|doctor|rumah\s+sakit|hospital)$/i,
  /^(?:qty|quantity|jumlah\s+qty)$/i,
  /^(?:n[o0a]\.?\s*pegawai|no\.?\s*pegawai|nama\s*pegawai)$/iu,
  /^(?:no\.?\s*\p{L}+|nama\s*\p{L}+)$/iu,
  /^(?:bagian|perusahaan|department|penjamin|kelas|hub\.?\s*keluarga)$/i,
];

/** Second words common on Indonesian hospital form labels (not person names). */
const FORM_LABEL_TAIL_WORDS = new Set([
  "pegawai",
  "keluarga",
  "bagian",
  "perusahaan",
  "penjamin",
  "pasien",
  "registrasi",
  "klaim",
  "polis",
  "lahir",
  "masuk",
  "keluar",
  "pulang",
]);

/**
 * "No Pegawai", OCR-garbled "Na Pegawai", "Nama Pegawai", "Hub Keluarga", etc.
 */
function looksLikeCompoundFormLabel(text: string): boolean {
  const t = text.replace(/:\s*$/, "").trim();
  if (!t) return false;
  const words = t.split(/\s+/).filter(Boolean);
  if (words.length < 2) return false;
  const last = words[words.length - 1]!.toLowerCase();
  if (!FORM_LABEL_TAIL_WORDS.has(last)) return false;
  const first = words[0]!.toLowerCase().replace(/\./g, "");
  if (/^(?:nama|no|na|n[o0a]|hub|tanggal|tgl|nomor|penjamin|kelas)$/i.test(first)) {
    return true;
  }
  return first.length <= 3 && /^n[o0a]?$/i.test(first);
}

const FORBIDDEN_TOKENS: Record<FieldLabelKind, ReadonlySet<string>> = {
  patient_name: new Set([
    "nama",
    "name",
    "patient",
    "pasien",
    "tertanggung",
    "insured",
  ]),
  monetary: new Set([
    "nominal",
    "jumlah",
    "total",
    "biaya",
    "tagihan",
    "bayar",
    "amount",
    "rp",
    "idr",
    "subtotal",
    "grand",
    "due",
  ]),
  date: new Set([
    "tanggal",
    "tgl",
    "date",
    "lahir",
    "masuk",
    "keluar",
    "pulang",
    "dob",
    "admission",
    "discharge",
    "birth",
  ]),
  id_number: new Set([
    "no",
    "nomor",
    "number",
    "policy",
    "polis",
    "claim",
    "klaim",
    "id",
  ]),
  text: new Set(["no", "nomor", "no."]),
};

export function claimPathToLabelKind(path: string): FieldLabelKind {
  if (path === "patient.name") return "patient_name";
  if (
    path === "patient.dob" ||
    path === "encounter.admission_date" ||
    path === "encounter.discharge_date"
  ) {
    return "date";
  }
  if (
    path.includes("amount") ||
    path === "billing.tax_amount" ||
    path === "billing.currency"
  ) {
    return "monetary";
  }
  if (path === "patient.patient_id") return "id_number";
  if (path.startsWith("diagnosis.")) return "text";
  return "text";
}

export function preExtractKeyToLabelKind(key: string): FieldLabelKind {
  switch (key) {
    case "patientName":
      return "patient_name";
    case "dob":
    case "admissionDate":
    case "dischargeDate":
      return "date";
    case "totalAmount":
      return "monetary";
    case "policyNumber":
    case "claimNumber":
      return "id_number";
    default:
      return "text";
  }
}

export function labelKindFromPairLabel(label: string): FieldLabelKind | null {
  const normalized = label.trim();
  if (
    /^(nama|name|patient|pasien|nama\s*pasien|nama\s*tertanggung)$/i.test(normalized)
  ) {
    return "patient_name";
  }
  if (
    /^(nominal|jumlah|total|grand\s*total|total\s*bayar|jumlah\s*tagihan|amount\s*due|total\s*due)$/i.test(
      normalized,
    )
  ) {
    return "monetary";
  }
  if (/^(dob|tanggal\s*lahir|tgl\.?\s*lahir|date\s*of\s*birth)$/i.test(normalized)) {
    return "date";
  }
  if (
    /^(admission|tgl\.?\s*masuk|tanggal\s*masuk|tgl\s*rawat\s*in)$/i.test(normalized)
  ) {
    return "date";
  }
  if (
    /^(discharge|tgl\.?\s*keluar|tanggal\s*keluar|tgl\s*pulang)$/i.test(normalized)
  ) {
    return "date";
  }
  if (/^(policy|polis|no\.?\s*polis|claim|klaim|no\.?\s*klaim)$/i.test(normalized)) {
    return "id_number";
  }
  return null;
}

function isLabelOnlyLine(text: string): boolean {
  const trimmed = text.trim();
  return LABEL_ONLY_LINE_PATTERNS.some((re) => re.test(trimmed));
}

function labelPartFromSource(sourceText: string): string {
  return sourceText.replace(/\s*:\s*[\s\S]*$/, "").trim();
}

/** True when text looks like a printed form field label (not a real value). */
export function looksLikeFieldLabel(text: string): boolean {
  const t = text.replace(/:\s*$/, "").trim();
  if (!t) return false;
  if (isLabelOnlyLine(t)) return true;
  if (looksLikeCompoundFormLabel(t)) return true;
  if (
    /^(?:n[o0a]\.?\s+|no\.?\s+|nama\s+|tanggal\s+|tgl\.?\s+|nominal|jumlah|total|patient|pasien|policy|polis|claim|klaim|bagian|perusahaan|department|penjamin|kelas|hub\.?\s*)\b/iu.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function isCrossColumnLabelValue(label: string, value: string): boolean {
  const v = value.replace(/:\s*$/, "").trim();
  if (!v) return false;
  return looksLikeFieldLabel(v) && slugKey(label) !== slugKey(v);
}

function slugKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

/**
 * True when `value` is a printed label token, not a real extracted field value.
 */
export function isInvalidExtractedValue(
  value: string | number,
  sourceText?: string,
  kind: FieldLabelKind = "text",
): boolean {
  const v = String(value).trim();
  if (!v || v === "not_found") return false;

  const lower = v.toLowerCase();
  const forbidden = FORBIDDEN_TOKENS[kind];
  if (forbidden.has(lower)) return true;
  if (looksLikeFieldLabel(v)) return true;

  const src = String(sourceText ?? "").trim();
  if (!src) return false;

  const labelPart = labelPartFromSource(src);
  const labelIsOnly = isLabelOnlyLine(labelPart) || isLabelOnlyLine(src);

  if (labelIsOnly) {
    const valueWords = lower.split(/\s+/);
    const labelWords = labelPart.toLowerCase().split(/\s+/);
    if (valueWords.length === 1 && labelWords.includes(valueWords[0]!)) {
      return true;
    }
    if (lower === labelPart.toLowerCase() || lower === src.toLowerCase()) {
      return true;
    }
  }

  const colonMatch = src.match(/^(.+?)\s*:\s*(.+)$/s);
  if (colonMatch) {
    const afterColon = colonMatch[2].trim().toLowerCase();
    if (afterColon === lower && forbidden.has(lower)) return true;
  }

  if (kind === "monetary" && !/\d/.test(v)) return true;

  return false;
}

/** @deprecated Use isInvalidExtractedValue with kind "patient_name". */
export function isInvalidPatientNameValue(
  value: string | number,
  sourceText?: string,
): boolean {
  return isInvalidExtractedValue(value, sourceText, "patient_name");
}
