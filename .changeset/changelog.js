// How a changeset becomes a line in CHANGELOG.md: the sentence the author
// wrote, with no commit hash or link, since the changelog is for people.
export default {
  async getReleaseLine(changeset) {
    const [first, ...rest] = changeset.summary.trim().split("\n");
    const more = rest.map((line) => `  ${line}`.trimEnd()).join("\n");
    return `\n\n- ${first}${more ? `\n${more}` : ""}`;
  },
  async getDependencyReleaseLine() {
    return "";
  },
};
