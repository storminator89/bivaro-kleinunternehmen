/**
 * Simple markdown to HTML converter for print
 */
export function simpleMarkdownToHtml(markdown: string): string {
    return markdown
        // Escape HTML
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        // Headers
        .replace(/^## (.+)$/gm, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>')
        .replace(/^### (.+)$/gm, '<h4 class="text-base font-medium mt-3 mb-1">$1</h4>')
        // Bold
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        // Checkboxes
        .replace(/^- \[ \] (.+)$/gm, '<div class="ml-4 flex"><span class="mr-2">☐</span><span>$1</span></div>')
        .replace(/^- \[x\] (.+)$/gm, '<div class="ml-4 flex"><span class="mr-2">☑</span><span>$1</span></div>')
        // Lists - use proper list styling without extra bullets
        .replace(/^- (.+)$/gm, '<div class="ml-4 flex"><span class="mr-2">•</span><span>$1</span></div>')
        .replace(/^(\d+)\. (.+)$/gm, '<div class="ml-4 flex"><span class="mr-2 min-w-[1.5rem]">$1.</span><span>$2</span></div>')
        // Tables (basic)
        .replace(/\|(.+)\|/g, (match, content) => {
            const cells = content.split('|').map((cell: string) => cell.trim());
            if (cells.every((c: string) => c.match(/^-+$/))) {
                return ''; // Skip separator row
            }
            return '<tr>' + cells.map((cell: string) => `<td class="border px-2 py-1">${cell}</td>`).join('') + '</tr>';
        })
        // Line breaks
        .replace(/\n\n/g, '</p><p class="my-2">')
        .replace(/\n/g, '<br/>')
        // Wrap in paragraph
        .replace(/^(.+)$/, '<p class="my-2">$1</p>');
}
