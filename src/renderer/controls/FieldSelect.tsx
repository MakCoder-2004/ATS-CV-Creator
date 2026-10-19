import * as Select from '@radix-ui/react-select';
import { Check, ChevronDown, ChevronUp } from 'lucide-react';
import './controls.css';

export interface FieldSelectProps {
  label: string;
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  options: { value: string; label: string }[];
  error?: string;
}

export function FieldSelect({ label, id, value, onValueChange, options, error }: FieldSelectProps) {
  const errorId = `${id}-error`;
  return (
    <div className="field-control">
      <label className="field-control-label" htmlFor={id}>{label}</label>
      <Select.Root value={value || undefined} onValueChange={onValueChange}>
        <Select.Trigger
          id={id}
          className="field-select-trigger"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        >
          <Select.Value placeholder="Select an option" />
          <Select.Icon className="field-select-chevron"><ChevronDown size={17} aria-hidden="true" /></Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Content className="field-select-content" position="popper" sideOffset={5}>
            <Select.ScrollUpButton className="field-select-scroll"><ChevronUp size={16} /></Select.ScrollUpButton>
            <Select.Viewport className="field-select-viewport">
              {options.map((option) => (
                <Select.Item className="field-select-item" key={option.value} value={option.value}>
                  <Select.ItemText>{option.label}</Select.ItemText>
                  <Select.ItemIndicator className="field-select-check"><Check size={15} aria-hidden="true" /></Select.ItemIndicator>
                </Select.Item>
              ))}
            </Select.Viewport>
            <Select.ScrollDownButton className="field-select-scroll"><ChevronDown size={16} /></Select.ScrollDownButton>
          </Select.Content>
        </Select.Portal>
      </Select.Root>
      {error && <p className="field-control-error" id={errorId}>{error}</p>}
    </div>
  );
}
