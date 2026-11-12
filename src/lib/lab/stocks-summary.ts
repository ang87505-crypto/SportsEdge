/** Stock psychology research status for the Lab view. Filled from the committed research report once one exists. */
import type {LabInput} from './view.ts';
export function stockLabSummary():LabInput['stocks']{return {state:'not_run'};}
