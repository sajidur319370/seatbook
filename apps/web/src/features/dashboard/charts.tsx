import type { ReactElement, ReactNode } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

/*
 * Chart rules for this project (dataviz skill; Day 19 guide 10c):
 * one measure per chart and one y-axis; one series, so no legend (the card title names it);
 * bars ≤ 24 px with 4 px rounded tops, lines 2 px without dots; hairline solid horizontal grid;
 * colour from the validated --viz-1 token; text in text tokens, never the series colour;
 * a hover tooltip, and every value also in a data table (screen readers, exact numbers).
 */

const SERIES = 'var(--viz-1)';
const axis = {
  stroke: 'var(--muted-foreground)',
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;

/** Value first and strong, the label after it in muted ink, keyed by a short line, not a box. */
function TooltipBox(props: { label: string; value: string; name: string }) {
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-sm text-popover-foreground shadow-sm">
      <p className="text-xs text-muted-foreground">{props.label}</p>
      <p className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="inline-block h-0.5 w-3 rounded"
          style={{ background: SERIES }}
        />
        <span className="font-semibold tabular-nums">{props.value}</span>
        <span className="text-muted-foreground">{props.name}</span>
      </p>
    </div>
  );
}

type TipProps = {
  active?: boolean;
  payload?: readonly { value?: unknown }[];
  label?: unknown;
};
const tooltip =
  (name: string, formatLabel: (l: string) => string, formatValue: (v: number) => string) =>
  (p: TipProps) =>
    p.active && p.payload?.length ? (
      <TooltipBox
        label={formatLabel(String(p.label))}
        value={formatValue(Number(p.payload[0]!.value))}
        name={name}
      />
    ) : null;

export function ChartCard(props: { title: string; table: ReactNode; children: ReactElement }) {
  return (
    <section className="rounded-xl border bg-card p-4">
      <h3 className="text-sm font-medium">{props.title}</h3>
      <div className="mt-3 h-56">
        <ResponsiveContainer>{props.children}</ResponsiveContainer>
      </div>
      <details className="mt-2 text-sm text-muted-foreground">
        <summary className="cursor-pointer">Data table</summary>
        <div className="mt-2 max-h-64 overflow-auto">{props.table}</div>
      </details>
    </section>
  );
}

/** A plain two-or-more-column table for the chart's exact numbers. */
export function DataTable(props: { head: string[]; rows: (string | number)[][] }) {
  return (
    <table className="w-full text-left tabular-nums">
      <thead>
        <tr>
          {props.head.map((h) => (
            <th key={h} className="py-1 pr-4 font-medium">
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {props.rows.map((r) => (
          <tr key={String(r[0])} className="border-t">
            {r.map((c, i) => (
              <td key={i} className="py-1 pr-4">
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Columns from one baseline: counts per day or per 5 minutes. The bar is its own hover target. */
export function CountBars(props: {
  data: readonly object[];
  x: string; // field names in `data`
  y: string;
  name: string;
  formatX: (x: string) => string;
}) {
  return (
    <BarChart data={props.data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey={props.x}
        tickFormatter={(v) => props.formatX(String(v))}
        minTickGap={16}
        {...axis}
      />
      <YAxis allowDecimals={false} width={36} {...axis} />
      <Tooltip
        cursor={{ fill: 'var(--muted)' }}
        content={tooltip(props.name, props.formatX, (v) => v.toLocaleString('en-US'))}
      />
      <Bar dataKey={props.y} fill={SERIES} radius={[4, 4, 0, 0]} maxBarSize={24} />
    </BarChart>
  );
}

/** A running total. The crosshair finds the day; no dots on the line. */
export function RunningLine(props: {
  data: readonly object[];
  x: string; // field names in `data`
  y: string;
  name: string;
  formatX: (x: string) => string;
  formatY: (v: number) => string;
  formatTick: (v: number) => string;
}) {
  return (
    <LineChart data={props.data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis
        dataKey={props.x}
        tickFormatter={(v) => props.formatX(String(v))}
        minTickGap={16}
        {...axis}
      />
      <YAxis width={64} tickFormatter={(v) => props.formatTick(Number(v))} {...axis} />
      <Tooltip
        cursor={{ stroke: 'var(--muted-foreground)', strokeWidth: 1 }}
        content={tooltip(props.name, props.formatX, props.formatY)}
      />
      <Line
        type="monotone"
        dataKey={props.y}
        stroke={SERIES}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        dot={false}
        activeDot={{ r: 4, fill: SERIES, stroke: 'var(--card)', strokeWidth: 2 }}
        isAnimationActive={false}
      />
    </LineChart>
  );
}
