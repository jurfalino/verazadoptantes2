// ISO 3166-1 alpha-2 country list with emoji flags
// LATAM countries first (primary user base), then rest alphabetically

export interface Country {
    code: string;
    name: string;
    nameEs: string;
    flag: string;
}

// LATAM countries (primary audience)
const latam: Country[] = [
    { code: 'AR', name: 'Argentina', nameEs: 'Argentina', flag: '🇦🇷' },
    { code: 'BO', name: 'Bolivia', nameEs: 'Bolivia', flag: '🇧🇴' },
    { code: 'BR', name: 'Brazil', nameEs: 'Brasil', flag: '🇧🇷' },
    { code: 'CL', name: 'Chile', nameEs: 'Chile', flag: '🇨🇱' },
    { code: 'CO', name: 'Colombia', nameEs: 'Colombia', flag: '🇨🇴' },
    { code: 'CR', name: 'Costa Rica', nameEs: 'Costa Rica', flag: '🇨🇷' },
    { code: 'CU', name: 'Cuba', nameEs: 'Cuba', flag: '🇨🇺' },
    { code: 'DO', name: 'Dominican Republic', nameEs: 'República Dominicana', flag: '🇩🇴' },
    { code: 'EC', name: 'Ecuador', nameEs: 'Ecuador', flag: '🇪🇨' },
    { code: 'SV', name: 'El Salvador', nameEs: 'El Salvador', flag: '🇸🇻' },
    { code: 'GT', name: 'Guatemala', nameEs: 'Guatemala', flag: '🇬🇹' },
    { code: 'HN', name: 'Honduras', nameEs: 'Honduras', flag: '🇭🇳' },
    { code: 'MX', name: 'Mexico', nameEs: 'México', flag: '🇲🇽' },
    { code: 'NI', name: 'Nicaragua', nameEs: 'Nicaragua', flag: '🇳🇮' },
    { code: 'PA', name: 'Panama', nameEs: 'Panamá', flag: '🇵🇦' },
    { code: 'PY', name: 'Paraguay', nameEs: 'Paraguay', flag: '🇵🇾' },
    { code: 'PE', name: 'Peru', nameEs: 'Perú', flag: '🇵🇪' },
    { code: 'PR', name: 'Puerto Rico', nameEs: 'Puerto Rico', flag: '🇵🇷' },
    { code: 'UY', name: 'Uruguay', nameEs: 'Uruguay', flag: '🇺🇾' },
    { code: 'VE', name: 'Venezuela', nameEs: 'Venezuela', flag: '🇻🇪' },
];

