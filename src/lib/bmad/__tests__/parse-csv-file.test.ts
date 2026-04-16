import { describe, expect, it } from "vitest";
import { parseBmadFile } from "../parser";

describe("parseBmadFile csv", () => {
  it("parses comma-separated rows with a header", () => {
    const result = parseBmadFile("Name,Status\nAlpha,Done\nBeta,Ready", "csv");

    expect(result.contentType).toBe("csv");
    expect(result.csv).toEqual({
      rows: [
        ["Name", "Status"],
        ["Alpha", "Done"],
        ["Beta", "Ready"],
      ],
      totalRows: 3,
      columnCount: 2,
      truncated: false,
      parseErrors: [],
    });
    expect(result.parseError).toBeNull();
  });

  it("supports quoted commas, escaped quotes, and empty cells", () => {
    const result = parseBmadFile(
      'Company,Note,Owner\n"ACME, Inc","hello ""world""",\nBeta,,Jane',
      "csv",
    );

    expect(result.csv?.rows).toEqual([
      ["Company", "Note", "Owner"],
      ["ACME, Inc", 'hello "world"', ""],
      ["Beta", "", "Jane"],
    ]);
    expect(result.csv?.columnCount).toBe(3);
  });

  it("truncates rendered rows after 1000 rows while preserving total row count", () => {
    const content = Array.from({ length: 1005 }, (_, i) => `row-${i},value-${i}`).join("\n");
    const result = parseBmadFile(content, "csv");

    expect(result.csv?.rows).toHaveLength(1000);
    expect(result.csv?.totalRows).toBe(1005);
    expect(result.csv?.truncated).toBe(true);
  });
});
