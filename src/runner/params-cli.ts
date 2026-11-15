// Run the simulation from a parameter file and print what happened.
//
//   npm run sim -- params/centre-outage.json
//   npm run sim -- params/*.json
//
// Each file is run with our program and with the baseline, on the same timetable and the
// same failures. Both are scored against the baseline with nothing failed. The command
// exits non-zero if a file is invalid or if our program has a collision.
//
// A file can pick its layout with "layout". The report names it, and every file starts from
// the default layout again, so one file's layout or values never carry into the next.

// @ts-expect-error Node's own types are not installed. This file only runs under vite-node.
import { readFileSync } from 'node:fs';
import { ParamsError, parseParams, resetParams } from '../shared/params';
import { compareParams, formatParamsReport } from './params';
import { PROGRAMS } from './programs';

declare const process: { argv: string[]; exitCode?: number };

function runFile(path: string): boolean {
  try {
    const report = compareParams(parseParams(JSON.parse(readFileSync(path, 'utf8'))), PROGRAMS);
    console.log(`\n${path}: ${formatParamsReport(report)}`);
    return report.ours.result.collisions === 0;
  } catch (e) {
    console.log(`\n${path}\n${e instanceof ParamsError ? e.message : `Could not run the file: ${String(e)}`}`);
    return false;
  } finally {
    resetParams();
  }
}

const files = process.argv.slice(2).filter((a) => a.endsWith('.json'));
if (files.length === 0) {
  console.log('Usage: npm run sim -- <parameter file.json> [more files]\nExample files are in params/.');
  process.exitCode = 1;
} else if (!files.map(runFile).every(Boolean)) {
  process.exitCode = 1;
}
