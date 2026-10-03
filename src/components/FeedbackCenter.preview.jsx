import React from "react";
import { CapsuleSpinner } from "./FeedbackCenter";

// Manual design preview; deliberately not mounted in the production route tree.
export function FeedbackCenterPreview() {
  return (
    <section className="feedback-preview" aria-label="Feedback component states">
      <button className="button button-primary" type="button">Default</button>
      <button className="button button-primary is-hover" type="button">Hover</button>
      <button className="button button-primary is-focus" type="button">Focus</button>
      <button className="button button-primary is-active" type="button">Active</button>
      <button className="button button-primary" disabled type="button">Disabled</button>
      <button className="button button-primary" disabled type="button"><CapsuleSpinner compact />Loading</button>
      <p className="feedback-toast is-error">Error notice</p>
      <p className="feedback-toast is-success">Success notice</p>
    </section>
  );
}
