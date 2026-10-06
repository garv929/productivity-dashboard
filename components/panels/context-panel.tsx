"use client";

import type { PanelData } from "@/lib/services/panels";
import { PipelinePanel } from "./pipeline-panel";
import { PeoplePanel } from "./people-panel";
import { PrepPanel, UpcomingInterviews } from "./prep-panel";
import { ResearchPanel } from "./research-panel";
import { OptionsPanel } from "./options-panel";
import { FocusPanel } from "./focus-panel";

/** The part of a group's panel shown at the top of its page, if any (Interview Prep: upcoming interviews). */
export function ContextPanelTop({ data, readOnly, groupColor }: { data: PanelData; readOnly: boolean; groupColor: string }) {
  if (data.kind === "prep") return <UpcomingInterviews data={data} readOnly={readOnly} color={groupColor} />;
  return null;
}

export function ContextPanel({ data, readOnly, groupColor }: { data: PanelData; readOnly: boolean; groupColor: string }) {
  switch (data.kind) {
    case "pipeline":
      return <PipelinePanel data={data} readOnly={readOnly} color={groupColor} />;
    case "people":
      return <PeoplePanel data={data} readOnly={readOnly} color={groupColor} />;
    case "prep":
      return <PrepPanel data={data} readOnly={readOnly} />;
    case "research":
      return <ResearchPanel data={data} readOnly={readOnly} />;
    case "options":
      return <OptionsPanel data={data} readOnly={readOnly} color={groupColor} />;
    case "focus":
      return <FocusPanel data={data} readOnly={readOnly} />;
    case "plain":
      return null;
  }
}
