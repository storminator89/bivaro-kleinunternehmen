"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect } from "react";

export function CollapseButton() {
  // Set initial sidebar width based on localStorage
  useEffect(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    if (saved) {
      const isCollapsed = JSON.parse(saved);
      const sidebar = document.querySelector('aside');
      if (sidebar) {
        if (isCollapsed) {
          sidebar.classList.remove('w-64');
          sidebar.classList.add('w-20');
        } else {
          sidebar.classList.remove('w-20');
          sidebar.classList.add('w-64');
        }
      }
    }
  }, []);

  const toggleCollapse = () => {
    const sidebar = document.querySelector('aside');
    if (sidebar) {
      const isCollapsed = sidebar.classList.contains('w-20');
      const newState = !isCollapsed;
      
      if (newState) {
        sidebar.classList.remove('w-64');
        sidebar.classList.add('w-20');
      } else {
        sidebar.classList.remove('w-20');
        sidebar.classList.add('w-64');
      }
      
      localStorage.setItem('sidebar-collapsed', JSON.stringify(newState));
      
      // Dispatch custom event to notify NavLinks component
      window.dispatchEvent(new CustomEvent('sidebar-toggle', { detail: newState }));
    }
  };

  return (
    <button 
      onClick={toggleCollapse}
      className="p-1 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
      title="Sidebar einklappen"
    >
      <ChevronLeft className="h-5 w-5" />
    </button>
  );
}