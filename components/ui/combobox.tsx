"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

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
  const [highlightedIndex, setHighlightedIndex] = React.useState(-1);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);
  const containerRef = React.useRef<HTMLDivElement>(null);

  // Sync inputValue with external value
  React.useEffect(() => {
    setInputValue(value);
  }, [value]);

  // Filter options based on input
  const filteredOptions = React.useMemo(() => {
    if (!inputValue.trim()) return options;
    const search = inputValue.toLowerCase().trim();
    return options.filter((option) =>
      option.toLowerCase().includes(search)
    );
  }, [inputValue, options]);

  // Close dropdown when clicking outside
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // Commit the value when clicking outside
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
      setIsOpen(true);
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredOptions.length - 1 ? prev + 1 : 0
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredOptions.length - 1
        );
        break;
      case "Enter":
        e.preventDefault();
        if (highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
          selectOption(filteredOptions[highlightedIndex]);
        } else if (allowCustom && inputValue.trim()) {
          onChange(inputValue.trim());
          setIsOpen(false);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setHighlightedIndex(-1);
        break;
      case "Tab":
        if (isOpen && highlightedIndex >= 0 && filteredOptions[highlightedIndex]) {
          selectOption(filteredOptions[highlightedIndex]);
        } else if (inputValue !== value) {
          onChange(inputValue);
        }
        setIsOpen(false);
        break;
    }
  };

  const selectOption = (option: string) => {
    setInputValue(option);
    onChange(option);
    setIsOpen(false);
    setHighlightedIndex(-1);
    inputRef.current?.focus();
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setIsOpen(true);
    setHighlightedIndex(-1);
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
        id={id}
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
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground focus:outline-none"
        onClick={() => {
          setIsOpen(!isOpen);
          inputRef.current?.focus();
        }}
        tabIndex={-1}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
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
          className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border bg-popover py-1 text-popover-foreground shadow-lg"
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => (
              <li
                key={option}
                className={cn(
                  "relative cursor-pointer select-none px-3 py-2 text-sm",
                  highlightedIndex === index
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted",
                  value === option && "font-medium"
                )}
                onClick={() => selectOption(option)}
                onMouseEnter={() => setHighlightedIndex(index)}
              >
                <div className="flex items-center justify-between">
                  <span>{option}</span>
                  {value === option && (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
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
            ))
          ) : inputValue.trim() && allowCustom ? (
            <li
              className={cn(
                "relative cursor-pointer select-none px-3 py-2 text-sm",
                highlightedIndex === 0 ? "bg-accent text-accent-foreground" : "hover:bg-muted"
              )}
              onClick={() => selectOption(inputValue.trim())}
              onMouseEnter={() => setHighlightedIndex(0)}
            >
              <div className="flex items-center gap-2">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-4 w-4 text-muted-foreground"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>„{inputValue.trim()}" erstellen</span>
              </div>
            </li>
          ) : (
            <li className="px-3 py-2 text-sm text-muted-foreground">
              {emptyMessage}
            </li>
          )}
          
          {/* Show "create new" option if typing and option doesn't exist exactly */}
          {inputValue.trim() &&
            allowCustom &&
            filteredOptions.length > 0 &&
            !filteredOptions.some((o) => o.toLowerCase() === inputValue.toLowerCase().trim()) && (
              <li
                className={cn(
                  "relative cursor-pointer select-none border-t px-3 py-2 text-sm",
                  highlightedIndex === filteredOptions.length
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted"
                )}
                onClick={() => selectOption(inputValue.trim())}
                onMouseEnter={() => setHighlightedIndex(filteredOptions.length)}
              >
                <div className="flex items-center gap-2">
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4 text-muted-foreground"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  <span>„{inputValue.trim()}" erstellen</span>
                </div>
              </li>
            )}
        </ul>
      )}
    </div>
  );
}
