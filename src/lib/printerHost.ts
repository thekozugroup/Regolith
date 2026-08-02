export function isValidDevelopmentPrinterHost(host: string): boolean {
  if (!host || host.length > 253 || host.includes("..")) return false;
  if (/^[0-9.]+$/.test(host)) {
    const octets = host.split(".");
    return (
      octets.length === 4 &&
      octets.every((octet) => {
        if (!/^\d{1,3}$/.test(octet)) return false;
        const value = Number(octet);
        return value >= 0 && value <= 255;
      })
    );
  }

  return host.split(".").every(
    (label) =>
      label.length > 0 &&
      label.length <= 63 &&
      /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label),
  );
}
