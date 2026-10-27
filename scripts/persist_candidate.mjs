// Call only for a completed, attributable browser download on this filesystem.
import {randomUUID, createHash} from 'node:crypto';
import {mkdir, readFile, stat, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';

export async function persistCandidate(sourcePath, outputDir, {expectedBytes} = {}) {
  for (const value of [sourcePath, outputDir]) {
    if (typeof value !== 'string' || !isAbsolute(value)) {
      throw new TypeError('sourcePath and outputDir must be native absolute paths');
    }
  }
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new TypeError('expectedBytes must be the positive completed download byte count');
  }

  // The source comes from the current browser receipt, never a guessed download folder.
  const before = await stat(sourcePath);
  if (!before.isFile() || before.size !== expectedBytes) {
    throw new Error('candidate_size_mismatch');
  }
  const bytes = await readFile(sourcePath);
  const after = await stat(sourcePath);
  if (bytes.length !== expectedBytes || before.size !== after.size
      || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs
      || before.ino !== after.ino || before.dev !== after.dev) {
    throw new Error('candidate_changed_during_read');
  }
  if (bytes.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('candidate_not_pdf');
  }

  await mkdir(outputDir, {recursive: true});
  const candidatePath = join(outputDir, `candidate-${randomUUID()}.pdf`);
  await writeFile(candidatePath, bytes, {flag: 'wx'});
  return {
    capture_status: 'saved_candidate', source_path: sourcePath, candidate_path: candidatePath,
    bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
    identity_match: null, identity_status: 'unresolved',
  };
}
