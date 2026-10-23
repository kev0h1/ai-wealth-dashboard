"""Static source drift gate for the public marketing facts."""
import ast
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FACTS = json.loads((ROOT / "website/src/product-facts.json").read_text())
TREE = ast.parse((ROOT / "backend/app/core/subscription.py").read_text())

def value(node):
    if isinstance(node, ast.Constant):
        return node.value
    if isinstance(node, ast.Attribute):
        return node.attr.lower()
    if isinstance(node, ast.Dict):
        return {value(key): value(item) for key, item in zip(node.keys, node.values)}
    if isinstance(node, (ast.List, ast.Tuple)):
        return [value(item) for item in node.elts]
    raise TypeError(f"unsupported subscription literal: {ast.dump(node)}")

assignments = {}
for node in TREE.body:
    if isinstance(node, ast.Assign):
        for target in node.targets:
            if isinstance(target, ast.Name) and target.id in {"TIER_BILLING_PRICES_GBP", "TIER_LIMITS", "SUBSCRIPTION_TRIAL_DAYS"}:
                assignments[target.id] = value(node.value)

assert assignments["TIER_BILLING_PRICES_GBP"] == FACTS["prices"], "price facts drifted"
assert assignments["TIER_LIMITS"] == FACTS["limits"], "limit facts drifted"
assert assignments["SUBSCRIPTION_TRIAL_DAYS"] == FACTS["trialDays"], "trial facts drifted"

# Read only each authoritative constant, never a stale preview or node_modules.
import re
regulatory = (ROOT / "frontend/lib/regulatoryCopy.ts").read_text()
hero = (ROOT / "frontend/components/SafeToSpendCard.tsx").read_text()
def constant(source, name):
    match = re.search(r'export const ' + name + r'\s*=\s*"([^"]+)"', source)
    assert match, f"missing authoritative constant {name}"
    return match.group(1)
assert constant(regulatory, "AGENT_DISCLOSURE") == FACTS["agentDisclosure"], "agent disclosure drifted"
assert constant(regulatory, "TRADING_NAME_DISCLOSURE") == FACTS["tradingNameDisclosure"], "trading-name disclosure drifted"
assert constant(hero, "COUNTS_LINE") == FACTS["countsLine"], "counts line drifted"
assert FACTS["disclaimer"] in hero, "estimate disclaimer drifted"
print("C35: prices, limits, trial and exact disclosures match authoritative sources")
