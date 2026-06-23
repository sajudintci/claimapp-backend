import { describe, expect, it } from "vitest";
import {
  isInvalidExtractedValue,
  isInvalidPatientNameValue,
  isCrossColumnLabelValue,
  looksLikeFieldLabel,
} from "./field-label-guard";

describe("isInvalidExtractedValue — patient_name", () => {
  it("rejects label tokens and suffix from Nama Pasien", () => {
    expect(isInvalidExtractedValue("Pasien", "Nama Pasien", "patient_name")).toBe(true);
    expect(isInvalidExtractedValue("Nama", "Nama Pasien", "patient_name")).toBe(true);
    expect(isInvalidPatientNameValue("Pasien", "Nama Pasien")).toBe(true);
  });

  it("accepts real names", () => {
    expect(
      isInvalidExtractedValue("Budi Santoso", "Nama Pasien: Budi Santoso", "patient_name"),
    ).toBe(false);
  });

  it("rejects adjacent column labels like No Pegawai as patient name", () => {
    expect(isInvalidExtractedValue("No Pegawai", "Nama Pasien : No Pegawai", "patient_name")).toBe(
      true,
    );
    expect(looksLikeFieldLabel("No Pegawai")).toBe(true);
    expect(isCrossColumnLabelValue("Nama Pasien", "No Pegawai")).toBe(true);
  });

  it("rejects OCR-garbled No Pegawai (Na Pegawai) as patient name", () => {
    expect(
      isInvalidExtractedValue("Na Pegawai", "Nama Pasien Na Pegawai", "patient_name"),
    ).toBe(true);
    expect(looksLikeFieldLabel("Na Pegawai")).toBe(true);
    expect(isCrossColumnLabelValue("Nama Pasien", "Na Pegawai")).toBe(true);
  });
});

describe("isInvalidExtractedValue — monetary", () => {
  it("rejects label-only tokens without digits", () => {
    expect(isInvalidExtractedValue("Nominal", "Nominal", "monetary")).toBe(true);
    expect(isInvalidExtractedValue("Jumlah", "Jumlah Tagihan", "monetary")).toBe(true);
    expect(isInvalidExtractedValue("Total", "Grand Total", "monetary")).toBe(true);
  });

  it("accepts amounts with digits", () => {
    expect(isInvalidExtractedValue("1.200.000", "Nominal : 1.200.000", "monetary")).toBe(
      false,
    );
  });
});

describe("isInvalidExtractedValue — date", () => {
  it("rejects date label words", () => {
    expect(isInvalidExtractedValue("Lahir", "Tanggal Lahir", "date")).toBe(true);
    expect(isInvalidExtractedValue("Masuk", "Tgl Masuk", "date")).toBe(true);
  });

  it("accepts real dates", () => {
    expect(isInvalidExtractedValue("01/01/1990", "Tanggal Lahir: 01/01/1990", "date")).toBe(
      false,
    );
  });
});

describe("isInvalidExtractedValue — id_number", () => {
  it("rejects id label tokens", () => {
    expect(isInvalidExtractedValue("Polis", "No Polis", "id_number")).toBe(true);
    expect(isInvalidExtractedValue("Klaim", "No Klaim", "id_number")).toBe(true);
  });

  it("accepts alphanumeric ids", () => {
    expect(isInvalidExtractedValue("POL-12345", "No Polis: POL-12345", "id_number")).toBe(
      false,
    );
  });
});
