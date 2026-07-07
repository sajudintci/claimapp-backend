export type FieldValueOrigin = "ocr" | "llm_synthesis";

export type FieldTrace = {
  source_text: string;
  page: number | null;
  /** ABBYY layout box when resolved from structured OCR blocks. */
  region?: { l: number; t: number; r: number; b: number };
};

export type TracedField = {
  value: string | number;
  source_text: string;
  page: number | null;
  confidence: number;
  /** Additional OCR snippets when a value is supported by multiple pages. */
  traces?: FieldTrace[];
  /** Set only for LLM-synthesized Diagnosis / Medical summary fields. */
  value_origin?: FieldValueOrigin;
  /** Structured paths used when value_origin is llm_synthesis. */
  derived_from?: string[];
};

export type ExtractionLineItem = {
  description: string;
  quantity: string;
  amount: string;
  related_doctor: string;
  source_text: string;
  page: number | null;
  confidence: number;
  traces?: FieldTrace[];
  field_traces?: Partial<Record<"description" | "quantity" | "amount" | "related_doctor", FieldTrace[]>>;
  field_origins?: Partial<
    Record<"description" | "quantity" | "amount" | "related_doctor", FieldValueOrigin>
  >;
};

export type ExtractionTestResult = {
  test_category: string;
  test_name: string;
  result: string;
  unit: string;
  reference_range: string;
  source_text: string;
  page: number | null;
  confidence: number;
  traces?: FieldTrace[];
  field_traces?: Partial<
    Record<"test_category" | "test_name" | "result" | "unit" | "reference_range", FieldTrace[]>
  >;
  field_origins?: Partial<
    Record<
      "test_category" | "test_name" | "result" | "unit" | "reference_range",
      FieldValueOrigin
    >
  >;
};

export type ExtractionClaim = {
  provider: {
    hospital_name: TracedField;
    address: TracedField;
    city: TracedField;
    phone: TracedField;
    email: TracedField;
  };
  billing: {
    currency: TracedField;
    tax_amount: TracedField;
    total_amount_read: TracedField;
    total_amount_calculated: TracedField;
    payment_status: TracedField;
  };
  patient: {
    patient_id: TracedField;
    name: TracedField;
    dob: TracedField;
  };
  encounter: {
    encounter_type: TracedField;
    admission_date: TracedField;
    discharge_date: TracedField;
  };
  medical_summary: TracedField;
  diagnosis: {
    icd10_code: TracedField;
    icd10_description: TracedField;
  };
  items: ExtractionLineItem[];
  tests: ExtractionTestResult[];
};

export type LlmExtractionResult = {
  claims: ExtractionClaim[];
  confidence: number;
};

export type ExtractionSummary = {
  insuredName: string | null;
  amount: number | null;
  diagnosis: string | null;
  provider: string | null;
};
