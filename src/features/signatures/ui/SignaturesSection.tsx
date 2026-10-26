import { useEffect, useRef, useState } from "react";
import type { Account, Identity } from "../../../platform/tauri/bindings";
import { useIdentities, useSetSignature } from "../../../shared/lib/queries";
import { showToast } from "../../../shared/lib/toast";
import { AccountAvatar } from "../../accounts/ui/AccountAvatar";
import { useSignIn } from "../../accounts/ui/useSignIn";
import { HtmlPreview } from "../../compose/ui/HtmlPreview";
import { EditorBody, FormatBar, useRichEditor } from "../../compose/ui/RichEditor";
import { Button, Group, Row } from "../../settings/ui/controls";
import { editorWouldSimplify, signatureToSave } from "../model/signature";
import { accelLabel, primaryKey } from "../../../shared/lib/platform";
import { APP_NAME } from "../../../shared/lib/brand";

/**
 * Settings → Signatures: each address's Gmail signature, shown as compose
 * shows it, with an editor. New mail and replies from that address use it
 * (in Gmail too).
 */
export function SignaturesSection({ accounts }: { accounts: Account[] }) {
  const identities = useIdentities().data ?? [];
  const [editing, setEditing] = useState<Identity | null>(null);
  const signIn = useSignIn();
  return (
    <>
      {signIn.error && <p className="selectable pb-4 text-[12px] text-danger">{signIn.error}</p>}
      {accounts.map((account) => {
        const name = account.displayName?.trim();
        const allowed = !account.missingPermissions.includes("gmailSettings");
        return (
          <Group
            key={account.id}
            title={
              <>
                <AccountAvatar account={account} state={undefined} />
                <span className="truncate">{name || account.email}</span>
                {name && (
                  <span className="truncate font-normal text-content/45">{account.email}</span>
                )}
              </>
            }
          >
            {!allowed && (
              <Row
                label="Sign in again"
                description={
                  <span className="text-warn">
                    {APP_NAME} needs permission to change this account’s signatures.
                  </span>
                }
              >
                <Button onClick={() => signIn.start(account.email)} disabled={signIn.pending}>
                  Sign in again
                </Button>
              </Row>
            )}
            {identities
              .filter((i) => i.accountId === account.id)
              .map((identity) => (
                <Row
                  key={identity.email}
                  label={
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span>{identity.email}</span>
                      {identity.name && (
                        <span className="font-normal text-content/45">{identity.name}</span>
                      )}
                    </span>
                  }
                  description={
                    identity.signature ? (
                      <div className="mt-1.5 max-h-48 overflow-hidden">
                        <HtmlPreview
                          title={`Signature for ${identity.email}`}
                          html={identity.signature}
                        />
                      </div>
                    ) : (
                      "No signature"
                    )
                  }
                >
                  <Button onClick={() => setEditing(identity)} disabled={!allowed}>
                    {identity.signature ? "Edit" : "Add"}
                  </Button>
                </Row>
              ))}
          </Group>
        );
      })}
      {editing && <SignatureEditor identity={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

/** The composer's editor in a dialog, for one address's signature. ⌘↩ saves. */
function SignatureEditor({ identity, onClose }: { identity: Identity; onClose: () => void }) {
  const [html, setHtml] = useState({ html: identity.signature ?? "", text: "", edited: false });
  const editor = useRichEditor(identity.signature ?? "", (c) =>
    setHtml((prev) => ({ html: c.html, text: c.text, edited: prev.edited || c.edited })),
  );
  const save = useSetSignature();
  const simplifies = editorWouldSimplify(identity.signature);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => {
    editor?.commands.focus("end");
  }, [editor]);

  const submit = (value: string) => {
    save.mutate(
      { account: identity.accountId, email: identity.email, html: value },
      {
        onSuccess: () => {
          onClose();
          showToast({ message: value ? "Signature saved" : "Signature removed" });
        },
      },
    );
  };
  // Nothing changed: nothing to send (Gmail's copy stays exactly as is).
  const saveEdits = () => (html.edited ? submit(signatureToSave(html.html, html.text)) : onClose());

  return (
    <dialog
      ref={ref}
      aria-labelledby="signature-editor-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!save.isPending) onClose();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && primaryKey(e) && !save.isPending) {
          e.preventDefault();
          saveEdits();
        }
      }}
      className="dialog m-auto w-[36rem] rounded-xl p-5 text-[13px] text-content"
    >
      <h2 id="signature-editor-title" className="mb-1 text-sm font-semibold">
        Signature
      </h2>
      <p className="mb-3 text-xs text-content/50">
        For {identity.email}. Used for new mail and replies from this address, in {APP_NAME} and
        Gmail.
      </p>
      {simplifies && (
        <p className="mb-3 rounded-md bg-warn/10 px-3 py-2 text-xs text-warn">
          This signature is laid out with a table, which this editor can’t keep. Saving here will
          simplify its layout; Cancel leaves it as it is.
        </p>
      )}
      <div className="rounded-lg ring-1 ring-stroke">
        <div className="border-b border-stroke py-1">
          <FormatBar editor={editor} />
        </div>
        <div className="max-h-72 min-h-32 overflow-y-auto px-3">
          <EditorBody editor={editor} />
        </div>
      </div>
      {save.error && <p className="selectable mt-3 text-xs text-danger">{save.error.message}</p>}
      <div className="mt-4 flex items-center gap-2">
        {identity.signature && (
          <button
            type="button"
            disabled={save.isPending}
            onClick={() => submit("")}
            className="h-7 rounded-md px-3 text-danger hover:bg-danger/10 disabled:opacity-50"
          >
            Remove signature
          </button>
        )}
        <span className="flex-1" />
        <button
          type="button"
          disabled={save.isPending}
          onClick={onClose}
          className="h-7 rounded-md bg-selection px-3 hover:bg-selection-strong disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          title={accelLabel("Cmd+Enter")}
          disabled={save.isPending}
          onClick={saveEdits}
          className="h-7 rounded-md bg-accent px-3 font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {save.isPending ? "Saving…" : "Save"}
        </button>
      </div>
    </dialog>
  );
}
