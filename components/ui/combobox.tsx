"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { comboboxHighlightedIndex, comboboxOptions, nextComboboxIndex, type ComboboxHighlight } from './combobox-options';

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  id?: string;
  className?: string;
  emptyMessage?: string;
  allowCustom?: boolean;
}

export function Combobox({
  value,
  onChange,
  options,
  placeholder = "Suchen oder eingeben...",
  id,
  className,
  emptyMessage = "Keine Treffer",
  allowCustom = true,
}: ComboboxProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(value);
  const [highlight, setHighlight] = React.useState<ComboboxHighlight | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const listboxId = `${inputId}-options`;

  // Sync inputValue with external value
  React.useEffect(() => {
    setInputValue(value);
    setHighlight(null);
  }, [value]);

  const selectableOptions = React.useMemo(
    () => comboboxOptions(options, inputValue, allowCustom),
    [options, inputValue, allowCustom]
  );
  const highlightedIndex = comboboxHighlightedIndex(highlight, selectableOptions, value);
  const activeOption = isOpen ? selectableOptions[highlightedIndex] : undefined;
  const highlightOption = (index: number) => setHighlight({ index, options: selectableOptions, value });
  const moveHighlight = (direction: 1 | -1) => setHighlight(current => ({
    index: nextComboboxIndex(comboboxHighlightedIndex(current, selectableOptions, value), selectableOptions.length, direction),
    options: selectableOptions,
    value,
  }));

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setHighlight(null);
        // Preserve established blur commits: raw input (including whitespace),
        // unlike explicit custom selection/Enter which uses the trimmed value.
        if (inputValue !== value) {
          onChange(inputValue);
        }
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [inputValue, value, onChange]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setIsOpen(true);
      highlightOption(nextComboboxIndex(-1, selectableOptions.length, e.key === 'ArrowDown' ? 1 : -1));
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        moveHighlight(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        moveHighlight(-1);
        break;
      case "Enter":
        e.preventDefault();
        if (activeOption) {
          selectOption(activeOption.value);
        } else if (allowCustom && inputValue.trim()) {
          onChange(inputValue.trim());
          setIsOpen(false);
          setHighlight(null);
        }
        break;
      case "Escape":
        if (isOpen) {
          e.preventDefault();
          e.stopPropagation();
        }
        setIsOpen(false);
        setHighlight(null);
        break;
      case "Tab":
        if (activeOption) {
          selectOption(activeOption.value);
        } else if (inputValue !== value) {
          onChange(inputValue);
        }
        setIsOpen(false);
        setHighlight(null);
        break;
    }
  };

  const selectOption = (option: string) => {
    setInputValue(option);
    onChange(option);
    setIsOpen(false);
    setHighlight(null);
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setIsOpen(true);
    setHighlight(null);
  };

  const handleFocus = () => {
    setIsOpen(true);
  };

  // Scroll highlighted item into view
  React.useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const highlightedElement = listRef.current.children[highlightedIndex] as HTMLElement;
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: "nearest" });
      }
    }
  }, [highlightedIndex]);

  return (
    <div ref={containerRef} className="relative">
      <Input
        ref={inputRef}
        id={inputId}
        role="combobox"
        data-inline-combobox="true"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-activedescendant={activeOption ? `${listboxId}-${highlightedIndex}` : undefined}
        value={inputValue}
        onChange={handleInputChange}
        onFocus={handleFocus}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn("pr-8", className)}
        autoComplete="off"
      />
      
      {/* Dropdown indicator */}
      <button
        type="button"
        aria-label="Vorschläge anzeigen"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
        onClick={() => {
          const nextOpen = !isOpen;
          inputRef.current?.focus();
          setIsOpen(nextOpen);
          if (!nextOpen) setHighlight(null);
        }}
        onMouseDown={event => event.preventDefault()}
        tabIndex={-1}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown list */}
      {isOpen && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          aria-label="Vorschläge"
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-lg"
        >
          {selectableOptions.map((option, index) => (
              <li
                key={`${option.kind}:${option.value}`}
                id={`${listboxId}-${index}`}
                role="option"
                aria-selected={highlightedIndex === index}
                className={cn(
                  "relative cursor-pointer select-none px-3 py-2 text-sm",
                  option.kind === 'custom' && index > 0 && 'border-t',
                  highlightedIndex === index
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted",
                  value === option.value && "font-medium"
                )}
                onClick={() => selectOption(option.value)}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => highlightOption(index)}
              >
                <div className={option.kind === 'custom' ? 'flex items-center gap-2' : 'flex items-center justify-between'}>
                  {option.kind === 'custom' && <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" className="h-4 w-4 text-muted-foreground" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>}
                  <span>{option.kind === 'custom' ? `„${option.value}" erstellen` : option.value}</span>
                  {value === option.value && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      aria-hidden="true"
                      className="h-4 w-4 text-primary"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fillRule="evenodd"
                        d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                        clipRule="evenodd"
                      />
                    </svg>
                  )}
                </div>
              </li>
            ))}
          {selectableOptions.length === 0 && <li role="presentation" className="px-3 py-2 text-sm text-muted-foreground">{emptyMessage}</li>}
        </ul>
      )}
    </div>
  );
}
