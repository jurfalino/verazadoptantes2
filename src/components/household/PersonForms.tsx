'use client';

/**
 * The two household forms (households as profiles, prototype E1/E2, A1–A5):
 *
 * - `EditMemberForm` («⋯ → Editar»): one form, the same for everyone signed in —
 *   name, relationship, age and «Es menor de edad». The name and age belong to
 *   the person's PROFILE (changeProfileName / changeProfileAge: the old name is
 *   kept as «Conocido/a como», the owner's team is told with «Deshacer»); the
 *   relationship to the membership (updateHouseholdMembership). Only what was
 *   changed is sent, each with the value shown when the form opened, so a
 *   teammate's newer change is never overwritten silently («conflict»).
 * - `AddPersonForm` («Agregar familiar / conviviente»): name, relationship, age,
 *   «Es menor de edad» and contacts; on «Guardar» the duplicate check runs
 *   (getHouseholdMatchCandidates, the «Nuevo adoptante» check) and every likely
 *   match is offered as «¿Es este perfil?» — «Sí» links that profile, «No»
 *   moves on, and with none left a new profile is made.
 *
 * The «Es menor de edad» box is always shown; with an age typed it follows the
 * age and is locked (ticked under 18, unticked from 18 — a known age decides).
 */
import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, X } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import ContactEntriesSection from '@/components/ContactEntriesSection';
import { INLINE_CANCEL_BTN, INLINE_SAVE_BTN } from '@/components/ui/inlineFormButtons';
import { HouseholdCandidateCard } from '@/components/household/HouseholdCandidateCard';
import { RELATIONSHIPS, type Relationship } from '@/lib/householdMembers';
import type { ContactEntry } from '@/lib/contactEntries';
import { MINOR_AGE_LIMIT } from '@/domain/households';
import { isValidAge } from '@/domain/profileIdentity';
import { addHouseholdPerson, changeProfileAge, changeProfileName, checkHouseholdPersonEdit, getHouseholdMatchCandidates, updateHouseholdMembership } from '@/app/actions';
import type { HouseholdContactInput, HouseholdMatchCandidate } from '@/app/actions/households';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { householdErrorCopy, fill, joinNames } from '@/lib/householdCopy';
import { MinorCheckbox } from '@/components/MinorCheckbox';

/**
 * The inputs of the profile's own inline forms (ContactEntriesSection's composer): these fields sit right
 * above that composer in the same form, so they look like it — 16px on a phone (no iOS zoom), 14px from `sm:`.
 */
const FIELD = 'w-full min-h-[44px] sm:min-h-0 px-2 py-1.5 border border-stone-300 rounded bg-white text-base sm:text-sm text-stone-900 outline-none focus:border-teal-500';
/** A field's label: the composer's own small label (ce_phone_apps / ce_social_which). */
const LABEL = 'block text-xs font-semibold text-stone-500 mb-1';

type Fail = { error: string; errorId?: string };

/** The household forms' failure handling: an expected refusal is a warning; a failure an error toast with its id. */
export function useHouseholdFailure(source: string) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    return {
        refused(res: Fail): void {
            const copy = householdErrorCopy(t, res.error);
            if (copy.refused) {
                toast.warning(copy.message);
                if (res.error === 'not_found' || res.error === 'conflict') router.refresh();
                return;
            }
            toast.error(t('errors.generic'), copy.message, res.errorId ?? resolveErrorId(new Error(`${source}: ${res.error}`), source));
        },
        thrown(e: unknown): void {
            if (!handledAsStale(e)) toast.error(t('errors.generic'), t('adopter.hh_err_failed'), resolveErrorId(e, source));
        },
        /** The action stood, but a later step (history, notices) failed under this id. */
        partial(warningErrorId: string | undefined): void {
            if (warningErrorId) toast.warning(t('adopter.hh_err_partial'), `ID: ${warningErrorId}`);
        },
    };
}

