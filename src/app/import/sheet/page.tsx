import SpreadsheetImportWizard from '@/components/SpreadsheetImportWizard';

export const metadata = {
    title: 'Importar desde planilla',
};

export default function ImportSheetPage() {
    return (
        <div className="min-h-screen bg-stone-50 py-8">
            <SpreadsheetImportWizard />
        </div>
    );
}
