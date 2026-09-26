import fs from 'node:fs';
import path from 'node:path';
import { inspectTexasSolverJson } from './lib/cash-pro-lab-texassolver-schema.mjs';

const fileArg=process.argv[2];
if(!fileArg) throw new Error('usage: node scripts/cash-pro-lab-inspect-texassolver-json.mjs <solver-output.json>');
const file=path.resolve(fileArg);
if(!fs.existsSync(file)) throw new Error(`file not found: ${file}`);
const value=JSON.parse(fs.readFileSync(file,'utf8'));
const report=inspectTexasSolverJson(value);
console.log(JSON.stringify({file,...report},null,2));
if(!report.hasStrategy||report.strategyShapeErrors>0) process.exitCode=2;
