/**
 * An email address that wraps at sensible points on a phone (audit 2026-10-28,
 * C7 / B20): a line may break after each «.» of the local part, before the
 * «@» and before each «.» of the domain (<wbr>), and only mid-word when one piece is still wider than the
 * line (`overflow-wrap: anywhere`, which also lets a flex child shrink). Give
 * its flex parent `min-w-0`.
 */
import { Fragment } from 'react';

export function BreakableEmail({ email, className = '' }: { email: string; className?: string }) {
    const at = email.indexOf('@');
    const local = at > 0 ? email.slice(0, at) : email;
    const localParts = at > 0 ? local.split('.') : [local];
    const domain = at > 0 ? email.slice(at + 1).split('.') : [];
    return (
        <span className={`[overflow-wrap:anywhere] ${className}`}>
            {localParts.map((part, i) => <Fragment key={`l${i}`}>{i > 0 && <>.<wbr /></>}{part}</Fragment>)}
            {at > 0 && <><wbr />@{domain.map((part, i) => <Fragment key={i}>{i > 0 && <><wbr />.</>}{part}</Fragment>)}</>}
        </span>
    );
}
