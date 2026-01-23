'use client';

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveAdopter } from "@/app/actions";
import { SmartText } from "@/components/SmartText";
import { useLanguage } from "@/context/LanguageContext";

interface EditableSectionProps {
    title: string;
    value: string; // Text content
    type?: 'text' | 'smart-contact' | 'smart-address';
    placeholder?: string;
    isNew?: boolean;
    onSave: (newValue: string) => Promise<void>;
}

function EditableSection({ title, value, type = 'text', placeholder, isNew, onSave }: EditableSectionProps) {
    const { t } = useLanguage();
    const [isEditing, setIsEditing] = useState(isNew);
    const [tempValue, setTempValue] = useState(value);
    const [loading, setLoading] = useState(false);

    const handleSave = async () => {
        setLoading(true);
        try {
            await onSave(tempValue);
            if (!isNew) {
                setIsEditing(false);
            }
        } catch (e) {
            console.error(e);
            alert("Failed to save");
        } finally {
            setLoading(false);
        }
    };

    const handleCancel = () => {
        setTempValue(value);
        setIsEditing(false);
    };

    if (isEditing) {
        return (
            <div className="space-y-2 p-4 bg-white border border-blue-200 rounded-lg shadow-sm">
                <label className="text-sm font-bold text-blue-600 uppercase tracking-wider">{title}</label>
                {type === 'text' ? (
                    <input
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        value={tempValue}
                        onChange={e => setTempValue(e.target.value)}
                        placeholder={placeholder}
                    />
                ) : (
                    <textarea
                        rows={type === 'smart-address' ? 4 : 6}
                        className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                        value={tempValue}
                        onChange={e => setTempValue(e.target.value)}
                        placeholder={placeholder}
                    />
                )}
                <div className="flex justify-end gap-2 mt-2">
                    {!isNew && (
                        <button
                            onClick={handleCancel}
                            disabled={loading}
                            className="px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 rounded"
                        >
                            {t('common.cancel')}
                        </button>
                    )}
                    <button
                        onClick={handleSave}
                        disabled={loading}
                        className="px-3 py-1 text-sm bg-blue-600 text-white hover:bg-blue-700 rounded shadow-sm"
                    >
                        {loading ? t('common.loading') : t('common.save')}
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            onClick={() => setIsEditing(true)}
            className="group cursor-pointer p-4 bg-transparent border border-transparent hover:bg-white hover:border-gray-200 hover:shadow-sm rounded-lg transition-all duration-200"
        >
            <div className="flex justify-between items-center mb-2">
                <label className="text-xs font-bold text-gray-400 uppercase tracking-wider group-hover:text-blue-500 transition-colors">
                    {title}
                </label>
                <span className="opacity-0 group-hover:opacity-100 text-xs text-blue-500 font-medium">{t('common.edit')}</span>
            </div>

            {/* Display View */}
            {value ? (
                type === 'smart-contact' ? (
                    <SmartText text={value} type="contact" className="text-sm text-gray-800" />
                ) : type === 'smart-address' ? (
                    <SmartText text={value} type="address" className="text-sm text-gray-800" />
                ) : (
                    <div className="text-lg font-medium text-gray-900">{value}</div>
                )
            ) : (
                <div className="text-sm text-gray-400 italic">Example: {placeholder?.split('\n')[0]}...</div>
            )}
        </div>
    );
}

export function AdopterForm({ initialData }: { initialData?: any }) {
    const router = useRouter();
    const { t } = useLanguage();

    // Core state matches DB schema
    const [data, setData] = useState({
        id: initialData?.id || '',
        name: initialData?.name || '',
        status: initialData?.status || 'good',
        contactInfo: initialData?.contactInfo || '',
        addressInfo: initialData?.addressInfo || '',
    });

    const isNew = !initialData?.id;

    const handleSaveField = async (field: keyof typeof data, val: string) => {
        const newData = { ...data, [field]: val };

        // Optimistic update
        setData(newData);

        // Save entire object (actions.ts handles diffing efficiently)
        const res = await saveAdopter(newData);

        if (res.success) {
            if (isNew) {
                router.push(`/adopter/${res.id}`);
            } else {
                router.refresh();
            }
        }
    };

    return (
        <div className="space-y-6">
            {/* Status Dropdown (Always visible/interactive for simplicity, or make it custom too) */}
            <div className="p-4 border-b border-gray-100 flex justify-end">
                <select
                    className={`px-3 py-1 text-sm font-medium rounded-full border-0 cursor-pointer focus:ring-2 focus:ring-offset-2
                        ${data.status === 'good' ? 'bg-green-100 text-green-800 hover:bg-green-200' : ''}
                        ${data.status === 'warning' ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200' : ''}
                        ${data.status === 'blocked' ? 'bg-red-100 text-red-800 hover:bg-red-200' : ''}
                    `}
                    value={data.status}
                    onChange={async (e) => handleSaveField('status', e.target.value)}
                >
                    <option value="good">{t('adopter.status')}: {t('adopter.status_good')}</option>
                    <option value="warning">{t('adopter.status')}: {t('adopter.status_warning')}</option>
                    <option value="blocked">{t('adopter.status')}: {t('adopter.status_blocked')}</option>
                </select>
            </div>

            <div className="grid grid-cols-1 gap-4">
                <EditableSection
                    title={t('adopter.name')}
                    value={data.name}
                    type="text"
                    placeholder={t('adopter.placeholder_name')}
                    isNew={isNew}
                    onSave={(val) => handleSaveField('name', val)}
                />

                <EditableSection
                    title={t('adopter.contact')}
                    value={data.contactInfo}
                    type="smart-contact"
                    placeholder={t('adopter.placeholder_contact')}
                    isNew={isNew}
                    onSave={(val) => handleSaveField('contactInfo', val)}
                />

                <EditableSection
                    title={t('adopter.address')}
                    value={data.addressInfo}
                    type="smart-address"
                    placeholder={t('adopter.placeholder_address')}
                    isNew={isNew}
                    onSave={(val) => handleSaveField('addressInfo', val)}
                />
            </div>
        </div>
    );
}
