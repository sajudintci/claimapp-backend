export type TracedField = {
  value: string | number;
  source_text: string;
  page: number | null;
  confidence: number;
};

export type ExtractionLineItem = {
  description: string;
  quantity: string;
  amount: string;
  related_doctor: string;
  source_text: string;
  page: number | null;
  confidence: number;
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
