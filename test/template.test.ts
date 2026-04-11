import test from "node:test";
import assert from "node:assert/strict";
import { renderTemplate } from "../src/template.js";

test("renderTemplate interpolates nested values and JSON blocks", () => {
  const context = {
    payload: {
      id: "abc",
      title: "Transcript title"
    },
    event: {
      type: "transcript.completed"
    }
  };

  assert.equal(
    renderTemplate("Review {{payload.title}} from {{event.type}}", context),
    "Review Transcript title from transcript.completed"
  );

  assert.equal(
    renderTemplate("Payload:\n{{json payload}}", context),
    'Payload:\n{\n  "id": "abc",\n  "title": "Transcript title"\n}'
  );
});
