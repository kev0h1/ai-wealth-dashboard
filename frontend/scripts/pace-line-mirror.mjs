// G153: runs the REAL `paceLine` out of components/SpendVerdictView.tsx
// through _tsx-loader.mjs (G148) and prints its output as JSON, so
// backend/tests/test_pace_line_mirror.py can shell out to this file and
// compare byte-for-byte against `_pace_line` (backend/app/services/
// notifications.py) instead of modelling `paceLine`'s formatting itself.
//
// Why a model was not good enough: an earlier version of this test
// re-implemented `fmt`'s formatting inline (`f"{sym}{round(excess):,}"` on
// the Python side). That model agreed with itself even after a reviewer
// changed the real `fmt` to 2-decimal-place formatting - the test never
// touched the real function, so it could not see the drift. This file
// exists to make that impossible: it imports and calls the actual
// exported `paceLine`, so any change to its wording, its rounding, or its
// `fmt` helper changes this script's output too.
//
// Input: JSON on argv[2], an array of {multiple, excess, daysElapsed}.
// Output: JSON array of the corresponding paceLine(...) strings, in order.
//
// Run with:
//   node --no-warnings --experimental-loader ./scripts/_tsx-loader.mjs \
//     scripts/pace-line-mirror.mjs '[{"multiple":1.3,"excess":210,"daysElapsed":13}]'
import { paceLine } from "../components/SpendVerdictView.tsx";

const cases = JSON.parse(process.argv[2] ?? "[]");
const results = cases.map((c) => paceLine(c.multiple, c.excess, c.daysElapsed));
process.stdout.write(JSON.stringify(results));
