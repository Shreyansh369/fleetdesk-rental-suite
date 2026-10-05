import type { LegalDocument } from "./legal-documents";

import { LegalFooter } from "./legal-footer";
import { SiteHeader } from "./site-header";

import { LEGAL_UPDATED } from "@/lib/legal";

export function LegalPage({
  document,
}: {
  document: LegalDocument;
}) {
  return (
    <div className="site">
      <SiteHeader />

      <main className="legal">
        <header className="legal-head">
          <h1>{document.title}</h1>
          <p className="legal-updated">
            Last updated {LEGAL_UPDATED}
          </p>
          <div className="legal-intro">{document.intro}</div>
        </header>

        <div className="legal-layout">
          <nav className="legal-toc" aria-label="On this page">
            <p>On this page</p>
            <ol>
              {document.sections.map((section) => (
                <li key={section.id}>
                  <a href={`#${section.id}`}>
                    {section.heading}
                  </a>
                </li>
              ))}
            </ol>
          </nav>

          <article className="legal-body">
            {document.sections.map((section, index) => (
              <section key={section.id} id={section.id}>
                <h2>
                  <span>{index + 1}.</span> {section.heading}
                </h2>
                {section.body}
              </section>
            ))}
          </article>
        </div>
      </main>

      <LegalFooter />
    </div>
  );
}
