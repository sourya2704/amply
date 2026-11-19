import { formatINR } from "../lib/format";
import type { PriceBreakdown } from "../lib/types";

export function PriceTable({ p, note = true }: { p: PriceBreakdown; note?: boolean }) {
  const rows: [string, number][] = [
    [`Energy (${p.energy_kwh} kWh, est.)`, p.energy_cost_paise],
    ["Service fee", p.service_fee_paise],
    ["GST (18% on fee)", p.tax_paise],
  ];
  return (
    <div className="space-y-2 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between text-muted-2">
          <span>{k}</span>
          <span className="font-semibold tabular-nums">{formatINR(v)}</span>
        </div>
      ))}
      <div className="flex justify-between border-t border-line pt-2.5 text-base font-extrabold">
        <span>Estimated total</span>
        <span className="tabular-nums">{formatINR(p.total_paise)}</span>
      </div>
      {note && <p className="text-xs text-muted">Final charge depends on the energy actually delivered.</p>}
    </div>
  );
}
