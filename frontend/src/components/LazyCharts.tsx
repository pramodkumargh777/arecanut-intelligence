import { lazy, Suspense, type ComponentProps } from "react";
import { LoadingState } from "./State";

// echarts is large; charts load on demand like PriceChart so table-only views stay light.
const Line = lazy(() => import("./InsightCharts").then((module) => ({ default: module.LineSeriesChart })));
const Bar = lazy(() => import("./InsightCharts").then((module) => ({ default: module.CategoryBarChart })));
const Range = lazy(() => import("./InsightCharts").then((module) => ({ default: module.RankedRangeChart })));

type LineProps = ComponentProps<typeof import("./InsightCharts").LineSeriesChart>;
type BarProps = ComponentProps<typeof import("./InsightCharts").CategoryBarChart>;
type RangeProps = ComponentProps<typeof import("./InsightCharts").RankedRangeChart>;

export function LazyLineChart(props: LineProps) { return <Suspense fallback={<LoadingState label="Loading chart" />}><Line {...props} /></Suspense>; }
export function LazyBarChart(props: BarProps) { return <Suspense fallback={<LoadingState label="Loading chart" />}><Bar {...props} /></Suspense>; }
export function LazyRangeChart(props: RangeProps) { return <Suspense fallback={<LoadingState label="Loading chart" />}><Range {...props} /></Suspense>; }
