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
import { Check, X, Phone, Mail, AtSign, IdCard, MapPin, User } from 'lucide-react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { ContactComposer, draftPlatform, type ComposerDraft } from '@/components/ContactComposer';
import { HouseholdCandidateCard } from '@/components/household/HouseholdCandidateCard';
import { RELATIONSHIPS, type Relationship } from '@/lib/householdMembers';
import type { ContactEntryType } from '@/lib/contactEntries';
import { MINOR_AGE_LIMIT } from '@/domain/households';
import { isValidAge } from '@/domain/profileIdentity';
import { addHouseholdPerson, changeProfileAge, changeProfileName, checkHouseholdPersonEdit, getHouseholdMatchCandidates, updateHouseholdMembership } from '@/app/actions';
import type { HouseholdContactInput, HouseholdMatchCandidate } from '@/app/actions/households';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { householdErrorCopy, fill, joinNames } from '@/lib/householdCopy';

/** One field style for every input and select here: ≥ 44px, the same text size (16px: no zoom on iOS), theme-remapped colours. */
const FIELD = 'w-full min-h-[44px] px-3 border border-stone-200 rounded-lg bg-white text-base text-stone-900 outline-none focus:border-teal-500';
const ICON: Partial<Record<ContactEntryType, typeof Phone>> = { phone: Phone, email: Mail, social: AtSign, id: IdCard, address: MapPin, alias: User };

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

/** «Es menor de edad»: always shown; with an age typed it follows the age and is locked. */
function MinorCheckbox({ age, value, onChange }: { age: string; value: boolean; onChange: (v: boolean) => void }) {
    const { t } = useLanguage();
    const n = age.trim() === '' ? null : Number(age);
    const byAge = n !== null && Number.isFinite(n);
    return (
        <label className="inline-flex min-h-[44px] items-center gap-2 text-sm text-stone-700 cursor-pointer" data-testid="hh-minor-checkbox">
            {/* Follows a typed age and can't be changed then — kept readable (teal, as the approved A5/E1), not greyed out. */}
            <input type="checkbox" checked={byAge ? (n as number) < MINOR_AGE_LIMIT : value} aria-readonly={byAge || undefined}
                onChange={e => { if (!byAge) onChange(e.target.checked); }} className="w-4 h-4 accent-teal-600" />
            {t('adopter.age_minor_box')}
        </label>
    );
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
                <label className="block text-[11px] font-semibold text-stone-500 mb-1" htmlFor={ids.name}>{t('adopter.hh_name')}</label>
                <input id={ids.name} autoFocus type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('adopter.hh_name_ph')}
                    data-testid="hh-person-name" className={FIELD} />
                {renameHint && <p className="text-[11px] text-stone-500 mt-1">{t('adopter.rename_hint')}</p>}
            </div>
            <div className="flex gap-2 flex-wrap">
                {showRelationship && (
                    <div className="flex-1 min-w-[140px]">
                        <label className="block text-[11px] font-semibold text-stone-500 mb-1" htmlFor={ids.rel}>
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
                    <label className="block text-[11px] font-semibold text-stone-500 mb-1" htmlFor={ids.age}>{t('adopter.hh_age')}</label>
                    <input id={ids.age} type="number" inputMode="numeric" min={0} max={120} step={1} value={age} onChange={e => setAge(e.target.value)}
                        data-testid="hh-person-age" className={FIELD} />
                </div>
            </div>
            <MinorCheckbox age={age} value={minor} onChange={setMinor} />
        </>
    );
}

