import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as prettier from 'prettier'
import { describe, expect, it } from 'vitest'

const file = join(__dirname, '..', 'cep', 'host.jsx')

describe('cep/host.jsx (ExtendScript)', () => {
  it('ends every statement with a semicolon: ExtendScript inserts far fewer than a browser', async () => {
    const source = readFileSync(file, 'utf8')
    const formatted = await prettier.format(source, {
      parser: 'babel',
      semi: true,
      singleQuote: true,
      printWidth: 100,
      trailingComma: 'none'
    })
    expect(source).toBe(formatted)
  })

  it('stays ES3: no let/const, arrows, template strings, trailing commas or modern array methods', () => {
    const source = readFileSync(file, 'utf8')
    expect(source).not.toMatch(/\b(const|let)\s|=>|`|\.(map|forEach|filter|some|every|padStart)\(/)
    expect(source).not.toMatch(/,\s*[\]}]/)
  })
})
