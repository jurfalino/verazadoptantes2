export const runtime = 'edge';

import { getDataQualityReport } from '@/app/actions/dataQuality';
import DataQualityReport from '@/components/admin/DataQualityReport';

export default async function AdminDataQualityPage() {
    const data = await getDataQualityReport();
    return (
        <div className="max-w-5xl mx-auto">
            <header className="mb-5">
                <h2 className="text-2xl font-semibold text-stone-900">Calidad de datos</h2>
                <p className="text-stone-500 text-sm">
                    Registros que probablemente necesiten limpieza. Las listas son en vivo: cada fila desaparece
                    automáticamente al limpiar la nota o fusionar el duplicado.
                </p>
            </header>
            <DataQualityReport data={data} />
        </div>
    );
}
