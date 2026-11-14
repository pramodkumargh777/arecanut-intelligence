import { useEffect, useState } from "react";
import type { EChartsType } from "echarts/core";

export function useResponsiveChart() {
  const [chart, setChart] = useState<EChartsType | null>(null);

  useEffect(() => {
    // A chart can be disposed before this runs (a quick re-render, or React's development double mount); its DOM is
    // then gone, and observing it would throw and take the page down. Such a chart needs no resizing.
    if (!chart || chart.isDisposed()) return;
    const dom = chart.getDom();
    if (!(dom instanceof Element)) return;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || chart.isDisposed()) return;
      const { width, height } = entry.contentRect;
      if (width > 0 && height > 0 && (chart.getWidth() !== width || chart.getHeight() !== height)) {
        chart.resize({ width, height });
      }
    });
    observer.observe(dom);
    return () => observer.disconnect();
  }, [chart]);

  return setChart;
}
