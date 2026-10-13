/**
 * The adopter's own copy of the contract they just signed: the PDF was built
 * in their browser (contractPdf.ts), so it is handed back as a download right
 * there — nothing is fetched or exposed. (There is no adopter-facing place to
 * see it later yet; Jon, 2026-10-13.)
 */

/** "contrato-luna-2026-10-13.pdf": readable, filesystem-safe, dated. */
export function contractCopyFileName(animalName: string | null | undefined, date = new Date()): string {
    const slug = (animalName ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
    const day = date.toISOString().slice(0, 10);
    return `contrato-${slug ? `${slug}-` : ''}${day}.pdf`;
}

/** Start the download of a data: URL as a file (a Blob URL works on more browsers than a long data: link). */
export async function downloadDataUrl(dataUrl: string, fileName: string): Promise<void> {
    const blob = await (await fetch(dataUrl)).blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
