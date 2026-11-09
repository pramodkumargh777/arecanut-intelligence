import { MONTH_NAMES_EN, MONTH_NAMES_KN } from "../../../shared/dates";
import { useLanguage } from "../services/language";

/**
 * A calendar month chosen with two dropdowns, month and year. The browser's own month input lets people change the
 * year only with small arrows (Chrome) or not at all (Safari, Firefox show a text box), so this is used instead.
 * Values are "YYYY-MM", and months after `max` cannot be picked.
 */
export function MonthYearPicker({ label, value, min, max, onChange }: { label: string; value: string; min: string; max: string; onChange: (value: string) => void }) {
  const { language } = useLanguage();
  const names = language === "kn" ? MONTH_NAMES_KN : MONTH_NAMES_EN;
  const [year, month] = [Number(value.slice(0, 4)), Number(value.slice(5, 7))];
  const [minYear, maxYear] = [Number(min.slice(0, 4)), Number(max.slice(0, 4))];
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, index) => maxYear - index);
  const monthKey = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
  const allowed = (y: number, m: number) => monthKey(y, m) >= min && monthKey(y, m) <= max;
  // Changing the year keeps the month where it can, and otherwise moves to the nearest month that exists.
  const pickYear = (next: number) => onChange(allowed(next, month) ? monthKey(next, month) : monthKey(next, monthKey(next, month) > max ? Number(max.slice(5, 7)) : Number(min.slice(5, 7))));
  return <div className="filter-control month-year" role="group" aria-label={label}>
    <span>{label}</span>
    <div className="month-year-fields">
      <select aria-label={`${label}: ${language === "kn" ? "ತಿಂಗಳು" : "month"}`} value={month} onChange={(event) => onChange(monthKey(year, Number(event.target.value)))}>
        {names.map((name, index) => <option key={name} value={index + 1} disabled={!allowed(year, index + 1)}>{name}</option>)}
      </select>
      <select aria-label={`${label}: ${language === "kn" ? "ವರ್ಷ" : "year"}`} value={year} onChange={(event) => pickYear(Number(event.target.value))}>
        {years.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </div>
  </div>;
}