// Other countries (alphabetical)
const other: Country[] = [
    { code: 'AF', name: 'Afghanistan', nameEs: 'Afganistán', flag: '🇦🇫' },
    { code: 'AL', name: 'Albania', nameEs: 'Albania', flag: '🇦🇱' },
    { code: 'DZ', name: 'Algeria', nameEs: 'Argelia', flag: '🇩🇿' },
    { code: 'AD', name: 'Andorra', nameEs: 'Andorra', flag: '🇦🇩' },
    { code: 'AO', name: 'Angola', nameEs: 'Angola', flag: '🇦🇴' },
    { code: 'AU', name: 'Australia', nameEs: 'Australia', flag: '🇦🇺' },
    { code: 'AT', name: 'Austria', nameEs: 'Austria', flag: '🇦🇹' },
    { code: 'BD', name: 'Bangladesh', nameEs: 'Bangladés', flag: '🇧🇩' },
    { code: 'BE', name: 'Belgium', nameEs: 'Bélgica', flag: '🇧🇪' },
    { code: 'BZ', name: 'Belize', nameEs: 'Belice', flag: '🇧🇿' },
    { code: 'BG', name: 'Bulgaria', nameEs: 'Bulgaria', flag: '🇧🇬' },
    { code: 'CA', name: 'Canada', nameEs: 'Canadá', flag: '🇨🇦' },
    { code: 'CN', name: 'China', nameEs: 'China', flag: '🇨🇳' },
    { code: 'HR', name: 'Croatia', nameEs: 'Croacia', flag: '🇭🇷' },
    { code: 'CZ', name: 'Czech Republic', nameEs: 'República Checa', flag: '🇨🇿' },
    { code: 'DK', name: 'Denmark', nameEs: 'Dinamarca', flag: '🇩🇰' },
    { code: 'EG', name: 'Egypt', nameEs: 'Egipto', flag: '🇪🇬' },
    { code: 'FI', name: 'Finland', nameEs: 'Finlandia', flag: '🇫🇮' },
    { code: 'FR', name: 'France', nameEs: 'Francia', flag: '🇫🇷' },
    { code: 'DE', name: 'Germany', nameEs: 'Alemania', flag: '🇩🇪' },
    { code: 'GR', name: 'Greece', nameEs: 'Grecia', flag: '🇬🇷' },
    { code: 'HT', name: 'Haiti', nameEs: 'Haití', flag: '🇭🇹' },
    { code: 'HU', name: 'Hungary', nameEs: 'Hungría', flag: '🇭🇺' },
    { code: 'IN', name: 'India', nameEs: 'India', flag: '🇮🇳' },
    { code: 'ID', name: 'Indonesia', nameEs: 'Indonesia', flag: '🇮🇩' },
    { code: 'IE', name: 'Ireland', nameEs: 'Irlanda', flag: '🇮🇪' },
    { code: 'IL', name: 'Israel', nameEs: 'Israel', flag: '🇮🇱' },
    { code: 'IT', name: 'Italy', nameEs: 'Italia', flag: '🇮🇹' },
    { code: 'JM', name: 'Jamaica', nameEs: 'Jamaica', flag: '🇯🇲' },
    { code: 'JP', name: 'Japan', nameEs: 'Japón', flag: '🇯🇵' },
    { code: 'KE', name: 'Kenya', nameEs: 'Kenia', flag: '🇰🇪' },
    { code: 'KR', name: 'South Korea', nameEs: 'Corea del Sur', flag: '🇰🇷' },
    { code: 'MY', name: 'Malaysia', nameEs: 'Malasia', flag: '🇲🇾' },
    { code: 'MA', name: 'Morocco', nameEs: 'Marruecos', flag: '🇲🇦' },
    { code: 'NL', name: 'Netherlands', nameEs: 'Países Bajos', flag: '🇳🇱' },
    { code: 'NZ', name: 'New Zealand', nameEs: 'Nueva Zelanda', flag: '🇳🇿' },
    { code: 'NG', name: 'Nigeria', nameEs: 'Nigeria', flag: '🇳🇬' },
    { code: 'NO', name: 'Norway', nameEs: 'Noruega', flag: '🇳🇴' },
    { code: 'PK', name: 'Pakistan', nameEs: 'Pakistán', flag: '🇵🇰' },
    { code: 'PH', name: 'Philippines', nameEs: 'Filipinas', flag: '🇵🇭' },
    { code: 'PL', name: 'Poland', nameEs: 'Polonia', flag: '🇵🇱' },
    { code: 'PT', name: 'Portugal', nameEs: 'Portugal', flag: '🇵🇹' },
    { code: 'RO', name: 'Romania', nameEs: 'Rumanía', flag: '🇷🇴' },
    { code: 'RU', name: 'Russia', nameEs: 'Rusia', flag: '🇷🇺' },
    { code: 'SA', name: 'Saudi Arabia', nameEs: 'Arabia Saudita', flag: '🇸🇦' },
    { code: 'ZA', name: 'South Africa', nameEs: 'Sudáfrica', flag: '🇿🇦' },
    { code: 'ES', name: 'Spain', nameEs: 'España', flag: '🇪🇸' },
    { code: 'SE', name: 'Sweden', nameEs: 'Suecia', flag: '🇸🇪' },
    { code: 'CH', name: 'Switzerland', nameEs: 'Suiza', flag: '🇨🇭' },
    { code: 'TH', name: 'Thailand', nameEs: 'Tailandia', flag: '🇹🇭' },
    { code: 'TR', name: 'Turkey', nameEs: 'Turquía', flag: '🇹🇷' },
    { code: 'UA', name: 'Ukraine', nameEs: 'Ucrania', flag: '🇺🇦' },
    { code: 'AE', name: 'United Arab Emirates', nameEs: 'Emiratos Árabes Unidos', flag: '🇦🇪' },
    { code: 'GB', name: 'United Kingdom', nameEs: 'Reino Unido', flag: '🇬🇧' },
    { code: 'US', name: 'United States', nameEs: 'Estados Unidos', flag: '🇺🇸' },
    { code: 'VN', name: 'Vietnam', nameEs: 'Vietnam', flag: '🇻🇳' },
];

export const countries: Country[] = [...latam, ...other];

export const latamCodes = new Set(latam.map(c => c.code));

export function getCountryByCode(code: string): Country | undefined {
    return countries.find(c => c.code === code);
}
