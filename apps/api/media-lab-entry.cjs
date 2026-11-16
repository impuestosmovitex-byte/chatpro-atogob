'use strict';
/**
 * Offline-first entrypoint for the SINGLE-PURPOSE synthetic media lab.
 * Not referenced by the normal API start scripts or Railway service.
 * Bind localhost only. No DB, Meta, queues, automation, or outbound calls.
 */
const { validateMediaLabEnv } = require('../../scripts/mw1-media-lab-preflight.cjs');

async function run() {
  const result = validateMediaLabEnv(process.env);
  if (!result.ok) {
    // Deliberately do not print env values, tokens or secrets.
    process.stderr.write('MEDIA_LAB_STARTUP_REFUSED: ' + result.reasons.join(',') + '\n');
    process.exitCode = 1;
    return;
  }

  // Only import Nest after the isolation preflight passes.
  const { NestFactory } = require('@nestjs/core');
  const { MediaLabModule } = require('./dist/media-lab.module.js');
  const app = await NestFactory.create(MediaLabModule, { logger: false });
  // No public interface. A separate approval is needed to make it accessible.
  const port = Number(process.env.MW1_MEDIA_LAB_PORT || '3199');
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error('Invalid isolated lab port');
  }
  await app.listen(port, '127.0.0.1');
}

if (require.main === module) {
  run().catch(() => {
    process.stderr.write('MEDIA_LAB_STARTUP_FAILED\n');
    process.exitCode = 1;
  });
}

module.exports = { run };
