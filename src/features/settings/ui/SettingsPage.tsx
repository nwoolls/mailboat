import { useEffect, useRef } from "react";
import type { Account, AccountId, AccountSyncState } from "../../../platform/tauri/bindings";
import { sectionFor, type SettingsSectionId } from "../model/sections";
import { RulesSection } from "../../rules/ui/RulesSection";
import { AiSection } from "../../ai/ui/AiSection";
import { SignaturesSection } from "../../signatures/ui/SignaturesSection";
import { VacationSection } from "../../vacation/ui/VacationSection";
import { PageHeader } from "./controls";
import {
  AccountsSection,
  AppearanceSection,
  ComposingSection,
  GeneralSection,
  KeyboardSection,
  NotificationsSection,
  ToyboxSection,
  AdvancedSection,
  ViewingSection,
} from "./SettingsSections";

/**
 * The open section, in a rounded panel where the list and reader were (as
 * MonoCode's `SettingsView`). Esc closes Settings, after menus, dialogs
 * and text fields have had it.
 */
export function SettingsPage({
  section,
  accounts,
  syncStates,
  onAccountRemoved,
  onClose,
}: {
  section: SettingsSectionId;
  accounts: Account[];
  syncStates: AccountSyncState[];
  onAccountRemoved: (id: AccountId) => void;
  onClose: () => void;
}) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (e.target instanceof Element && e.target.closest("[role=menu], [role=dialog], dialog"))
        return;
      // A message being written (compose card) minimises itself instead.
      if (e.target instanceof HTMLElement && e.target.isContentEditable) return;
      if (
        (e.target instanceof HTMLInputElement && e.target.type !== "range") ||
        e.target instanceof HTMLTextAreaElement
      ) {
        e.target.blur();
        return;
      }
      e.preventDefault();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { label, description } = sectionFor(section);
  const header = (action?: React.ReactNode) => (
    <PageHeader title={label} description={description} action={action} />
  );

  return (
    <section
      aria-label={`Settings: ${label}`}
      className="panel flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
    >
      {/* Keyed, so each section starts at the top. */}
      <div key={section} className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl px-8 pt-8 pb-16">
          {section === "accounts" ? (
            <AccountsSection
              accounts={accounts}
              syncStates={syncStates}
              onAccountRemoved={onAccountRemoved}
              header={header}
            />
          ) : section === "appearance" ? (
            <AppearanceSection header={header} />
          ) : section === "rules" ? (
            <RulesSection accounts={accounts} header={header} />
          ) : (
            header()
          )}
          {section === "general" && <GeneralSection />}
          {section === "notifications" && <NotificationsSection />}
          {section === "viewing" && <ViewingSection />}
          {section === "composing" && <ComposingSection />}
          {section === "ai" && <AiSection />}
          {section === "signatures" && <SignaturesSection accounts={accounts} />}
          {section === "vacation" && <VacationSection accounts={accounts} />}
          {section === "keyboard" && <KeyboardSection />}
          {section === "toybox" && <ToyboxSection />}
          {section === "advanced" && <AdvancedSection />}
        </div>
      </div>
    </section>
  );
}
