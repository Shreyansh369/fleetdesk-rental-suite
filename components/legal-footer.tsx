import Link from "next/link";

import { LEGAL_LINKS, legalDetails } from "@/lib/legal";

/* The links every public page carries, as Stripe and the law expect. */
export function LegalFooter() {
  const legal = legalDetails();

  return (
    <footer className="site-footer">
      <div className="site-footer-inner">
        <p className="site-footer-entity">
          © {new Date().getFullYear()} {legal.entity}
          {legal.address ? `, ${legal.address}` : ""}
        </p>

        <nav aria-label="Legal">
          {LEGAL_LINKS.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
          {legal.email && (
            <a href={`mailto:${legal.email}`}>Contact</a>
          )}
        </nav>
      </div>
    </footer>
  );
}
