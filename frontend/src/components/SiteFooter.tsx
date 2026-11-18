import { Link } from "react-router-dom";
import { Wordmark } from "./Logo";

const COLUMNS: [string, [string, string][]][] = [
  ["Support", [["Help centre", "/info/help"], ["Safety", "/info/safety"], ["Contact us", "/info/contact"]]],
  ["Legal", [["Terms of use", "/info/terms"], ["Privacy", "/info/privacy"], ["Cancellations & refunds", "/info/refunds"]]],
];

export function SiteFooter() {
  return (
    <footer className="bg-ink text-white">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:grid-cols-[1.4fr_1fr_1fr] sm:px-10">
        <div>
          <Wordmark size={36} dark />
          <p className="mt-3 max-w-xs text-sm text-white/60">Charge anywhere. Power together. Community EV charging, piloting in Bengaluru.</p>
        </div>
        {COLUMNS.map(([title, links]) => (
          <div key={title}>
            <h2 className="text-xs font-bold tracking-widest text-primary uppercase">{title}</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {links.map(([label, to]) => (
                <li key={to}>
                  <Link to={to} className="text-white/80 hover:text-primary">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 px-5 py-4 text-center text-xs text-white/50 sm:px-10">© 2026 Amply · Made in Bengaluru · Pilot version</div>
    </footer>
  );
}
