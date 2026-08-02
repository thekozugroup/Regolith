import { describe, expect, test } from "bun:test";
import { isValidDevelopmentPrinterHost } from "../src/lib/printerHost";

describe("development printer host validation", () => {
  test("accepts local hostnames and valid IPv4 addresses", () => {
    expect(isValidDevelopmentPrinterHost("forge.local")).toBe(true);
    expect(isValidDevelopmentPrinterHost("k1-max")).toBe(true);
    expect(isValidDevelopmentPrinterHost("192.168.50.179")).toBe(true);
  });

  test("rejects URLs, ports, shell syntax, and invalid addresses", () => {
    expect(isValidDevelopmentPrinterHost("http://forge.local")).toBe(false);
    expect(isValidDevelopmentPrinterHost("forge.local:80")).toBe(false);
    expect(isValidDevelopmentPrinterHost("forge.local;touch-x")).toBe(false);
    expect(isValidDevelopmentPrinterHost("999.168.50.179")).toBe(false);
    expect(isValidDevelopmentPrinterHost("-forge.local")).toBe(false);
  });
});
