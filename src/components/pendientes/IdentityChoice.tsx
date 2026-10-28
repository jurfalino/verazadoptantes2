'use client';

/**
 * «¿Es la misma persona?» (D35): asked before combining a pair that matched
 * on a contact (phone, email, address) while the names differ — the same
 * question the post import asks. «Sí» combines as usual; «No, es alguien de su
 * hogar» keeps both profiles and adds the other person as a household member.
 */

import { Button } from '@/components/ui/Button';
import { PendientesDialog, T_MUTED, T_PRIMARY, fill, type T } from './ui';

export default function IdentityChoice({ nameA, nameB, busy, onSame, onHousehold, onCancel, t }: {
    nameA: string;
    nameB: string;
    busy: boolean;
    onSame: () => void;
    onHousehold: () => void;
    onCancel: () => void;
    t: T;
}) {
    return (
        <PendientesDialog title={t('myAdopters.pending_d_identity_title') || '¿Es la misma persona?'} onClose={onCancel} busy={busy} testId="dedup-identity-dialog" t={t}>
            <p className={`text-[15px] ${T_PRIMARY}`}>
                {fill(t('myAdopters.pending_d_identity_body') || 'Coinciden los datos de contacto, pero los nombres son distintos: {a} y {b}.', { a: nameA, b: nameB })}
            </p>
            <p className={`mt-2 text-[14px] ${T_MUTED}`}>
                {t('myAdopters.pending_d_identity_household_hint') || 'Si es alguien de su hogar, los perfiles quedan separados y lo agregamos como conviviente.'}
            </p>
            <div className="mt-6 flex flex-col gap-2">
                <Button type="button" data-testid="dedup-identity-same" onClick={onSame} disabled={busy} fullWidth>
                    {t('myAdopters.pending_d_identity_same') || 'Sí, la misma persona'}
                </Button>
                <Button type="button" variant="secondary" data-testid="dedup-identity-household" onClick={onHousehold} disabled={busy} fullWidth>
                    {t('myAdopters.pending_d_identity_household') || 'No, es alguien de su hogar'}
                </Button>
            </div>
        </PendientesDialog>
    );
}
