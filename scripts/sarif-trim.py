"""Trims Semgrep's SARIF output before it goes to GitHub code scanning.

Semgrep writes the full text of every rule it ran into the file. The rules'
license allows our own use, not passing them on, so only the rules that
found something stay, and of each only its ID, its short message and the
link to Semgrep's own page. Run by .github/workflows/semgrep.yml (Semgrep's
image has Python, not Bun).

    python3 scripts/sarif-trim.py semgrep.sarif
"""

import json
import sys

KEEP = ("id", "name", "shortDescription", "helpUri", "defaultConfiguration", "properties")


def trim(sarif):
    for run in sarif.get("runs", []):
        used = {r.get("ruleId") for r in run.get("results", [])}
        driver = run.get("tool", {}).get("driver", {})
        rules = []
        for rule in driver.get("rules", []):
            if rule.get("id") not in used:
                continue
            kept = {k: rule[k] for k in KEEP if k in rule}
            # Tags and precision only: other properties can quote the rule.
            props = kept.get("properties", {})
            kept["properties"] = {k: props[k] for k in ("tags", "precision", "security-severity") if k in props}
            rules.append(kept)
        driver["rules"] = rules
        # The rule index each result points at changed with the list.
        index = {r["id"]: i for i, r in enumerate(rules)}
        for result in run.get("results", []):
            if result.get("ruleId") in index:
                result["ruleIndex"] = index[result["ruleId"]]
            else:
                result.pop("ruleIndex", None)
            result.pop("rule", None)
    return sarif


if __name__ == "__main__":
    path = sys.argv[1]
    with open(path, encoding="utf-8") as f:
        data = trim(json.load(f))
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f)
