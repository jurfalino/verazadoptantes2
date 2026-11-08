'use client';

/**
 * «¿Entregado en casa del adoptante?» with its address — ONE block for the
 * create wizard and the edit form (F3), so a record asks the same thing however
 * it is opened: street and number + locality, the two halves the contact
 * entries' address uses, and the hint that it is saved to the person's contacts
 * (the server copies it there on save, src/lib/deliveryAddressCopy.ts).
 *
 * Which record types show it is decided by recordHandoverFields
 * (src/domain/recordEditAccess.ts); the parent renders this only where it says so.
 */
import { useLanguage } from '@/context/LanguageContext';

export interface DeliveryAddressValue {
    delivered: boolean;
    streetAndNumber: string;
    locality: string;
}

export default function DeliveryAddressBlock({ value, onChange, prefillStreet = '' }: {
    value: DeliveryAddressValue;
    onChange: (next: DeliveryAddressValue) => void;
    /** Seeds the street when delivery is switched on with the street still empty. */
    prefillStreet?: string;
}) {
    const { t } = useLanguage();
    const { delivered, streetAndNumber, locality } = value;
    const inputClass = 'w-full p-3 rounded-lg border border-blue-200 bg-white text-blue-950 placeholder-blue-800/40 font-medium focus:border-blue-500 focus:ring-4 focus:ring-blue-500/10 transition-all outline-none text-base md:text-sm';

    return (
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <span className="text-lg">🚗</span>
                    <label className="text-sm font-medium text-stone-800">{t('adoption.delivered_to_home')}</label>
                </div>
                {/* Switching ON seeds the street with what the profile's contact
                    text suggests; switching OFF clears both halves, so no stale
                    address rides along. */}
                <button
                    type="button"
                    role="switch"
                    aria-checked={delivered}
                    aria-label={t('adoption.delivered_to_home')}
                    data-testid="delivered-to-home-toggle"
                    onClick={() => onChange(delivered
                        ? { delivered: false, streetAndNumber: '', locality: '' }
                        : { delivered: true, streetAndNumber: streetAndNumber || prefillStreet, locality })}
                    className={`relative w-12 h-6 rounded-full transition-colors ${delivered ? 'bg-blue-500' : 'bg-stone-200'}`}
                >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${delivered ? 'translate-x-6' : 'translate-x-0'}`} />
                </button>
            </div>
            {delivered && (
                <div className="mt-4 pt-4 border-t border-blue-100 space-y-2">
                    <label className="block text-xs font-semibold text-stone-700 mb-1.5 uppercase tracking-wider flex items-center gap-1"><span>📍</span> {t('adoption.verify_address')}</label>
                    <input
                        type="text"
                        value={streetAndNumber}
                        onChange={e => onChange({ ...value, streetAndNumber: e.target.value })}
                        placeholder={t('adopter.ce_input_ph_address')}
                        data-testid="delivery-street"
                        className={inputClass}
                    />
                    <input
                        type="text"
                        value={locality}
                        onChange={e => onChange({ ...value, locality: e.target.value })}
                        placeholder={t('adopter.ce_input_ph_locality')}
                        data-testid="delivery-locality"
                        className={inputClass}
                    />
                    <p className="text-xs text-stone-600 flex items-start gap-1.5 pt-1">
                        <svg className="w-3.5 h-3.5 mt-px shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden="true">
                            <rect x="5" y="11" width="14" height="9" rx="2" />
                            <path strokeLinecap="round" d="M8 11V8a4 4 0 118 0v3" />
                        </svg>
                        <span>{t('adoption.verify_address_saved_hint')}</span>
                    </p>
                </div>
            )}
        </div>
    );
}
