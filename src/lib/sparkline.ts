export interface SparklineGeometry {
  points: string;
  min: number;
  max: number;
}

export function buildSparklineGeometry(
  values: number[],
  width = 100,
  height = 28,
  padding = 2,
): SparklineGeometry | null {
  const finiteValues = values.filter(Number.isFinite);
  if (finiteValues.length < 2 || width <= padding * 2 || height <= padding * 2) {
    return null;
  }

  const minValue = Math.min(...finiteValues);
  const maxValue = Math.max(...finiteValues);
  const range = Math.max(maxValue - minValue, 2);
  const middle = (minValue + maxValue) / 2;
  const min = middle - range / 2;
  const max = middle + range / 2;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;

  const points = finiteValues
    .map((value, index) => {
      const x = padding + (index / (finiteValues.length - 1)) * usableWidth;
      const y = padding + (1 - (value - min) / (max - min)) * usableHeight;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return { points, min: minValue, max: maxValue };
}
