// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
import { getContext, setContext } from 'svelte';

/** What a Field gives to the control it wraps: ids for the label and the message, and the error state. */
export interface FieldControl {
  /** Id for the control itself (target of the `<label for>`). */
  readonly id: string;
  /** Id of the visible label, for controls that are not labelable (slider thumb, group). */
  readonly labelId: string;
  /** Id of the hint or of the error, when one is shown. */
  readonly describedBy: string | undefined;
  readonly invalid: boolean;
}

const KEY = Symbol('lun-field');

export function setField(control: FieldControl): void {
  setContext(KEY, control);
}

/** The enclosing Field, if any. */
export function getField(): FieldControl | undefined {
  return getContext<FieldControl | undefined>(KEY);
}
