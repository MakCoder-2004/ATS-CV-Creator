import { useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, X } from 'lucide-react';
import './controls.css';

export interface MonthYearPickerProps {
  label: string;
  id: string;
  value?: string;
  onChange: (value: string | undefined) => void;
  yearOnly?: boolean;
  error?: string;
}

const MIN_YEAR = 1900;
const MAX_YEAR = 2200;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const YEARS = Array.from({ length: MAX_YEAR - MIN_YEAR + 1 }, (_, i) => MAX_YEAR - i);

function decode(value?: string) {
  const match = value?.match(/^(\d{4})(?:-(\d{2}))?$/);
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = match[2] ? Number(match[2]) - 1 : undefined;
  return year >= MIN_YEAR && year <= MAX_YEAR && (month === undefined || (month >= 0 && month < 12)) ? { year, month } : undefined;
}

export function MonthYearPicker({ label, id, value, onChange, yearOnly = false, error }: MonthYearPickerProps) {
  const parsed = decode(value);
  const fallback = new Date().getFullYear();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(() => ({ year: parsed?.year ?? fallback, month: parsed?.month ?? new Date().getMonth() }));
  const [choosingYear, setChoosingYear] = useState(false);
  const errorId = `${id}-error`;
  const display = value ? (decode(value) ? (value.length === 4 ? value : `${MONTHS[Number(value.slice(5, 7)) - 1]} ${value.slice(0, 4)}`) : value) : '';
  const chooseYear = (year: number) => {
    setShown((current) => ({ ...current, year }));
    if (yearOnly) { onChange(String(year)); setOpen(false); setChoosingYear(false); }
    else setChoosingYear(false);
  };
  const chooseMonth = (month: number) => { onChange(`${shown.year}-${String(month + 1).padStart(2, '0')}`); setOpen(false); };

  return (
    <div className="field-control">
      <label className="field-control-label" htmlFor={id}>{label}</label>
      <Popover.Root open={open} onOpenChange={(next) => { setOpen(next); if (next) { const current = decode(value); if (current) setShown({ year: current.year, month: current.month ?? new Date().getMonth() }); } else setChoosingYear(false); }}>
        <div className="month-year-input-wrap">
          <Popover.Trigger asChild>
            <button id={id} type="button" className="month-year-trigger" aria-label={`${label}${display ? `: ${display}` : ''}`} aria-invalid={error ? true : undefined} aria-describedby={error ? errorId : undefined}>
              <span className={display ? '' : 'month-year-placeholder'}>{display || (yearOnly ? 'Choose a year' : 'Choose month and year')}</span>
              <CalendarDays size={17} aria-hidden="true" />
            </button>
          </Popover.Trigger>
          {value && <button type="button" className="month-year-clear" aria-label={`Clear ${label}`} onClick={() => onChange(undefined)}><X size={15} /></button>}
        </div>
        <Popover.Portal>
          <Popover.Content className="month-year-popover" sideOffset={6} align="start" onOpenAutoFocus={(event) => event.preventDefault()}>
            <div className="month-year-heading">
              {!yearOnly && <button type="button" className="month-year-nav" aria-label="Previous year" disabled={shown.year === MIN_YEAR} onClick={() => setShown((current) => ({ ...current, year: Math.max(MIN_YEAR, current.year - 1) }))}><ChevronLeft size={17} /></button>}
              <button type="button" className="month-year-title" aria-expanded={choosingYear} onClick={() => setChoosingYear((current) => !current)}>{yearOnly ? 'Choose year' : String(shown.year)}<ChevronDown size={15} /></button>
              {!yearOnly && <button type="button" className="month-year-nav" aria-label="Next year" disabled={shown.year === MAX_YEAR} onClick={() => setShown((current) => ({ ...current, year: Math.min(MAX_YEAR, current.year + 1) }))}><ChevronRight size={17} /></button>}
            </div>
            {choosingYear ? <div className="month-year-years" role="listbox" aria-label="Year">
              {YEARS.map((year) => <button type="button" role="option" aria-selected={year === shown.year} key={year} onClick={() => chooseYear(year)}>{year}</button>)}
            </div> : yearOnly ? <div className="month-year-range">Select a year from {MIN_YEAR} to {MAX_YEAR}</div> : <div className="month-year-months" aria-label={`Choose a month in ${shown.year}`}>
              {MONTHS.map((month, index) => <button type="button" key={month} className={parsed?.year === shown.year && parsed.month === index ? 'is-selected' : ''} aria-pressed={parsed?.year === shown.year && parsed.month === index} onClick={() => chooseMonth(index)}>{month.slice(0, 3)}</button>)}
            </div>}
            {yearOnly && <button type="button" className="month-year-this-year" onClick={() => chooseYear(fallback)}>Use this year ({fallback})</button>}
            {!yearOnly && <div className="month-year-actions">
              <button type="button" className="month-year-this-year" onClick={() => chooseYear(shown.year)}>Use year only</button>
              <button type="button" className="month-year-this-year" onClick={() => chooseMonth(new Date().getMonth())}>This month</button>
            </div>}
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {error && <p className="field-control-error" id={errorId}>{error}</p>}
    </div>
  );
}
