import * as React from "react";
import ReactECharts from "echarts-for-react";
import type { EChartsOption } from "echarts";

/**
 * Tema escuro customizado para os gráficos do HUD. Usado em todos os
 * charts para garantir consistência visual.
 */
export const HUD_THEME: {
  backgroundColor: string;
  color: string[];
  legend: Record<string, unknown>;
  tooltip: Record<string, unknown>;
} = {
  backgroundColor: "transparent",
  color: [
    "#8b5cf6",
    "#3b82f6",
    "#c026d3",
    "#06b6d4",
    "#10b981",
    "#f59e0b",
    "#ef4444",
    "#a855f7",
  ],
  legend: {
    textStyle: { color: "rgba(226, 232, 240, 0.7)" },
    icon: "roundRect",
    itemWidth: 10,
    itemHeight: 10,
  },
  tooltip: {
    backgroundColor: "rgba(15, 12, 30, 0.92)",
    borderColor: "rgba(255, 255, 255, 0.1)",
    borderWidth: 1,
    textStyle: { color: "#e2e8f0", fontSize: 12 },
    extraCssText:
      "backdrop-filter: blur(12px) saturate(160%); -webkit-backdrop-filter: blur(12px) saturate(160%); border-radius: 8px; box-shadow: 0 8px 30px -8px rgba(0,0,0,0.6);",
  },
};

type EChartProps = {
  option: EChartsOption;
  className?: string;
  style?: React.CSSProperties;
  /** "loading" deixa um spinner centralizado. */
  loading?: boolean;
  /** Quando true, usa merge para transições suaves. */
  notMerge?: boolean;
};

export function EChart({
  option,
  className,
  style,
  loading,
  notMerge = false,
}: EChartProps): React.JSX.Element {
  return (
    <ReactECharts
      className={className}
      option={option}
      notMerge={notMerge}
      lazyUpdate
      theme="dark"
      showLoading={loading}
      style={{ height: "100%", width: "100%", ...style }}
      opts={{ renderer: "canvas" }}
    />
  );
}

export type { EChartsOption };