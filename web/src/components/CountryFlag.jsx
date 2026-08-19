import { countryIso } from '../countries.js';

export default function CountryFlag({ country, size = 16, className = '' }) {
  const iso = countryIso(country);
  if (!iso) {
    return (
      <span
        className={`inline-flex shrink-0 items-center justify-center rounded-full bg-slate-100 text-[9px] text-slate-400 ${className}`}
        style={{ width: size, height: size }}
      >
        ?
      </span>
    );
  }
  return (
    <span
      className={`country-flag ${className}`}
      style={{ width: size, height: size }}
      title={iso.toUpperCase()}
    >
      <span className={`fi fi-${iso} fis`} />
    </span>
  );
}