function FormButtons({ busy, onCancel, onSave, canSave = true }: { busy: boolean; onCancel: () => void; onSave?: () => void; canSave?: boolean }) {
    const { t } = useLanguage();
    return (
        <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={onCancel} disabled={busy} data-testid="hh-form-cancel"
                className="min-h-[44px] text-xs font-medium px-3 py-1.5 rounded text-stone-700 bg-stone-100 hover:bg-stone-200 disabled:opacity-50">
                <X className="w-3.5 h-3.5 inline" /> {t('adopter.ce_edit_cancel')}
            </button>
            {onSave && (
                <button type="button" onClick={onSave} disabled={busy || !canSave} data-testid="hh-form-save"
                    className="min-h-[44px] text-xs font-semibold px-3.5 py-1.5 rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40">
                    <Check className="w-3.5 h-3.5 inline" /> {t('adopter.ce_edit_save')}
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
            toast.success(t('adopter.hh_edit_saved'));
            onDone();
            router.refresh();
        } catch (e) {
            fail.thrown(e);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="space-y-2" data-testid="hh-edit-form">
            <PersonFields name={name} setName={setName} rel={rel} setRel={setRel} relativeName={relativeName} age={age} setAge={setAge}
                minor={minor} setMinor={setMinor} renameHint showRelationship={showRelationship} />
            <FormButtons busy={busy} onCancel={onDone} onSave={save} canSave={!!name.trim()} />
        </div>
    );
}

type Draft = HouseholdContactInput & { key: string };

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
    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [busy, setBusy] = useState(false);
    const [checking, setChecking] = useState(false);
    /** null = not checked yet; [] = checked, nobody (left). */
    const [candidates, setCandidates] = useState<HouseholdMatchCandidate[] | null>(null);
    /** The «¿Es este perfil?» check failed (its errorId): the rescuer retries or adds as new, knowingly. */
    const [checkFailed, setCheckFailed] = useState<string | null>(null);

    const hasIdentifier = !!name.trim() || drafts.length > 0;
    const contactInputs = (): HouseholdContactInput[] => drafts.map(({ key: _key, ...c }) => c);
    // Anything typed after the check makes it stale.
    const edited = <T,>(set: (v: T) => void) => (v: T) => { set(v); setCandidates(null); };

    async function add(existingProfileId?: string) {
        const n = age.trim() === '' ? null : Number(age);
        if (n !== null && !isValidAge(n)) { toast.warning(t('adopter.age_invalid')); return; }
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
        setChecking(true);
        setCheckFailed(null);
        let found: HouseholdMatchCandidate[] = [];
        try {
            const res = await getHouseholdMatchCandidates({ name: name.trim() || undefined, contactEntries: contactInputs(), anchorAdopterId });
            if (res.failed) {
                // Never a silent «new»: say the check failed (with its id) and let the rescuer choose.
                const errorId = res.errorId ?? resolveErrorId(new Error('getHouseholdMatchCandidates: failed'), 'AddPersonForm.candidates');
                toast.warning(t('adopter.hh_add_check_failed'), `ID: ${errorId}`);
                setCheckFailed(errorId);
                return;
            }
            found = res.results.filter(r => r.adopterId !== anchorAdopterId && !excludeIds.includes(r.adopterId)).slice(0, 3);
        } catch (e) {
            if (handledAsStale(e)) return;
            const errorId = resolveErrorId(e, 'AddPersonForm.candidates');
            toast.warning(t('adopter.hh_add_check_failed'), `ID: ${errorId}`);
            setCheckFailed(errorId);
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
        <div className="border border-stone-200 rounded-xl p-3.5 bg-stone-50" data-testid="hh-add-form">
            <div className="space-y-2">
                <PersonFields name={name} setName={edited(setName)} rel={rel} setRel={setRel} relativeName={relativeName}
                    age={age} setAge={setAge} minor={minor} setMinor={setMinor} />
                <div className="pt-1">
                    <div className="block text-[11px] font-semibold text-stone-500 mb-1">{t('adopter.hh_contacts_label')}</div>
                    {drafts.length > 0 && (
                        <ul className="space-y-1.5 mb-1">
                            {drafts.map(c => {
                                const Icon = ICON[c.type] ?? AtSign;
                                return (
                                    <li key={c.key} className="flex items-center gap-2 text-sm min-w-0" data-testid="hh-add-draft">
                                        <Icon className="w-4 h-4 shrink-0 text-teal-600" aria-hidden="true" />
                                        <span className="w-20 shrink-0 text-stone-500 text-xs">{t(`adopter.ce_type_${c.type}`)}</span>
                                        <span className="flex-1 min-w-0 truncate text-stone-800">{c.value}</span>
                                        <button type="button" aria-label={t('adopter.ce_remove')} disabled={busy}
                                            onClick={() => { setDrafts(prev => prev.filter(d => d.key !== c.key)); setCandidates(null); }}
                                            className="inline-flex min-w-[44px] min-h-[44px] items-center justify-center text-stone-500 hover:text-red-600 rounded">
                                            <X className="w-3.5 h-3.5" />
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <ContactComposer
                        disabled={busy}
                        onSubmit={async (d: ComposerDraft) => {
                            const platform = draftPlatform(d);
                            setDrafts(prev => [...prev, {
                                key: `d${Date.now()}-${prev.length}`, type: d.type, value: d.value.trim(),
                                ...(platform ? { platform } : {}), ...(d.type === 'phone' && d.apps.length ? { apps: d.apps } : {}),
                            }]);
                            setCandidates(null);
                            return true;
                        }}
                        triggerTestId="hh-add-contact"
                        testIdPrefix="hh-add-contact"
                    />
                </div>
                {!hasIdentifier && <p className="text-xs text-stone-500">{t('adopter.hh_add_hint')}</p>}
                {checking && <p className="text-xs text-stone-500" role="status">{t('adopter.hh_add_checking')}</p>}
                {checkFailed && !checking && (
                    <div role="alert" data-testid="hh-add-check-failed" className="rounded-lg border px-3 py-2 text-xs space-y-2"
                        style={{ background: 'var(--status-warning-bg)', borderColor: 'var(--status-warning-border)', color: 'var(--status-warning-text)' }}>
                        <p className="break-words">{t('adopter.hh_add_check_failed')} {t('adopter.hh_add_check_failed_hint')} (ID: {checkFailed})</p>
                        <button type="button" disabled={busy} onClick={() => { setCheckFailed(null); void add(); }} data-testid="hh-add-anyway"
                            className="inline-flex min-h-[44px] items-center px-3 text-sm font-semibold rounded-md border border-stone-200 bg-white text-stone-800 hover:bg-teal-50 disabled:opacity-50">
                            {t('adopter.hh_add_anyway')}
                        </button>
                    </div>
                )}
                {current && (
                    <HouseholdCandidateCard candidate={current} busy={busy} onYes={() => { void add(current.adopterId); }} onNo={() => { void no(); }} />
                )}
                <FormButtons busy={busy || checking} onCancel={onDone} onSave={current ? undefined : save} canSave={hasIdentifier} />
            </div>
        </div>
    );
}
