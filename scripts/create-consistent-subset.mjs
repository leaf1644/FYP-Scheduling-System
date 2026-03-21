#!/usr/bin/env node
import path from 'node:path';
import { generateSubsetFiles } from './subset-generator-core.mjs';

const parseArgs = (argv) => {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = 'true';
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
};

const printUsage = () => {
  console.log([
    'Usage:',
    '  npm run subset:create -- --students <students.csv> --availability <availability.csv> --rooms <rooms.csv> [--slots <slots.csv>] [--fraction 0.33 | --count 40] [--strategy first|random] [--seed demo] [--keep-all-professors] [--room-slot-fraction 0.5 | --room-slot-count 12] [--room-slot-strategy first|random] [--room-slot-seed demo] [--output generated/subset]',
    '',
    'Examples:',
    '  npm run subset:create -- --students data/students.csv --availability data/professors.csv --rooms data/rooms.csv --fraction 0.5 --output generated/subset-half',
    '  npm run subset:create -- --students data/students.xlsx --availability data/professors.xlsx --rooms data/rooms.xlsx --count 30 --strategy random --seed 42 --output generated/subset-30',
    '  npm run subset:create -- --students data/students.xlsx --availability data/professors.xlsx --rooms data/rooms.xlsx --fraction 1 --keep-all-professors --room-slot-fraction 0.33 --output generated/room-slot-third',
  ].join('\n'));
};

const args = parseArgs(process.argv.slice(2));

if (args.help === 'true') {
  printUsage();
  process.exit(0);
}

if (!args.students || !args.availability || !args.rooms) {
  printUsage();
  process.exit(1);
}

const outputDir = args.output ? path.resolve(args.output) : path.resolve('generated', 'subset');
const fraction = args.count ? undefined : Number(args.fraction || '0.5');
const count = args.count ? Number(args.count) : undefined;
const strategy = args.strategy === 'random' ? 'random' : 'first';
const roomSlotFraction = args['room-slot-count'] ? undefined : (args['room-slot-fraction'] ? Number(args['room-slot-fraction']) : undefined);
const roomSlotCount = args['room-slot-count'] ? Number(args['room-slot-count']) : undefined;
const roomSlotStrategy = args['room-slot-strategy'] === 'random' ? 'random' : undefined;

if (fraction !== undefined && (!Number.isFinite(fraction) || fraction <= 0 || fraction > 1)) {
  console.error('Fraction must be a number between 0 and 1.');
  process.exit(1);
}

if (count !== undefined && (!Number.isFinite(count) || count <= 0)) {
  console.error('Count must be a positive integer.');
  process.exit(1);
}

if (roomSlotFraction !== undefined && (!Number.isFinite(roomSlotFraction) || roomSlotFraction <= 0 || roomSlotFraction > 1)) {
  console.error('Room slot fraction must be a number between 0 and 1.');
  process.exit(1);
}

if (roomSlotCount !== undefined && (!Number.isFinite(roomSlotCount) || roomSlotCount <= 0)) {
  console.error('Room slot count must be a positive integer.');
  process.exit(1);
}

try {
  const subset = await generateSubsetFiles({
    studentPath: path.resolve(args.students),
    availabilityPath: path.resolve(args.availability),
    roomPath: path.resolve(args.rooms),
    slotPath: args.slots ? path.resolve(args.slots) : undefined,
    outputDir,
    options: {
      fraction,
      count,
      strategy,
      seed: args.seed,
      keepAllProfessors: args['keep-all-professors'] === 'true',
      roomSlotFraction,
      roomSlotCount,
      roomSlotStrategy,
      roomSlotSeed: args['room-slot-seed'],
    },
  });

  console.log(`Subset generated in ${outputDir}`);
  console.log(`Students: ${subset.students.rows.length}`);
  console.log(`Professors: ${subset.availability.rows.length}`);
  console.log(`Room rows: ${subset.rooms.rows.length}`);
  if (args.slots) {
    console.log(`Slot rows: ${subset.slots.rows.length}`);
  }
  console.log(`Referenced professors: ${subset.metadata.selectedProfessorIds.join(', ')}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}