function PersonFields({ name, setName, rel, setRel, relativeName, age, setAge, minor, setMinor, renameHint = false, showRelationship = true }: {
    name: string; setName: (v: string) => void;
    rel: Relationship | ''; setRel: (v: Relationship | '') => void;
    /** «Parentesco de Pedro»: who the relationship points at (first name). */
    relativeName: string;
    age: string; setAge: (v: string) => void; minor: boolean; setMinor: (v: boolean) => void;
    renameHint?: boolean;
    showRelationship?: boolean;
}) {
    const { t } = useLanguage();
    // Unique per form: the add form and a card's «Editar» can be open at once.
    const uid = useId();
    const ids = { name: `${uid}-name`, rel: `${uid}-rel`, age: `${uid}-age` };
    return (
        <>
            <div>
                <label className={LABEL} htmlFor={ids.name}>{t('adopter.hh_name')}</label>
                <input id={ids.name} autoFocus type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('adopter.hh_name_ph')}
                    data-testid="hh-person-name" className={FIELD} />
                {renameHint && <p className="text-xs text-stone-500 mt-1">{t('adopter.rename_hint')}</p>}
            </div>
            <div className="flex gap-2 flex-wrap">
                {showRelationship && (
                    <div className="flex-1 min-w-[140px]">
                        <label className={LABEL} htmlFor={ids.rel}>
                            {relativeName ? fill(t('adopter.hh_rel_of_label'), { name: relativeName }) : t('adopter.hh_rel')}
                        </label>
                        <select id={ids.rel} value={rel} onChange={e => setRel(e.target.value as Relationship | '')} data-testid="hh-person-rel"
                            className={FIELD}>
                            <option value="">{t('adopter.hh_rel_choose')}</option>
                            {RELATIONSHIPS.filter(r => r !== 'unknown').map(r => <option key={r} value={r}>{t(`adopter.hh_rel_${r}`)}</option>)}
                        </select>
                    </div>
                )}
                <div className="w-24">
                    <label className={LABEL} htmlFor={ids.age}>{t('adopter.hh_age')}</label>
                    <input id={ids.age} type="number" inputMode="numeric" min={0} max={120} step={1} value={age} onChange={e => setAge(e.target.value)}
                        data-testid="hh-person-age" className={FIELD} />
                </div>
            </div>
            <MinorCheckbox age={age} value={minor} onChange={setMinor} testId="hh-minor-checkbox" />
        </>
    );
}

function FormButtons({ busy, onCancel, onSave, canSave = true }: { busy: boolean; onCancel: () => void; onSave?: () => void; canSave?: boolean }) {
    const { t } = useLanguage();
    return (
        <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={onCancel} disabled={busy} data-testid="hh-form-cancel" className={INLINE_CANCEL_BTN}>
                <X className="w-3.5 h-3.5" /> {t('adopter.ce_edit_cancel')}
            </button>
            {onSave && (
                <button type="button" onClick={onSave} disabled={busy || !canSave} data-testid="hh-form-save" className={INLINE_SAVE_BTN}>
                    <Check className="w-3.5 h-3.5" /> {t('adopter.ce_edit_save')}
                </button>
            )}
        </div>
    );
}

const ageText = (age: number | null) => (age === null ? '' : String(age));

