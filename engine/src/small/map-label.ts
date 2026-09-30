/** Display-only noun phrase. Shared by schema modules without importing the spatial runtime. */
export function safeLandmarkLabel(value: unknown): string | undefined {
    if (typeof value !== 'string' || value.length > 64)
        return undefined;
    const label = value.trim();
    return label && [...label].length <= 32 && /^[\p{L}\p{N} ·・—–\-()（）]+$/u.test(label) ? label : undefined;
}
