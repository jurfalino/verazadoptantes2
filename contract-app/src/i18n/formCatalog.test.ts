import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { form } from './catalogs/form'
import { giftTitleKey } from '../lib/giftFlow'
import { FORM_STEP_IDS } from '../lib/adoptionDocs'

// Every form.* key the public form asks for exists in all three languages —
// a missing en/pt key silently shows Spanish (types.ts fallback).
const src = readFileSync(join(__dirname, '../PetShieldForm.tsx'), 'utf8')
const used = [...new Set([...src.matchAll(/t\('(form\.[A-Za-z0-9_]+)'\)/g)].map(m => m[1]))]
const giftKeys = FORM_STEP_IDS.map(id => giftTitleKey(id)).filter((k): k is string => !!k)

describe('form catalog', () => {
    for (const lang of ['es', 'en', 'pt'] as const) {
        it(`${lang} has every key the form uses`, () => {
            const missing = [...used, ...giftKeys].filter(k => !(k in form[lang]))
            expect(missing).toEqual([])
        })
    }
})
