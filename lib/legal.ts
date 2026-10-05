/*
 * Who the legal pages speak for. Set these for the deployment;
 * the defaults keep the pages readable before they are.
 *
 * The documents themselves are a solid starting point written
 * for how FleetDesk actually works (what is stored, where, and
 * who processes it), not legal advice. Have them reviewed for
 * the countries you sell in before taking payment.
 */

export const LEGAL_UPDATED = "5 October 2026";

function env(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function legalDetails() {
  const email =
    env(process.env.NEXT_PUBLIC_LEGAL_EMAIL) ??
    env(process.env.NEXT_PUBLIC_SALES_EMAIL);

  return {
    product: "FleetDesk",
    entity:
      env(process.env.NEXT_PUBLIC_LEGAL_ENTITY) ??
      "the FleetDesk provider",
    address: env(process.env.NEXT_PUBLIC_LEGAL_ADDRESS),
    jurisdiction:
      env(process.env.NEXT_PUBLIC_LEGAL_JURISDICTION) ??
      "the country in which the provider is registered",
    email,
    contact: email ?? "the contact address on this site",
  };
}

export const LEGAL_LINKS = [
  { href: "/terms", label: "Terms of service" },
  { href: "/privacy", label: "Privacy policy" },
  { href: "/cookies", label: "Cookie policy" },
  { href: "/refunds", label: "Refunds and cancellation" },
  { href: "/acceptable-use", label: "Acceptable use" },
] as const;
