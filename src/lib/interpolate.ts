/**
 * Tiny `{var}` interpolation for user-editable message templates
 * (v2.55.16, animal-timeline PR3). `t()` deliberately has no interpolation;
 * follow-up messages need `{animal}`, `{familia}`, `{dias}`.
 * Unknown placeholders are left as-is so a typo'd template stays visible
 * instead of silently vanishing.
 */
export function interpolate(template: string, vars: Record<string, string | number | null | undefined>): string {
    return template.replace(/\{(\w+)\}/g, (match, key: string) => {
        const v = vars[key];
        return v === null || v === undefined ? match : String(v);
    });
}
