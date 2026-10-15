import type { Label, LabelId } from "../../../platform/tauri/bindings";

/** A label, or a group of labels sharing a prefix, in the sidebar. */
export type LabelNode = {
  /** Stable within one account: the path, joined with "/". */
  key: string;
  name: string;
  /** The label itself; null for a group that only exists as a prefix. */
  label: Label | null;
  children: LabelNode[];
};

/**
 * Splits a label name into its sidebar path. "/" is Gmail's own nesting;
 * "Prefix: Name" (as Acme's labels do) groups by prefix too. Brackets
 * left by IMAP clients ("[Gmail]") are dropped.
 */
export function labelPath(name: string): string[] {
  const parts = name.split("/");
  const prefix = /^([^:]+):\s+(.+)$/.exec(parts[0] ?? "");
  if (prefix) parts.splice(0, 1, prefix[1]!, prefix[2]!);
  return parts.map((p) => p.trim().replace(/^\[(.+)\]$/, "$1")).filter((p) => p !== "");
}

/**
 * The account's labels as a tree, sorted by name. Groups only appear with
 * two or more entries: a lone chain like "[Gmail]/Trash/Sent" stays one row
 * ("Gmail / Trash / Sent") instead of three nested levels.
 */
export function labelTree(labels: Label[]): LabelNode[] {
  const root: LabelNode = { key: "", name: "", label: null, children: [] };
  for (const label of labels) {
    let node = root;
    for (const part of labelPath(label.name)) {
      const key = node.key ? `${node.key}/${part}` : part;
      let child = node.children.find((c) => c.key === key);
      if (!child) {
        child = { key, name: part, label: null, children: [] };
        node.children.push(child);
      }
      node = child;
    }
    if (node !== root) node.label = label;
  }
  return tidy(root.children);
}

function tidy(nodes: LabelNode[]): LabelNode[] {
  return nodes
    .map((node) => {
      const children = tidy(node.children);
      const only = children[0];
      if (!node.label && children.length === 1 && only) {
        return { ...only, name: `${node.name} / ${only.name}` };
      }
      return { ...node, children };
    })
    .toSorted((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

/** True when the node is, or contains, the given label. */
export function containsLabel(node: LabelNode, id: LabelId): boolean {
  return node.label?.id === id || node.children.some((c) => containsLabel(c, id));
}
