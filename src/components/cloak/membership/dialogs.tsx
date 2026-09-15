"use client";

/*
 * Membership dialogs (pricing & membership update spec §39, §46).
 * ContactRequestDialog — Circle / Office / Sovereign contact-led intake,
 * honest about what happens with the data.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ShieldCheckIcon } from "@animateicons/react/lucide";
import { RiseDialogContent } from "@/components/cloak/shared/rise-dialog-content";

/* ---------- Contact request (Circle / Office / Sovereign / briefing / adviser / partner) ----------
 *
 * Review spec §37: request only useful information; never ask for home
 * address, wallet address, or a phone number. Confidential-content warning
 * is mandatory for a privacy company.
 */

export type ContactProduct =
  | "private_circle"
  | "office"
  | "sovereign"
  | "briefing"
  | "adviser"
  | "partner";

const INTEREST_LABELS: Record<string, string> = {
  private_circle: "Cloaq Private Circle",
  office: "Cloaq Office",
  sovereign: "Cloaq Sovereign",
  briefing: "A private briefing",
  adviser: "Adviser access",
  partner: "A partnership",
};

export function ContactRequestDialog({
  open,
  onOpenChange,
  product,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: ContactProduct;
}) {
  const [prepared, setPrepared] = useState(false);
  const orgOptional =
    product === "private_circle" ||
    product === "briefing" ||
    product === "adviser" ||
    product === "partner";
  const orgLabel = orgOptional ? "Organization (optional)" : "Organization";
  const title = INTEREST_LABELS[product] ?? "Cloaq";

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) setPrepared(false);
      }}
    >
      <RiseDialogContent className="max-h-[85dvh] overflow-y-auto border-cloak-border bg-cloak-bg-elevated text-cloak-text sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="cloak-display text-xl">Contact Cloaq</DialogTitle>
          <DialogDescription className="text-cloak-text-secondary">
            {title} — tell us a little about your requirements.
          </DialogDescription>
        </DialogHeader>

        {prepared ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-cloak-border bg-cloak-surface p-4">
              <div className="flex items-center gap-2 text-sm font-medium text-cloak-text">
                <ShieldCheckIcon size={15} className="text-cloak-success" />
                Request prepared
              </div>
              <p className="mt-2 text-[13px] leading-relaxed text-cloak-text-secondary">
                This preview keeps everything on this device — nothing was
                transmitted. When Cloaq&apos;s communications service launches,
                this form reaches the Cloaq team directly.
              </p>
            </div>
            <Button
              variant="outline"
              className="w-full border-cloak-border-strong text-cloak-text hover:bg-cloak-surface"
              onClick={() => onOpenChange(false)}
            >
              Close
            </Button>
          </div>
        ) : (
          <form
            className="space-y-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              setPrepared(true);
            }}
          >
            <ContactField id="cr-name" label="Name">
              <Input
                id="cr-name"
                required
                placeholder="Your name"
                className="border-cloak-border bg-cloak-bg text-cloak-text placeholder:text-cloak-text-muted"
              />
            </ContactField>
            <ContactField id="cr-email" label="Work email">
              <Input
                id="cr-email"
                type="email"
                required
                placeholder="you@organization.com"
                className="border-cloak-border bg-cloak-bg text-cloak-text placeholder:text-cloak-text-muted"
              />
            </ContactField>
            <ContactField id="cr-org" label={orgLabel}>
              <Input
                id="cr-org"
                placeholder={orgOptional ? "Optional" : "Organization name"}
                className="border-cloak-border bg-cloak-bg text-cloak-text placeholder:text-cloak-text-muted"
              />
            </ContactField>
            <div className="grid grid-cols-2 gap-3">
              <ContactField id="cr-people" label="Approximate number of people">
                <Input
                  id="cr-people"
                  inputMode="numeric"
                  placeholder="e.g. 12"
                  className="border-cloak-border bg-cloak-bg text-cloak-text placeholder:text-cloak-text-muted"
                />
              </ContactField>
              <ContactField id="cr-deployment" label="Deployment requirements">
                <Input
                  id="cr-deployment"
                  placeholder="e.g. Private infrastructure"
                  className="border-cloak-border bg-cloak-bg text-cloak-text placeholder:text-cloak-text-muted"
                />
              </ContactField>
            </div>
            <ContactField id="cr-message" label="Message">
              <textarea
                id="cr-message"
                rows={3}
                placeholder="What you need from private communications"
                className="w-full rounded-lg border border-cloak-border bg-cloak-bg px-3 py-2 text-[13.5px] text-cloak-text outline-none placeholder:text-cloak-text-muted focus-visible:outline-2 focus-visible:outline-cloak-gold/60"
              />
            </ContactField>
            <p className="text-[11px] leading-relaxed text-cloak-text-muted">
              Do not include confidential message content in this form.
            </p>
            <Button
              type="submit"
              className="bg-cloak-gold/20 hover:bg-cloak-gold/25 w-full border border-cloak-gold/30 text-cloak-gold hover:text-cloak-gold"
            >
              Send request
            </Button>
          </form>
        )}
      </RiseDialogContent>
    </Dialog>
  );
}

function ContactField({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={id} className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-cloak-text-secondary">{label}</span>
      {children}
    </label>
  );
}
