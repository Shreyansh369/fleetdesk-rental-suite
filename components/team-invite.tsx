"use client";

import {
  Check,
  Copy,
  Mail,
  UserPlus,
} from "lucide-react";

import {
  useState,
} from "react";

import { inviteLink } from "@/lib/services/workspace";

import { useFirebaseAuth } from "./firebase-provider";

/*
 * How an administrator brings the team in: one link, sent however
 * the office already sends things. Whoever registers from it
 * lands in the waiting list below, and nothing opens for them
 * until an administrator approves them with a role.
 */
export function TeamInvite() {
  const { mode, workspace } = useFirebaseAuth();
  const [copied, setCopied] = useState(false);

  if (mode === "demo") {
    return (
      <section className="team-invite is-demo">
        <UserPlus size={20} />
        <div>
          <strong>Inviting your team</strong>
          <p>
            In your trial you share one invite link
            and colleagues register from it. In the
            demo, use <b>Demo tools → Add a staff
            member</b> above, then approve them here.
          </p>
        </div>
      </section>
    );
  }

  if (!workspace) {
    return null;
  }

  const link = inviteLink(workspace.id);

  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2_500);
    } catch {
      window.prompt("Copy the invite link:", link);
    }
  }

  const mail = `mailto:?subject=${encodeURIComponent(
    `Join ${workspace.name || "our"} workspace on FleetDesk`,
  )}&body=${encodeURIComponent(
    `Register from this link, and I will approve your account:\n\n${link}\n`,
  )}`;

  return (
    <section className="team-invite">
      <UserPlus size={20} />

      <div className="team-invite-copy">
        <strong>Invite your team</strong>
        <p>
          Send this link to your staff. They register
          from it and appear here, waiting for you to
          approve them and choose their role.
        </p>

        <div className="team-invite-link">
          <input
            readOnly
            value={link}
            aria-label="Invite link"
            onFocus={(event) => event.target.select()}
          />

          <button
            type="button"
            className="button button-secondary compact"
            onClick={() => void copy()}
          >
            {copied ? (
              <Check size={15} />
            ) : (
              <Copy size={15} />
            )}
            {copied ? "Copied" : "Copy"}
          </button>

          <a
            className="button button-secondary compact"
            href={mail}
          >
            <Mail size={15} />
            Email
          </a>
        </div>
      </div>
    </section>
  );
}
