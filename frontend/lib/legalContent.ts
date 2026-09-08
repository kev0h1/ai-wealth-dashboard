// A17: pure helper that strips the MCP-connector-only sections out of the
// Privacy Policy / Terms markdown when the connector is off
// (NEXT_PUBLIC_MCP_CONNECTOR unset, see lib/featureFlags.ts's MCP_CONNECTOR).
// The connector content in content/privacy.md and content/terms.md is
// wrapped in `<!-- mcp-connector:start -->` / `<!-- mcp-connector:end -->`
// marker comments; this function never edits those files, it only
// transforms the string at render time. Both legal pages call it with the
// live flag before handing the result to LegalDocument.

const START = "<!-- mcp-connector:start -->";
const END = "<!-- mcp-connector:end -->";

// A whole marked block: the start marker, its body, the end marker, and
// (if present) the single newline right after it, so removing the block
// consumes the blank-line-worth of trailing whitespace that followed it
// rather than doubling it up.
const BLOCK_RE = new RegExp(`${START}\\n?([\\s\\S]*?)${END}\\n?`, "g");

// Just the marker comment lines themselves (each with its own trailing
// newline), used for the enabled case where the surrounding content stays.
const MARKER_LINE_RE = new RegExp(`^(?:${START}|${END})\\n?`, "gm");

// A markdown "## N. Heading" line, the numbered top-level sections both
// documents use.
const NUMBERED_HEADING_RE = /^## (\d+)\.\s/;

// "Section 7" or "Sections 7 and 9" (case-sensitive, matching how both
// documents actually write it).
const SECTION_REF_RE = /\bSection(s?) (\d+)(?:( and )(\d+))?\b/g;

/** How much a section number shifts down once every number in `removed`
 * that is smaller than it has been deleted from the document. */
function shiftBy(n: number, removed: number[]): number {
  let dec = 0;
  for (const r of removed) if (n > r) dec++;
  return n - dec;
}

/**
 * Strip (or keep) the MCP-connector-only content in a legal markdown
 * document.
 *
 * `enabled: true` returns the document byte-identical to the source file
 * except the marker comment lines are removed; nothing else changes. This
 * is what ships once the connector actually launches.
 *
 * `enabled: false` (today's default) removes every marked block entirely,
 * then:
 *   - renumbers any `## N. Heading` that follows a removed *numbered*
 *     section, decrementing by one for every removed section number below
 *     it (a removed block that isn't itself a numbered `## N.` section,
 *     just an inline paragraph or an unnumbered `### ` subsection, triggers
 *     no renumbering at all);
 *   - rewrites `Section N` / `Sections N and M` cross-references the same
 *     way, for any N greater than a removed section's number;
 * so the disabled document reads as a normal, self-consistent policy: no
 * numbering gap, no dangling reference to a section that no longer exists.
 */
export function stripMcpSections(markdown: string, enabled: boolean): string {
  if (enabled) {
    return markdown.replace(MARKER_LINE_RE, "");
  }

  const removedSectionNumbers: number[] = [];
  for (const match of markdown.matchAll(BLOCK_RE)) {
    const heading = (match[1] ?? "").match(NUMBERED_HEADING_RE);
    if (heading) removedSectionNumbers.push(Number(heading[1]));
  }

  let out = markdown.replace(BLOCK_RE, "");
  // Collapse the blank-line gap a removed block can leave behind (or, for
  // a removed block sitting between two paragraphs, the two blank lines
  // that used to bracket it) down to the document's normal single blank
  // line between block elements.
  out = out.replace(/\n{3,}/g, "\n\n");

  if (removedSectionNumbers.length === 0) return out;

  out = out.replace(/^## (\d+)\.(\s)/gm, (_full, n: string, sp: string) => {
    return `## ${shiftBy(Number(n), removedSectionNumbers)}.${sp}`;
  });

  out = out.replace(
    SECTION_REF_RE,
    (_full, plural: string, n1: string, andPart: string | undefined, n2: string | undefined) => {
      const newN1 = shiftBy(Number(n1), removedSectionNumbers);
      if (andPart && n2) {
        const newN2 = shiftBy(Number(n2), removedSectionNumbers);
        return `Section${plural} ${newN1}${andPart}${newN2}`;
      }
      return `Section${plural} ${newN1}`;
    }
  );

  return out;
}
