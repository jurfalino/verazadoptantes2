import { describe, it, expect, vi } from 'vitest';
import { canViewerAccessContractResult, type ContractResultAccessDeps } from './contractResultAccess';

const OWNER = 'owner@x.org';
const MATE = 'mate@x.org';
const OTHER_GROUP = 'other@y.org';
const NO_GROUP = 'loner@z.org';
const ADMIN = 'admin@x.org';

const deps = (over: Partial<ContractResultAccessDeps> = {}): ContractResultAccessDeps => ({
    isOrgMate: vi.fn(async (v: string, o: string) => v !== o && [OWNER, MATE].includes(v) && [OWNER, MATE].includes(o)),
    isAdmin: vi.fn(async (v: string) => v === ADMIN),
    ...over,
});
const contract = { userId: OWNER, type: 'contract_result' };

describe('canViewerAccessContractResult', () => {
    it('the recipient opens it (case and spaces ignored)', async () => {
        expect(await canViewerAccessContractResult(' Owner@X.org ', contract, deps())).toBe(true);
    });

    it('a teammate of the recipient opens it — the team acts as one', async () => {
        expect(await canViewerAccessContractResult(MATE, contract, deps())).toBe(true);
    });

    it('an admin opens it', async () => {
        expect(await canViewerAccessContractResult(ADMIN, contract, deps())).toBe(true);
    });

    it('a member of another group is refused', async () => {
        expect(await canViewerAccessContractResult(OTHER_GROUP, contract, deps())).toBe(false);
    });

    it('a signed-in user in no group is refused', async () => {
        expect(await canViewerAccessContractResult(NO_GROUP, contract, deps())).toBe(false);
    });

    it('anonymous is refused without any lookup', async () => {
        const d = deps();
        expect(await canViewerAccessContractResult('', contract, d)).toBe(false);
        expect(await canViewerAccessContractResult(null, contract, d)).toBe(false);
        expect(d.isOrgMate).not.toHaveBeenCalled();
        expect(d.isAdmin).not.toHaveBeenCalled();
    });

    it('a teammate\'s notification of ANOTHER type is never opened as a contract (not even by an admin)', async () => {
        const other = { userId: OWNER, type: 'form_submission' };
        expect(await canViewerAccessContractResult(MATE, other, deps())).toBe(false);
        expect(await canViewerAccessContractResult(ADMIN, other, deps())).toBe(false);
        // …while its own recipient keeps the old behaviour.
        expect(await canViewerAccessContractResult(OWNER, other, deps())).toBe(true);
    });

    it('a broken lookup throws (the caller shows an error with its id), never reads as allowed', async () => {
        const d = deps({ isOrgMate: vi.fn(async () => { throw new Error('D1 down'); }) });
        await expect(canViewerAccessContractResult(MATE, contract, d)).rejects.toThrow('D1 down');
    });
});