/** «⋯ → Editar» on one member card. */
export function EditMemberForm({ member, relativeName, onDone }: {
    member: { profileId: string; membershipId: string; name: string; relationship: Relationship; relativeToAdopterId: string | null; age: number | null; isMinor: boolean };
    relativeName: string;
    onDone: () => void;
}) {
    const router = useRouter();
    const toast = useShowToast();
    const { t } = useLanguage();
    const fail = useHouseholdFailure('EditMemberForm');
    const [name, setName] = useState(member.name);
    const [rel, setRel] = useState<Relationship | ''>(member.relationship === 'unknown' ? '' : member.relationship);
    const [age, setAge] = useState(ageText(member.age));
    const [minor, setMinor] = useState(member.isMinor);
    const [busy, setBusy] = useState(false);
    const showRelationship = !!member.relativeToAdopterId;

    async function save() {
        const n = age.trim() === '' ? null : Number(age);
        if (n !== null && !isValidAge(n)) { toast.warning(t('adopter.age_invalid')); return; }
        const boxNow = n !== null ? n < MINOR_AGE_LIMIT : minor;
        const relNow = rel || 'unknown';
        const nameChanged = !!name.trim() && name.trim() !== member.name.trim();
        const relChanged = showRelationship && relNow !== member.relationship;
        const ageChanged = n !== member.age || boxNow !== member.isMinor;
        setBusy(true);
        try {
            // Final fix P1: every field is checked BEFORE any is saved — a teammate's change to
            // one of them closes the form and shows how it is now, nothing half-saved.
            if (nameChanged || relChanged || ageChanged) {
                const check = await checkHouseholdPersonEdit({
                    profileId: member.profileId,
                    ...(relChanged ? { membershipId: member.membershipId } : {}),
                    expected: {
                        ...(nameChanged ? { name: member.name } : {}),
                        ...(relChanged ? { relationship: member.relationship } : {}),
                        ...(ageChanged ? { age: member.age, isMinor: member.isMinor } : {}),
                    },
                });
                if (!check.ok) { fail.refused(check); return; }
                if (check.conflicts.length) {
                    toast.warning(t('adopter.hh_err_conflict'));
                    onDone();
                    router.refresh();
                    return;
                }
            }
            if (nameChanged) {
                const res = await changeProfileName({ adopterId: member.profileId, name: name.trim(), expectedName: member.name });
                if (!res.ok) { fail.refused(res as Fail); if (res.error === 'conflict') onDone(); return; }
                fail.partial(res.warningErrorId);
            }
            if (relChanged) {
                const res = await updateHouseholdMembership({ membershipId: member.membershipId, relationship: relNow, expected: member.relationship });
                if (!res.ok) { fail.refused(res); if (res.error === 'conflict') onDone(); return; }
            }
            if (ageChanged) {
                const res = await changeProfileAge({ adopterId: member.profileId, age: n, isMinor: boxNow, expected: { age: member.age, isMinor: member.isMinor } });
                if (!res.ok) { fail.refused(res); if (res.error === 'conflict') onDone(); return; }
                fail.partial(res.warningErrorId);
            }
            toast.success('✓', t('adopter.hh_edit_saved'));
            onDone();
            router.refresh();
        } catch (e) {
            fail.thrown(e);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-3" data-testid="hh-edit-form">
            <PersonFields name={name} setName={setName} rel={rel} setRel={setRel} relativeName={relativeName} age={age} setAge={setAge}
                minor={minor} setMinor={setMinor} renameHint showRelationship={showRelationship} />
            <FormButtons busy={busy} onCancel={onDone} onSave={save} canSave={!!name.trim()} />
        </div>
    );
}

/** A contact as the server takes it (the list's local ids stay here). */
const asInput = (c: ContactEntry): HouseholdContactInput => ({
    type: c.type, value: c.value,
    ...(c.streetAndNumber ? { streetAndNumber: c.streetAndNumber } : {}),
    ...(c.locality ? { locality: c.locality } : {}),
    ...(c.platform ? { platform: c.platform } : {}),
    ...(c.apps?.length ? { apps: c.apps } : {}),
});

/** «Agregar familiar / conviviente»: the person, then «¿Es este perfil?», then the add. */
export function AddPersonForm({ anchorAdopterId, householdId, hostName, relativeName, othersInHome, excludeIds, onDone }: {
    anchorAdopterId: string;
    /** The household the button sits in; none = the anchor's own household (made when it has none). */
    householdId?: string;
    hostName: string;
    relativeName: string;
    /** The other people already in that household, for «también en el perfil de …». */
    othersInHome: string[];
    /** Profiles already in that household: never offered as «¿Es este perfil?». */
    excludeIds: string[];
    onDone: () => void;
}) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const router = useRouter();
    const fail = useHouseholdFailure('AddPersonForm');
    const [name, setName] = useState('');
    const [rel, setRel] = useState<Relationship | ''>('');
    const [age, setAge] = useState('');
    const [minor, setMinor] = useState(false);
    const [drafts, setDrafts] = useState<ContactEntry[]>([]);
    /**
     * A contact is being written (added, or edited in place): its own «Cancelar / Guardar» are the only
     * buttons that act — the form's pair is hidden and «Sí / No» / «Agregar como persona nueva» disabled.
     */
    const [composing, setComposing] = useState(false);
    const [busy, setBusy] = useState(false);
    const [checking, setChecking] = useState(false);
    /** null = not checked yet; [] = checked, nobody (left). */
    const [candidates, setCandidates] = useState<HouseholdMatchCandidate[] | null>(null);
    /** The «¿Es este perfil?» check failed (its errorId): the rescuer retries or adds as new, knowingly. */
    const [checkFailed, setCheckFailed] = useState<string | null>(null);

    const hasIdentifier = !!name.trim() || drafts.length > 0;
    const contactInputs = (): HouseholdContactInput[] => drafts.map(asInput);
    // Anything typed after the check makes it stale.
    const edited = <T,>(set: (v: T) => void) => (v: T) => { set(v); setCandidates(null); };

    /** The typed age, or undefined (after the warning) when it is not a valid one. */
    function validAge(): number | null | undefined {
        const n = age.trim() === '' ? null : Number(age);
        if (n !== null && !isValidAge(n)) { toast.warning(t('adopter.age_invalid')); return undefined; }
        return n;
    }

    async function add(existingProfileId?: string) {
        const n = validAge();
        if (n === undefined) return;
        setBusy(true);
        try {
            const res = await addHouseholdPerson({
                anchorAdopterId,
                ...(householdId ? { householdId } : {}),
                ...(existingProfileId ? { existingProfileId } : { name: name.trim(), age: n, isMinor: n === null && minor }),
                ...(rel ? { relationship: rel } : {}),
                contactEntries: contactInputs(),
            });
            if (!res.ok) { fail.refused(res); return; }
            const shownName = existingProfileId ? (candidates?.find(c => c.adopterId === existingProfileId)?.adopter.name ?? name.trim()) : name.trim();
            const who = shownName || t('adopter.nameless');
            toast.success(fill(t('adopter.hh_added_title'), { name: who }),
                othersInHome.length
                    ? fill(t('adopter.hh_added_body_others'), { host: hostName, others: joinNames(t, othersInHome) })
                    : fill(t('adopter.hh_added_body'), { host: hostName }));
            if (res.autoRequestFiled) toast.info(t('adopter.ce_add_toast_added_with_request'));
            fail.partial(res.warningErrorId);
            onDone();
            router.refresh();
        } catch (e) {
            fail.thrown(e);
        } finally {
            setBusy(false);
        }
    }

    async function save() {
        if (!hasIdentifier) return;
        // The age is checked BEFORE «¿Es este perfil?»: never ask about a form that then can't be saved.
        if (validAge() === undefined) return;
        setChecking(true);
        setCheckFailed(null);
        let found: HouseholdMatchCandidate[] = [];
        try {
            const res = await getHouseholdMatchCandidates({ name: name.trim() || undefined, contactEntries: contactInputs(), anchorAdopterId });
            if (res.failed) {
                // Never a silent «new»: the panel below says the check failed (with its id) and lets the rescuer choose.
                // One message, in the form — not a toast repeating it.
                setCheckFailed(res.errorId ?? resolveErrorId(new Error('getHouseholdMatchCandidates: failed'), 'AddPersonForm.candidates'));
                return;
            }
            found = res.results.filter(r => r.adopterId !== anchorAdopterId && !excludeIds.includes(r.adopterId)).slice(0, 3);
        } catch (e) {
            if (handledAsStale(e)) return;
            setCheckFailed(resolveErrorId(e, 'AddPersonForm.candidates'));
            return;
        } finally {
            setChecking(false);
        }
        if (found.length > 0) { setCandidates(found); return; }
        await add();
    }

    async function no() {
        const rest = (candidates ?? []).slice(1);
        if (rest.length > 0) { setCandidates(rest); return; }
        setCandidates([]);
        await add();
    }

    const current = candidates && candidates.length > 0 ? candidates[0] : null;

    return (
        // A row being written, like the profile's composer: no grey card (it read as a dark hole in Azul
        // Noche), aligned with the names above it, the list's own separator on top.
        <div className="pl-10 pt-3 border-t border-stone-100" data-testid="hh-add-form">
            <div className="space-y-3">
                <PersonFields name={name} setName={edited(setName)} rel={rel} setRel={setRel} relativeName={relativeName}
                    age={age} setAge={setAge} minor={minor} setMinor={setMinor} />
                <div>
                    <div className={LABEL}>{t('adopter.hh_contacts_label')}</div>
                    {/* The profile's own contact list, in local mode (as the new-adopter form and the import
                        wizard): same rows, same «Agregar dato de contacto», same composer. */}
                    <ContactEntriesSection
                        entries={drafts}
                        onChange={next => { setDrafts(next); setCandidates(null); }}
                        canEditAll
                        hideVisibilityMicrocopy
                        emptyMessage={null}
                        startComposer="closed"
                        testIdPrefix="hh-add-contact"
                        onComposerOpenChange={setComposing}
                    />
                </div>
                {!hasIdentifier && <p className="text-xs text-stone-500">{t('adopter.hh_add_hint')}</p>}
                {checking && <p className="text-xs text-stone-500" role="status">{t('adopter.hh_add_checking')}</p>}
                {checkFailed && !checking && (
                    <div role="alert" data-testid="hh-add-check-failed" className="rounded-lg border px-3 py-2 text-xs space-y-2"
                        style={{ background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)', color: 'var(--status-warning-text)' }}>
                        <p className="break-words">{t('adopter.hh_add_check_failed')} {t('adopter.hh_add_check_failed_hint')} (ID: {checkFailed})</p>
                        <button type="button" disabled={busy || composing} onClick={() => { setCheckFailed(null); void add(); }} data-testid="hh-add-anyway"
                            className="inline-flex min-h-[44px] items-center px-3 text-sm font-semibold rounded-md border border-stone-200 bg-white text-stone-800 hover:bg-teal-50 disabled:opacity-50">
                            {t('adopter.hh_add_anyway')}
                        </button>
                    </div>
                )}
                {current && (
                    // Disabled while a contact is being written: «Sí»/«No» would save without it.
                    <HouseholdCandidateCard candidate={current} busy={busy || composing} onYes={() => { void add(current.adopterId); }} onNo={() => { void no(); }} />
                )}
                {/* One «Cancelar / Guardar» pair at a time: while a contact is being written its own pair
                    is the one that acts, so a typed phone can't be dropped by saving the person. */}
                {!composing && <FormButtons busy={busy || checking} onCancel={onDone} onSave={current ? undefined : save} canSave={hasIdentifier} />}
            </div>
        </div>
    );
}
