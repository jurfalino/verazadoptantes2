import type { CustomQuestion } from '@/domain/interview/types';

export function questionText(t: (k: string) => string, id: string, custom: CustomQuestion[]): string {
    const c = custom.find(x => x.id === id);
    return c ? c.text : t(`interview.q.${id}`);
}
