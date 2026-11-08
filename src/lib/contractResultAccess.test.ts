import { describe, it, expect, vi } from 'vitest';
import { canViewerAccessContractResult, canViewerAccessSignedContract, type ContractResultAccessDeps } from './contractResultAccess';

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

describe('canViewerAccessSignedContract (H1: the signed PDF\'s rule)', () => {
    const rescue = (v: string, o: string) => v === o || ([OWNER, MATE].includes(v) && [OWNER, MATE].includes(o));
    const sDeps = () => ({ sameRescue: vi.fn(async (v: string, o: string) => rescue(v, o)), isAdmin: vi.fn(async (v: string) => v === ADMIN) });

    it('the animal\'s rescue opens it: the owner and a teammate', async () => {
        expect(await canViewerAccessSignedContract(' Owner@X.org ', OWNER, sDeps())).toBe(true);
        expect(await canViewerAccessSignedContract(MATE, OWNER, sDeps())).toBe(true);
    });

    it('an admin opens it; another group and a loner do not', async () => {
        expect(await canViewerAccessSignedContract(ADMIN, OWNER, sDeps())).toBe(true);
        expect(await canViewerAccessSignedContract(OTHER_GROUP, OWNER, sDeps())).toBe(false);
        expect(await canViewerAccessSignedContract(NO_GROUP, OWNER, sDeps())).toBe(false);
    });

    it('after a transfer it follows the animal\'s current rescue', async () => {
        expect(await canViewerAccessSignedContract(OWNER, OTHER_GROUP, sDeps())).toBe(false);
        expect(await canViewerAccessSignedContract(OTHER_GROUP, OTHER_GROUP, sDeps())).toBe(true);
    });

    it('anonymous is refused without any lookup', async () => {
        const d = sDeps();
        expect(await canViewerAccessSignedContract(null, OWNER, d)).toBe(false);
        expect(d.sameRescue).not.toHaveBeenCalled();
        expect(d.isAdmin).not.toHaveBeenCalled();
    });
});
