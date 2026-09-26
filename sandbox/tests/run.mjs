/**
 * Entry point of the sandbox tests: configures the stack once, then runs every *.test.mjs here.
 * Tests use node:test, which reports the results and sets the exit code.
 */
import { readdir } from 'node:fs/promises'
import { setup } from './setup.mjs'

await setup()

const files = (await readdir(new URL('./', import.meta.url)))
  .filter((file) => file.endsWith('.test.mjs'))
  .sort()

for (const file of files) {
  await import(`./${file}`)
}
