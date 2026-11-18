"use client";

import { Children, isValidElement, useEffect, useId, useRef, useState, type ReactNode, type SelectHTMLAttributes } from "react";

type Option = { value: string; label: ReactNode; disabled?: boolean };
function optionsFrom(children: ReactNode): Option[] {
  return Children.toArray(children).flatMap(child => {
    if (!isValidElement<{ value?: string | number; children?: ReactNode; disabled?: boolean }>(child)) return [];
    if (child.type === "option") return [{ value: String(child.props.value ?? child.props.children ?? ""), label: child.props.children, disabled: child.props.disabled }];
    return optionsFrom(child.props.children);
  });
}

/** Shared single-choice control, with a native select retained for form submission. */
export function Select({ children, className = "", value, defaultValue, onChange, id, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  const listId = useId();
  const options = optionsFrom(children);
  const [current, setCurrent] = useState(String(defaultValue ?? options[0]?.value ?? ""));
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const native = useRef<HTMLSelectElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = String(value ?? current);
  useEffect(() => {
    function close(event: MouseEvent) { if (!root.current?.contains(event.target as Node)) setOpen(false); }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  function choose(option: Option) {
    if (!native.current || option.disabled) return;
    native.current.value = option.value;
    native.current.dispatchEvent(new Event("change", { bubbles: true }));
    setOpen(false);
    trigger.current?.focus();
  }
  return <div ref={root} className={`selectControl ${className}`} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }} onKeyDown={event => {
    if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); setOpen(true);
      const buttons = Array.from(root.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)") ?? []);
      const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : (index + (event.key === "ArrowUp" ? -1 : 1) + buttons.length) % buttons.length;
      requestAnimationFrame(() => { const available = root.current?.querySelectorAll<HTMLButtonElement>("[role=option]:not(:disabled)"); available?.[next < 0 ? 0 : next]?.focus(); });
    }
  }}>
    <select {...props} ref={native} aria-label={undefined} aria-labelledby={undefined} className="srOnly" tabIndex={-1} aria-hidden="true" value={selected} onChange={event => { setCurrent(event.target.value); onChange?.(event); }} onInvalid={() => trigger.current?.focus()}>{children}</select>
    <button ref={trigger} id={id} type="button" className="dropdownTrigger" role="combobox" aria-controls={listId} aria-expanded={open} aria-haspopup="listbox" aria-label={props["aria-label"]} aria-labelledby={props["aria-labelledby"]} disabled={props.disabled} onClick={() => setOpen(!open)}>
      <span className="selectValue">{options.find(option => option.value === selected)?.label ?? "Chọn…"}</span>
      <svg className="dropdownChevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    {open && <div id={listId} className="selectOptions" role="listbox" aria-label={props["aria-label"]}>
      {options.map(option => <button key={option.value} type="button" role="option" data-value={option.value} aria-selected={option.value === selected} disabled={option.disabled} onClick={() => choose(option)}>{option.label}<span aria-hidden="true">{option.value === selected ? "✓" : ""}</span></button>)}
    </div>}
  </div>;
}
