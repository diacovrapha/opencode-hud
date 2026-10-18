import * as React from "react";
import type { EChartsOption } from "echarts";
import { EChart, HUD_THEME } from "./EChart";
import type { DailyPoint } from "@/lib/data/types";
import { formatMoney, formatTokens, type MoneyFmt } from "@/lib/ui/format";
import { EmptyState } from "@/components/hud/EmptyState";

type CalendarHeatmapProps = {
  data: DailyPoint[];
  metric?: "cost" | "tokens";
  fmt?: MoneyFmt;
  className?: string;
};

/**
 * Heatmap estilo GitHub: cada dia um quadradinho colorido.
 *
 * Quando não há dados, renderiza um `EmptyState` no lugar do gráfico
 * para evitar o erro `Cannot read properties of undefined (reading
 * 'toString')` originado em `_initRangeOption` quando ECharts recebe
 * um `range` undefined.
 */
export function CalendarHeatmap({
  data,
  metric = "cost",
  fmt,
  className,
}: CalendarHeatmapProps): React.JSX.Element {
  if (!data || data.length === 0) {
    return (
      <EmptyState
        title="Sem dados no período"
        description="Nenhum uso registrado ainda para esse intervalo."
        className={className}
      />
    );
  }

  const option = React.useMemo<EChartsOption>(() => {
    const max = data.reduce((acc, d) => {
      const v = pointValue(d, metric);
      return Math.max(acc, v);
    }, 0);

    const points = data.map((d) => [d.date, pointValue(d, metric)]);

    // range: precisa ser um par de strings "YYYY-MM-DD" SEMPRE (ECharts
    // exige). Se por algum motivo `data[0].date` for inválido, caímos
    // num range seguro (hoje e hoje).
    const first = data[0]?.date;
    const last = data[data.length - 1]?.date;
    const today = new Date();
    const safeDate = (d?: string): string => {
      if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
      const t = new Date(today);
      return [
        t.getFullYear(),
        String(t.getMonth() + 1).padStart(2, "0"),
        String(t.getDate()).padStart(2, "0"),
      ].join("-");
    };
    const range: [string, string] = [safeDate(first), safeDate(last)];

    return {
      backgroundColor: HUD_THEME.backgroundColor,
      tooltip: {
        ...HUD_THEME.tooltip,
        formatter: (params: unknown): string => {
          const arr = params as Array<{ value: [string, number] }>;
          if (!Array.isArray(arr) || arr.length === 0) return "";
          const [date, value] = arr[0].value;
          const valueLabel =
            metric === "cost"
              ? fmt
                ? formatMoney(value, fmt, { hideSecondary: true }).primary
                : `$${value.toFixed(4)}`
              : formatTokens(value);
          return `<div style="font-weight:600">${date}</div><div style="color:#c4b5fd;margin-top:2px">${valueLabel}</div>`;
        },
      },
      visualMap: {
        show: false,
        min: 0,
        max: Math.max(max, 0.0001),
        inRange: {
          color: ["rgba(139, 92, 246, 0.1)", "#8b5cf6", "#c026d3", "#f0abfc"],
        },
        calculable: false,
      },
      calendar: {
        top: 24,
        left: 30,
        right: 8,
        bottom: 8,
        range,
        cellSize: ["auto", 14],
        itemStyle: {
          color: "rgba(255, 255, 255, 0.04)",
          borderColor: "rgba(11, 11, 20, 0.6)",
          borderWidth: 2,
        },
        splitLine: { show: false },
        yearLabel: {
          color: "rgba(226, 232, 240, 0.5)",
          fontSize: 11,
          margin: 8,
        },
        monthLabel: {
          color: "rgba(226, 232, 240, 0.6)",
          fontSize: 10,
          margin: 6,
          nameMap: [
            "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
            "Jul", "Ago", "Set", "Out", "Nov", "Dez",
          ],
        },
        dayLabel: {
          color: "rgba(226, 232, 240, 0.45)",
          fontSize: 9,
          firstDay: 0,
          nameMap: ["D", "S", "T", "Q", "Q", "S", "S"],
        },
      },
      series: [
        {
          type: "heatmap",
          coordinateSystem: "calendar",
          data: points,
          emphasis: {
            itemStyle: {
              borderColor: "#fff",
              borderWidth: 1,
              shadowBlur: 8,
              shadowColor: "rgba(139, 92, 246, 0.6)",
            },
          },
        },
      ],
    };
  }, [data, metric, fmt]);

  return <EChart option={option} className={className} />;
}

function pointValue(d: DailyPoint, metric: "cost" | "tokens"): number {
  if (metric === "cost") return d.aggregate.cost;
  return (
    d.aggregate.tokens.input +
    d.aggregate.tokens.output +
    d.aggregate.tokens.reasoning +
    d.aggregate.tokens.cacheRead +
    d.aggregate.tokens.cacheWrite
  );
}