import { describe, expect, test } from "bun:test";
import { cpuDescription, hasHostInfo, hostChannelsNeedFallback, hostInfoFromProcStats, hostSampleInfo, hostSampleIsFresh, stableSystemInfo } from "../src/lib/useSystemInfo";

describe("Settings host telemetry", () => {
  test("uses honest freshness boundaries", () => {
    expect(hostSampleIsFresh(9_000, 10_000)).toBe(true);
    expect(hostSampleIsFresh(0, 15_000)).toBe(false);
    expect(hostSampleIsFresh(10_001, 10_000)).toBe(false);
    expect(hostSampleIsFresh(null, 10_000)).toBe(false);
  });

  test("converts proc_stats units without inventing missing values", () => {
    expect(hostInfoFromProcStats({
      system_memory: { total: 256_000, available: 96_000 },
      system_uptime: 3_600,
    })).toEqual({ memTotal: 256_000, memUsed: 160_000, uptime: 3_600 });
    expect(hostInfoFromProcStats({ system_memory: {}, system_uptime: "unknown" })).toEqual({
      memTotal: undefined,
      memUsed: undefined,
      uptime: undefined,
    });
    expect(hostInfoFromProcStats(null)).toEqual({});
  });

  test("rejects invalid memory pairs and invalid uptime as an unusable fresh sample", () => {
    for (const [total, available] of [
      [Number.NaN, 10], [-1, 0], [100, -1], [100, 101], [Infinity, 1],
    ]) {
      const result = hostInfoFromProcStats({ system_memory: { total, available }, system_uptime: 10 });
      expect(result.memTotal).toBeUndefined();
      expect(result.memUsed).toBeUndefined();
      expect(hasHostInfo(result)).toBe(true); // valid uptime remains independently useful
    }
    for (const uptime of [Number.NaN, Infinity, -0.1, "10"]) {
      const result = hostInfoFromProcStats({ system_uptime: uptime });
      expect(result.uptime).toBeUndefined();
      expect(hasHostInfo(result)).toBe(false);
    }
    expect(hostSampleInfo({ memTotalKb: 100, memAvailKb: 101, uptimeS: -1 })).toEqual({
      memTotal: undefined,
      memUsed: undefined,
      uptime: undefined,
    });
  });

  test("keeps both legacy and nested CPU description shapes", () => {
    expect(cpuDescription({}, { cpu_info: { processor: "legacy CPU" } })).toBe("legacy CPU");
    expect(cpuDescription({ cpu_info: { cpu_desc: "nested CPU" } }, {})).toBe("nested CPU");
    expect(cpuDescription({}, {})).toBeUndefined();
  });

  test("asks fallback independently for missing or stale pushed channels", () => {
    expect(hostChannelsNeedFallback(9_000, null, 10_000)).toEqual({ memory: false, uptime: true });
    expect(hostChannelsNeedFallback(0, 9_000, 20_000)).toEqual({ memory: true, uptime: false });
    expect(hostChannelsNeedFallback(null, null, 20_000)).toEqual({ memory: true, uptime: true });
    expect(hostChannelsNeedFallback(9_000, null, 20_000, 10_000)).toEqual({ memory: false, uptime: true });
    expect(hostChannelsNeedFallback(19_000, null, 20_000, 10_000)).toEqual({ memory: false, uptime: true });
  });

  test("stable responses validate shapes and version strings while allowing unknown CPU identity", () => {
    const root = { result: { cpu_info: { processor: "CPU" } } };
    const printer = { result: { software_version: "klipper-test" } };
    const server = { result: { moonraker_version: "moonraker-test" } };
    expect(stableSystemInfo(root, printer, server)).toMatchObject({
      cpu: "CPU", klipper: "klipper-test", moonraker: "moonraker-test",
    });
    expect(stableSystemInfo({ result: { system_info: {} } }, printer, server)).toMatchObject({
      klipper: "klipper-test", moonraker: "moonraker-test",
    });
    const realCpuShape = { result: { system_info: { cpu_info: {
      cpu_count: 2, bits: "32bit", processor: "mips", cpu_desc: "", serial_number: "",
      hardware_desc: "", model: "", total_memory: 214_048, memory_units: "kB",
    } } } };
    expect(stableSystemInfo(realCpuShape, printer, server).cpu).toBe("mips");
    expect(stableSystemInfo({ result: { system_info: { last_boot: 0 } } }, printer, server).uptime).toBeUndefined();
    expect(() => stableSystemInfo({}, printer, server)).toThrow(/system information response was malformed/);
    expect(() => stableSystemInfo(root, { result: null }, server)).toThrow(/missing a valid software version/);
    expect(() => stableSystemInfo(root, printer, { result: { moonraker_version: {} } })).toThrow(/missing a valid software version/);
    expect(cpuDescription({ cpu_info: { cpu_desc: "", processor: "mips", model: "" } }, {})).toBe("mips");
  });
});
