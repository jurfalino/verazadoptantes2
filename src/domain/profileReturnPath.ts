/**
 * Where a signed-out visitor returns after signing in from a profile link:
 * the profile WITH its query — so the email's «Deshacer» (`?undoRename=`) or a
 * merge notice's `?dispute=` still opens its prompt after the login. The edge
 * runtime folds the route param into searchParams; it is dropped here. Pure.
 */
export function profileReturnPath(id: string, searchParams: Record<string, string | string[] | undefined>): string {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) {
        if (k === 'id' && v === id) continue;
        if (Array.isArray(v)) v.forEach(x => qs.append(k, x));
        else if (v !== undefined) qs.append(k, v);
    }
    const query = qs.toString();
    return `/adopter/${id}${query ? `?${query}` : ''}`;
}
