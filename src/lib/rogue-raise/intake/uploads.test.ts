import { describe, expect, it } from "vitest";

import {
  ALLOWED_EXTENSIONS,
  buildAttachmentKey,
  extensionOf,
  MAX_ATTACHMENTS_PER_EVENT,
  MAX_UPLOAD_BYTES,
  safeDisplayFilename,
  scanUpload,
  UPLOAD_ACCEPT_ATTRIBUTE,
  validateUpload,
} from "./uploads";

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]);
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
const ELF_BYTES = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
const TEXT_BYTES = new TextEncoder().encode("shelter,beds\nAshland,42\n");

function check(overrides: Partial<Parameters<typeof validateUpload>[0]> = {}) {
  return validateUpload({
    filename: "context.pdf",
    declaredContentType: "application/pdf",
    size: PDF_BYTES.length,
    bytes: PDF_BYTES,
    existingCount: 0,
    ...overrides,
  });
}

describe("extensionOf / safeDisplayFilename", () => {
  it("lowercases the extension", () => {
    expect(extensionOf("Report.PDF")).toBe("pdf");
    expect(extensionOf("no-extension")).toBe("");
  });

  it("drops path components a browser may include", () => {
    expect(safeDisplayFilename("C:\\Users\\ada\\notes.txt")).toBe("notes.txt");
    expect(safeDisplayFilename("/tmp/notes.txt")).toBe("notes.txt");
  });

  it("strips control characters that would forge a download header", () => {
    expect(safeDisplayFilename("no\u000dtes\u0000.txt")).toBe("notes.txt");
  });

  it("never returns an empty name", () => {
    expect(safeDisplayFilename("   ")).toBe("attachment");
  });
});

describe("validateUpload", () => {
  it("accepts a genuine PDF", () => {
    const result = check();
    expect(result.ok).toBe(true);
    expect(result.contentType).toBe("application/pdf");
    expect(result.extension).toBe("pdf");
  });

  it("accepts a CSV the browser labelled text/plain", () => {
    expect(
      check({
        filename: "beds.csv",
        declaredContentType: "text/plain",
        bytes: TEXT_BYTES,
        size: TEXT_BYTES.length,
      }).ok,
    ).toBe(true);
  });

  it("tolerates a generic application/octet-stream", () => {
    expect(check({ declaredContentType: "application/octet-stream" }).ok).toBe(true);
  });

  it("ignores charset parameters on the declared type", () => {
    expect(
      check({
        filename: "notes.md",
        declaredContentType: "text/markdown; charset=utf-8",
        bytes: TEXT_BYTES,
        size: TEXT_BYTES.length,
      }).ok,
    ).toBe(true);
  });

  it("rejects an extension we don't accept", () => {
    const result = check({ filename: "installer.exe", declaredContentType: "" });
    expect(result.reason).toBe("bad_extension");
    expect(result.message).toContain("pdf");
  });

  it("rejects a declared type that contradicts the extension", () => {
    const result = check({ filename: "chart.png", declaredContentType: "application/pdf" });
    expect(result.reason).toBe("mime_mismatch");
  });

  it("rejects an executable renamed to .pdf — the whole point of sniffing", () => {
    const result = check({
      declaredContentType: "application/pdf",
      bytes: ELF_BYTES,
      size: ELF_BYTES.length,
    });
    expect(result.reason).toBe("content_mismatch");
    expect(result.message).toMatch(/doesn't look like a real \.pdf/);
  });

  it("rejects binary content masquerading as text", () => {
    const result = check({
      filename: "notes.txt",
      declaredContentType: "text/plain",
      bytes: PNG_BYTES,
      size: PNG_BYTES.length,
    });
    expect(result.reason).toBe("content_mismatch");
  });

  it("rejects an empty file", () => {
    expect(check({ bytes: new Uint8Array(), size: 0 }).reason).toBe("empty");
  });

  it("rejects an oversize file by declared size alone", () => {
    expect(check({ size: MAX_UPLOAD_BYTES + 1 }).reason).toBe("too_large");
  });

  it("refuses once the per-event ceiling is reached", () => {
    const result = check({ existingCount: MAX_ATTACHMENTS_PER_EVENT });
    expect(result.reason).toBe("too_many");
    expect(result.message).toContain(String(MAX_ATTACHMENTS_PER_EVENT));
  });
});

describe("buildAttachmentKey", () => {
  it("namespaces by event and never includes the user's filename", () => {
    const key = buildAttachmentKey("11111111-2222-3333-4444-555555555555", "pdf");
    expect(key).toMatch(
      /^intake\/11111111-2222-3333-4444-555555555555\/[0-9a-f-]{36}\.pdf$/,
    );
  });

  it("is unique per call", () => {
    const a = buildAttachmentKey("e", "pdf");
    const b = buildAttachmentKey("e", "pdf");
    expect(a).not.toBe(b);
  });
});

describe("accept attribute", () => {
  it("lists every allowed extension with a leading dot", () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      expect(UPLOAD_ACCEPT_ATTRIBUTE).toContain(`.${ext}`);
    }
  });
});

describe("scanUpload", () => {
  it("is a seam that currently reports clean — no scanner is wired", async () => {
    expect(await scanUpload(ELF_BYTES)).toEqual({ clean: true });
  });
});
