import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText, LifeBuoy, Lock, Mail, Plus, ReceiptIndianRupee, ShieldCheck, type LucideIcon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { SiteFooter } from "../components/SiteFooter";
import { Wordmark } from "../components/Logo";
import { IconTile, usePageTitle } from "../components/ui";

// Public help & legal pages. The legal texts are a plain-language draft for the pilot and must be
// reviewed by a lawyer before Amply takes real payments (see PRD §10, "Regulatory and commercial review").

interface Section {
  q: string;
  a: string;
}

const PAGES: Record<string, { title: string; icon: LucideIcon; intro: string; sections: Section[] }> = {
  help: {
    title: "Help centre",
    icon: LifeBuoy,
    intro: "Quick answers to the things people ask us most.",
    sections: [
      { q: "How do I know a charger fits my EV?", a: "Add your EV under My EVs. Amply checks the plug type (CCS2, Type 2, CHAdeMO, GB/T) and AC/DC support, and hides chargers that won't work. If a spec is missing, we say “compatibility unknown” instead of guessing." },
      { q: "What do the availability labels mean?", a: "Live comes from the operator in real time. Owner schedule means the owner's set hours. Reported means another driver told us recently. Stale means it hasn't been confirmed in over 24 hours. Unconfirmed means we simply don't know, so check before you go." },
      { q: "When do I pay?", a: "Only after the owner accepts your request. Your slot is held for 30 minutes so you can pay; after that it's released." },
      { q: "Can I cancel?", a: "Yes. Cancel any time before your session starts and you get a full refund if you'd paid." },
      { q: "When do I see the exact address?", a: "Home addresses and access instructions are shown only after your booking is paid and confirmed, to protect owners' privacy." },
      { q: "Something went wrong at the charger", a: "Open the booking and tap “Get help with this booking”. Pick what happened and our team will follow up. You'll get a notification when it's resolved." },
      { q: "Does the AI assistant book things on its own?", a: "Never. It searches real listings and prepares a booking, but nothing happens until you press Confirm." },
    ],
  },
  safety: {
    title: "Safety",
    icon: ShieldCheck,
    intro: "Charging should be boring, in the best way. Here's how we keep it that way.",
    sections: [
      { q: "Verified listings", a: "Every charger is reviewed by the Amply team before it goes live. Listings that look duplicated or unusually priced are flagged for a human to check." },
      { q: "Electrical safety", a: "Only proper EV charging equipment can be listed; ordinary household sockets are not EV chargers. If anything looks damaged, overheats or smells of burning, stop charging and report it from the booking." },
      { q: "Privacy for hosts", a: "Exact home addresses are only shared with a driver after payment, and only for that booking." },
      { q: "Report a problem", a: "Use “Report this listing” on any charger page, or “Get help” on a booking. Reports go to a person, not a bot. Nothing is enforced automatically." },
    ],
  },
  contact: {
    title: "Contact us",
    icon: Mail,
    intro: "Real humans, based in Bengaluru.",
    sections: [
      { q: "Need help with a booking?", a: "The fastest way is “Get help with this booking” on the booking page. It sends us all the details automatically." },
      { q: "Email", a: "support@amply.example (pilot inbox). We reply within one working day." },
      { q: "Want to list your charger or partner with us?", a: "Create an account, choose “Share my charger”, and submit your listing. For cafés, offices and apartment communities: partners@amply.example." },
      { q: "Where we are", a: "Pilot area: Koramangala, HSR Layout, Indiranagar, BTM Layout and Bellandur, Bengaluru." },
    ],
  },
  terms: {
    title: "Terms of use",
    icon: FileText,
    intro: "Draft terms for the Amply pilot, in plain language. Not yet reviewed by a lawyer.",
    sections: [
      { q: "What Amply is", a: "A marketplace that connects EV drivers with charger owners and lists public stations. Amply does not own the chargers listed by hosts." },
      { q: "Your account", a: "Keep your login private and your details accurate. You're responsible for activity on your account." },
      { q: "Bookings", a: "A booking is a reservation request; it's confirmed once the owner accepts and you pay. Prices shown before energy is delivered are estimates." },
      { q: "Hosts", a: "Hosts must have the right to share the charger and property access, keep equipment safe and in good condition, and honour accepted bookings." },
      { q: "Fair use", a: "No fake listings, no abuse, no attempts to bypass payments or reviews. We may pause accounts after a human review." },
    ],
  },
  privacy: {
    title: "Privacy",
    icon: Lock,
    intro: "We collect only what we need to run charging bookings.",
    sections: [
      { q: "What we collect", a: "Your name, email, vehicles, bookings and messages you send to support. Location is used only when you tap “Near me”, and isn't stored." },
      { q: "What we share", a: "Drivers see a host's name and approximate area; the exact address only after payment. Hosts see the driver's name for their bookings." },
      { q: "Payments", a: "Card and UPI details are entered on Razorpay's secure form and never reach our servers." },
      { q: "Your choices", a: "Contact us to download or delete your data." },
    ],
  },
  refunds: {
    title: "Cancellations & refunds",
    icon: ReceiptIndianRupee,
    intro: "Simple rules, no fine print.",
    sections: [
      { q: "Before the session", a: "Cancel any time before your slot starts for a full refund." },
      { q: "Requests the owner doesn't answer", a: "If the owner doesn't respond within 30 minutes, the request expires and you're not charged." },
      { q: "Paid after a hold expired?", a: "If a payment lands after your hold has expired, it's refunded automatically." },
      { q: "Problems during a session", a: "Open a support case on the booking. Our team reviews it and can issue a refund." },
    ],
  },
};

export const INFO_LINKS = Object.entries(PAGES).map(([slug, p]) => ({ slug, title: p.title }));

export default function Info() {
  const { topic = "help" } = useParams();
  const page = PAGES[topic] ?? PAGES.help;
  usePageTitle(page.title);
  const { user } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-surface">
      {/* signed-in users already have the app's top bar */}
      {!user && (
      <header className="flex items-center justify-between px-5 py-4 sm:px-10">
        <Link to="/login" aria-label="Amply home">
          <Wordmark size={42} />
        </Link>
        <Link to="/login" className="inline-flex items-center gap-1 rounded-full bg-surface-3 px-4 py-2 text-sm font-bold hover:bg-line">
          <ArrowLeft size={15} /> Back
        </Link>
      </header>
      )}
      <main className="mx-auto w-full max-w-3xl flex-1 px-5 pt-8 pb-28 sm:px-10 md:pb-12">
        <IconTile icon={page.icon} size={52} />
        <h1 className="mt-4 text-4xl">{page.title}</h1>
        <p className="mt-2 text-lg text-muted-2">{page.intro}</p>
        <div className="mt-8 space-y-3">
          {page.sections.map((s) => (
            <details key={s.q} className="group rounded-2xl bg-surface-2 p-5 open:bg-primary-soft" open={page.sections.length <= 5}>
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-bold">
                {s.q}
                <Plus size={18} className="shrink-0 transition group-open:rotate-45" />
              </summary>
              <p className="mt-2 text-sm leading-relaxed text-muted-2">{s.a}</p>
            </details>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
