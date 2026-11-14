'use client';

/**
 * «¿Qué formulario y contrato usás al compartir?» — asked when her groups
 * change (spec 2026-11-13-group-branding-design.md, «Al cambiar de grupos»;
 * Jon 2026-11-14): after joining or creating a group that leaves her in ≥ 2,
 * and after leaving the group her links used while she still has one. The
 * server decides when (`askDocsSource` on joinOrganization /
 * createOrganization / leaveOrganization); this only shows and saves.
 *
 * The rows are the Settings card's (DocsSourceOptions), her current choice
 * pre-selected and marked «(el que usás)». «Listo» saves only a change;
 * closing keeps what she had (the server already pinned a sole-group default
 * before the join). Overview unreadable or the feature off → no dialog.
 *
 * Keep this file free of '@/domain/adoptionDocs' (zod at module scope).
 */

import { useEffect, useRef, useState } from 'react';
import { useLanguage } from '@/context/LanguageContext';
import { useShowToast } from '@/components/ui/Toast';
import { Modal, ModalText } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { resolveErrorId } from '@/lib/clientErrorReporter';
import { handledAsStale } from '@/lib/errorMessage';
import { fetchGroupBrandingFlag } from '@/lib/groupBrandingFlag';
import { getAdoptionDocsOverview, setAdoptionDocsSource } from '@/app/actions/adoptionDocs';
import { DocsSourceOptions, type DocsOverview } from '@/components/DocsSourceOptions';

const SOURCE = 'DocsSourceDialog';

export default function DocsSourceDialog({ onClose }: { onClose: () => void }) {
    const { t } = useLanguage();
    const toast = useShowToast();
    const [overview, setOverview] = useState<DocsOverview | null>(null);
    const [branding, setBranding] = useState(false);
    const [value, setValue] = useState('');
    const [saving, setSaving] = useState(false);
    const latestClose = useRef(onClose);
    useEffect(() => { latestClose.current = onClose; });

    useEffect(() => {
        let cancelled = false;
        async function load() {
            try {
                const [res, brandingOn] = await Promise.all([
                    getAdoptionDocsOverview(),
                    // Unreadable → the plain rows (same fallback as the Settings card), but say so.
                    fetchGroupBrandingFlag().catch((error) => { resolveErrorId(error, `${SOURCE}.brandingFlag`); return false; }),
                ]);
                if (cancelled) return;
                if (res?.success && res.data) {
                    setBranding(brandingOn);
                    setOverview(res.data);
                    setValue(res.data.source);
                    return;
                }
                // Disabled: nothing to ask. A failure: the join/leave already
                // happened and Settings still offers the choice — logged, no dialog.
                if (res?.error !== 'disabled') resolveErrorId(res, `${SOURCE}.overview`);
                latestClose.current();
            } catch (error) {
                if (cancelled) return;
                resolveErrorId(error, `${SOURCE}.overview`);
                latestClose.current();
            }
        }
        void load();
        return () => { cancelled = true; };
    }, []);

    if (!overview) return null;

    const done = async () => {
        if (value === overview.source) { onClose(); return; }
        setSaving(true);
        try {
            const res = await setAdoptionDocsSource(value);
            if (res?.success) {
                toast.success(t('settings.saved'));
                onClose();
                return;
            }
            const body = res?.error === 'disabled' ? t('adoptionDocs.disabled')
                : res?.error === 'forbidden' ? t('adoptionDocs.forbidden')
                : t('adoptionDocs.save_failed');
            toast.error(t('errors.generic'), body, res?.errorId || resolveErrorId(res, SOURCE));
        } catch (error) {
            if (!handledAsStale(error)) toast.error(t('errors.generic'), t('adoptionDocs.save_failed'), resolveErrorId(error, SOURCE));
        } finally {
            setSaving(false);
        }
    };

    const title = t('adoptionDocs.ask_title');
    return (
        <Modal title={title} onClose={onClose} busy={saving} testId="docs-source-dialog">
            <DocsSourceOptions
                overview={overview}
                value={value}
                onChange={setValue}
                branding={branding}
                disabled={saving}
                radioName="docs-source-dialog"
                legend={<legend className="sr-only">{title}</legend>}
                inUse={overview.source}
            />
            <ModalText testId="docs-source-dialog-hint">{t('adoptionDocs.ask_hint')}</ModalText>
            <div className="flex pt-1 sm:justify-end">
                <Button type="button" variant="primary" onClick={done} loading={saving} data-autofocus="" data-testid="docs-source-dialog-done" layoutClassName="flex-1 sm:flex-none">
                    {t('adoptionDocs.ask_done')}
                </Button>
            </div>
        </Modal>
    );
}
