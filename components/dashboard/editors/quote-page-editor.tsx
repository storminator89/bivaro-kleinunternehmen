/* Hallmark · genre: modern-minimal · macrostructure: Workbench · theme: custom Bivaro
 * tone: utilitarian · anchor hue: cool blue · enrichment: none
 * pre-emit critique: P5 H5 E4 S5 R5 V4 · contrast: pass (40–41)
 * honest: pass (46) · chrome: pass (47) · tokens: pass (48) · mobile: pass (34, 49–57)
 */
"use client";

import { useRouter } from "next/navigation";
import { QuoteEditor } from "@/components/dashboard/editors/quote-editor";

export function QuotePageEditor() {
  const router = useRouter();

  const returnToQuotes = () => {
    router.push("/dashboard?tab=quotes");
  };

  return (
    <QuoteEditor
      onCancel={returnToQuotes}
    />
  );
}
