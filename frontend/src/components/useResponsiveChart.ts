import { useEffect, useState } from "react";
import type { EChartsType } from "echarts/core";

export function useResponsiveChart() {
  const [chart, setChart] = useState<EChartsType | null>(null);

  useEffect(() => {
    if (!chart) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || chart.isDisposed()) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0 && (chart.getWidth() !== width || chart.getHeight() !== height)) {
        chart.resize({ width, height });
      }
    });
    observer.observe(chart.getDom());
    return () => observer.disconnect();
  }, [chart]);

  return setChart;
}
