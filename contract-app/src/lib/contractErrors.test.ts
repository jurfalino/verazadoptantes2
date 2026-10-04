import { describe, it, expect } from 'vitest'
import { contractErrorKey } from './contractErrors'
import { contract } from '../i18n/catalogs/contract'

describe('contractErrorKey', () => {
    it('maps the token refusals to catalog keys', () => {
        expect(contractErrorKey(404, undefined)).toBe('contract.error_not_found')
        expect(contractErrorKey(410, 'used')).toBe('contract.error_used')
        expect(contractErrorKey(410, 'expired')).toBe('contract.error_expired')
        expect(contractErrorKey(410, 'already_adopted')).toBe('contract.error_already_adopted')
        expect(contractErrorKey(410, 'not_allowed')).toBe('contract.error_not_allowed')
    })

    it('falls back for anything else', () => {
        expect(contractErrorKey(410, 'other')).toBeNull()
        expect(contractErrorKey(500, 'not_allowed')).toBeNull()
    })

    it('every key it returns exists in es, en and pt', () => {
        for (const [status, code] of [[404, undefined], [410, 'used'], [410, 'expired'], [410, 'already_adopted'], [410, 'not_allowed']] as const) {
            const key = contractErrorKey(status, code)!
            for (const loc of ['es', 'en', 'pt'] as const) expect(contract[loc][key], `${loc} ${key}`).toBeTruthy()
        }
    })
})
